/**
 * LSP backend that forwards pi's `lsp` tool to the paired
 * nvim's own language servers.
 *
 * The harness (agentic-harness.pi) owns the `lsp` tool and a
 * backend registry. It cannot import a backend from here, and
 * we cannot import its registry: pi loads packages with
 * isolated module roots. So we register over the shared event
 * bus, mirroring this package's own `neovim-pi:register-handler`
 * bridge. The harness listens for `lsp:register-backend`,
 * validates the entry, and routes the tool to us whenever we
 * report ourselves available, which is only while a session is
 * paired with an nvim that advertises `nvim.lsp.query`.
 *
 * The nvim side (`lua/neovim-pi/lsp.lua`) does the LSP work and
 * normalizes coordinates to the tool's convention (1-indexed
 * line, 0-indexed byte column). This module is the thin
 * forwarding shim: it calls that Lua and shapes the reply into
 * the backend contract the harness expects.
 */

import type { NeovimClient } from "neovim";
import { peerHas } from "./handshake.js";

/** Minimal event-bus shape we depend on (see event-bridge.ts). */
interface EventBus {
	on(name: string, handler: (data: unknown) => void): void;
	emit(name: string, data?: unknown): void;
}

type ClientResolver = () => NeovimClient | null;

/** A point in a file: 1-indexed line, 0-indexed byte column. */
interface LspPosition {
	line: number;
	character: number;
}
interface LspRange {
	start: LspPosition;
	end: LspPosition;
}
interface LspLocation {
	path: string;
	range: LspRange;
}
interface Diagnostic {
	path: string;
	range: LspRange;
	severity: string;
	message: string;
	source?: string;
	code?: string;
}
interface SymbolInfo {
	name: string;
	kind: string;
	location: LspLocation;
	containerName?: string;
}
interface HoverInfo {
	contents: string;
	range?: LspRange;
}
interface CodeAction {
	title: string;
	kind?: string;
}
interface WorkspaceEdit {
	changes: Array<{
		path: string;
		edits: Array<{ range: LspRange; newText: string }>;
	}>;
}

/** The backend operation contract the harness resolves and calls. */
interface LspBackend {
	name: string;
	diagnostics(path: string): Promise<readonly Diagnostic[]>;
	definition(target: LspTarget): Promise<readonly LspLocation[]>;
	references(target: LspTarget): Promise<readonly LspLocation[]>;
	hover(target: LspTarget): Promise<HoverInfo | null>;
	documentSymbols(path: string): Promise<readonly SymbolInfo[]>;
	workspaceSymbols(query: string): Promise<readonly SymbolInfo[]>;
	rename(target: LspTarget, newName: string): Promise<WorkspaceEdit>;
	codeActions(path: string, range?: LspRange): Promise<readonly CodeAction[]>;
	dispose(): Promise<void>;
}

interface LspTarget {
	path: string;
	position: LspPosition;
}

const BACKEND_NAME = "neovim";
/** Below the standalone default (100) so a paired editor wins. */
const BACKEND_PRIORITY = 50;
const LSP_CAPABILITY = "nvim.lsp.query";

/** A reply from the Lua side: results, or a no-server signal. */
interface LuaReply {
	ok: boolean;
	reason?: string;
	items?: unknown[];
	hover?: unknown;
	changes?: unknown[];
}

/** Run an LSP function on the nvim side and return its reply. */
async function callLua(client: NeovimClient, fn: string, args: unknown[]): Promise<LuaReply> {
	const reply = (await client.request("nvim_exec_lua", [
		`return require("neovim-pi.lsp").${fn}(...)`,
		args,
	])) as LuaReply;
	return reply ?? { ok: false, reason: "no-reply" };
}

/**
 * Build the forwarding backend. It reads the client lazily on
 * each call, so a detach between calls surfaces as an empty
 * result rather than a stale reference.
 */
export function createNeovimLspBackend(getClient: ClientResolver): LspBackend {
	const client = (): NeovimClient => {
		const c = getClient();
		if (!c) throw new Error("no nvim paired with this pi session");
		return c;
	};

	const items = (reply: LuaReply): unknown[] =>
		reply.ok && Array.isArray(reply.items) ? reply.items : [];

	return {
		name: BACKEND_NAME,
		async diagnostics(path) {
			const reply = await callLua(client(), "diagnostics", [path]);
			return items(reply).map(toDiagnostic);
		},
		async definition(target) {
			const reply = await callLua(client(), "definition", [
				target.path,
				target.position.line,
				target.position.character,
			]);
			return items(reply).map(toLocation);
		},
		async references(target) {
			const reply = await callLua(client(), "references", [
				target.path,
				target.position.line,
				target.position.character,
			]);
			return items(reply).map(toLocation);
		},
		async hover(target) {
			const reply = await callLua(client(), "hover", [
				target.path,
				target.position.line,
				target.position.character,
			]);
			return reply.ok && reply.hover ? toHover(reply.hover) : null;
		},
		async documentSymbols(path) {
			const reply = await callLua(client(), "document_symbols", [path]);
			return items(reply).map(toSymbol);
		},
		async workspaceSymbols(query) {
			const reply = await callLua(client(), "workspace_symbols", [query]);
			return items(reply).map(toSymbol);
		},
		async rename(target, newName) {
			const reply = await callLua(client(), "rename", [
				target.path,
				target.position.line,
				target.position.character,
				newName,
			]);
			const changes = reply.ok && Array.isArray(reply.changes) ? reply.changes : [];
			return { changes: changes.map(toFileEdits) };
		},
		async codeActions(path, range) {
			const srange = range
				? {
						start_line: range.start.line,
						start_char: range.start.character,
						end_line: range.end.line,
						end_char: range.end.character,
					}
				: null;
			const reply = await callLua(client(), "code_actions", [path, srange]);
			return items(reply).map(toCodeAction);
		},
		async dispose() {
			// The nvim owns its servers; there is nothing to close.
		},
	};
}

/**
 * Register the forwarding backend with the harness over the
 * event bus. Emits the entry immediately and again on the
 * harness's `lsp:ready` signal, so registration is independent
 * of which package loaded first. Unregisters at shutdown.
 */
export function registerLspBackend(
	pi: {
		events: EventBus;
		on: (event: "session_shutdown", handler: () => void) => void;
	},
	getClient: ClientResolver,
): void {
	const backend = createNeovimLspBackend(getClient);
	const entry = {
		name: BACKEND_NAME,
		priority: BACKEND_PRIORITY,
		isAvailable: () => getClient() !== null && peerHas(LSP_CAPABILITY),
		backend,
	};
	const announce = () => pi.events.emit("lsp:register-backend", entry);
	pi.events.on("lsp:ready", announce);
	announce();
	pi.on("session_shutdown", () => {
		pi.events.emit("lsp:unregister-backend", { name: BACKEND_NAME });
	});
}

function toPosition(raw: unknown): LspPosition {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		line: typeof r.line === "number" ? r.line : 1,
		character: typeof r.character === "number" ? r.character : 0,
	};
}

function toRange(raw: unknown): LspRange {
	const r = (raw ?? {}) as Record<string, unknown>;
	return { start: toPosition(r.start), end: toPosition(r.end) };
}

function toLocation(raw: unknown): LspLocation {
	const r = (raw ?? {}) as Record<string, unknown>;
	return { path: String(r.path ?? ""), range: toRange(r.range) };
}

function toDiagnostic(raw: unknown): Diagnostic {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		path: String(r.path ?? ""),
		range: toRange(r.range),
		severity: String(r.severity ?? "information"),
		message: String(r.message ?? ""),
		source: typeof r.source === "string" ? r.source : undefined,
		code: typeof r.code === "string" ? r.code : undefined,
	};
}

function toSymbol(raw: unknown): SymbolInfo {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		name: String(r.name ?? ""),
		kind: String(r.kind ?? "unknown"),
		location: toLocation(r.location),
		containerName: typeof r.containerName === "string" ? r.containerName : undefined,
	};
}

function toHover(raw: unknown): HoverInfo {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		contents: String(r.contents ?? ""),
		range: r.range ? toRange(r.range) : undefined,
	};
}

function toCodeAction(raw: unknown): CodeAction {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		title: String(r.title ?? ""),
		kind: typeof r.kind === "string" ? r.kind : undefined,
	};
}

function toFileEdits(raw: unknown): {
	path: string;
	edits: Array<{ range: LspRange; newText: string }>;
} {
	const r = (raw ?? {}) as Record<string, unknown>;
	const edits = Array.isArray(r.edits) ? r.edits : [];
	return {
		path: String(r.path ?? ""),
		edits: edits.map((e) => {
			const edit = (e ?? {}) as Record<string, unknown>;
			return { range: toRange(edit.range), newText: String(edit.newText ?? "") };
		}),
	};
}

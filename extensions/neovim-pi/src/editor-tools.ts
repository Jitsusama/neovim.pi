/**
 * Editor-control tools the agent calls to edit, view and
 * persist real files through a paired nvim.
 *
 * These are distinct from the `pi://` buffer tools in
 * `tools.ts`: those render read-only virtual content, while
 * these drive an editable buffer on pi's stage window. The
 * shape is noun-plus-action (`nvim_file`, `nvim_text`,
 * `nvim_buffer`) so each noun grows new verbs additively as
 * later phases land window, cursor and diff control.
 *
 * Every tool gates on a capability the paired plugin
 * advertises. An older plugin that predates a verb simply
 * does not advertise it, and the tool degrades to a clear
 * "update the plugin" error rather than a cryptic lua
 * failure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NeovimClient } from "neovim";
import { Type } from "typebox";
import { peerHas } from "./handshake.js";

type ClientResolver = () => NeovimClient | null;

/** Register the editor-control tools (`nvim_file`, `nvim_text`, `nvim_buffer`). */
export function registerEditorTools(pi: ExtensionAPI, getClient: ClientResolver): void {
	registerFileTool(pi, getClient);
	registerTextTool(pi, getClient);
	registerBufferTool(pi, getClient);
	registerWindowTool(pi, getClient);
}

interface OpenResult {
	bufnr: number;
	path: string;
	lines: number;
}

function registerFileTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_file",
		label: "Open a file in nvim",
		description:
			"Open a real file from disk into pi's stage window (a window pi owns, never the window you are focused on). Returns the bufnr to use with nvim_text.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("open")], {
				description: "The file operation. Only `open` is supported today.",
			}),
			path: Type.String({
				description: "Path to the file. Relative paths resolve against the cwd.",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			requireCapability("nvim.file.open");
			const result = await execLua<OpenResult>(client, "file", "open", [params.path]);
			return {
				content: [
					{
						type: "text",
						text: `opened ${result.path} (bufnr ${result.bufnr}, ${result.lines} lines)`,
					},
				],
				details: result,
			};
		},
	});
}

interface GetRangeResult {
	text: string;
}

interface SetRangeResult {
	ok: boolean;
	error?: string;
	conflict?: boolean;
	changedtick?: number;
	endLine?: number;
	endCol?: number;
	lines?: number;
}

function registerTextTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_text",
		label: "Read or replace text in nvim",
		description:
			"Read or replace a text range in a buffer pi opened. Lines are 1-indexed; columns are 0-indexed character offsets, end-exclusive. set_range refuses a buffer pi did not open and refuses on a changedtick mismatch.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("get_range"), Type.Literal("set_range")], {
				description: "Read a range (`get_range`) or replace it (`set_range`).",
			}),
			bufnr: Type.Number({ description: "Buffer handle returned by nvim_file." }),
			startLine: Type.Number({ description: "1-indexed start line." }),
			startCol: Type.Number({ description: "0-indexed start character column." }),
			endLine: Type.Number({ description: "1-indexed end line." }),
			endCol: Type.Number({ description: "0-indexed end character column, exclusive." }),
			text: Type.Optional(
				Type.String({ description: "Replacement text for set_range. Newlines split lines." }),
			),
			expectedChangedtick: Type.Optional(
				Type.Number({
					description:
						"For set_range: refuse the write if the buffer's changedtick no longer matches this. Pass the changedtick from a prior read.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			const range = [params.startLine, params.startCol, params.endLine, params.endCol];

			if (params.action === "get_range") {
				requireCapability("nvim.text.getRange");
				const result = await execLua<GetRangeResult>(client, "text", "get_range", [
					params.bufnr,
					...range,
				]);
				return { content: [{ type: "text", text: result.text }], details: result };
			}

			requireCapability("nvim.text.setRange");
			if (params.text === undefined) {
				throw new Error("set_range requires `text`");
			}
			const args: unknown[] = [params.bufnr, ...range, params.text];
			if (params.expectedChangedtick !== undefined) {
				args.push(params.expectedChangedtick);
			}
			const result = await execLua<SetRangeResult>(client, "text", "set_range", args);

			if (!result.ok) {
				const reason = result.conflict
					? `refused: buffer changed since you last read it (now at changedtick ${result.changedtick}); re-read and retry`
					: `refused: ${result.error ?? "unknown reason"}`;
				return { content: [{ type: "text", text: reason }], details: result };
			}
			return {
				content: [
					{
						type: "text",
						text: `replaced range; buffer now ${result.lines} lines, changedtick ${result.changedtick}`,
					},
				],
				details: result,
			};
		},
	});
}

interface SaveResult {
	ok: boolean;
	error?: string;
	modified?: boolean;
	changedtick?: number;
}

interface BufferEntry {
	bufnr: number;
	name: string;
	listed: boolean;
	loaded: boolean;
	modified: boolean;
	owned: boolean;
}

function registerBufferTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_buffer",
		label: "Inspect or manage nvim buffers",
		description:
			"Act on the editor's buffers. `list` reports every buffer and which ones pi owns. `save` writes a buffer pi opened back to its file on demand (pi warns rather than auto-saves, so this is how an edit reaches disk).",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("save")], {
				description: "List all buffers (`list`) or save one pi owns (`save`).",
			}),
			bufnr: Type.Optional(
				Type.Number({ description: "Buffer handle for `save`. Returned by nvim_file." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);

			if (params.action === "list") {
				requireCapability("nvim.buffer.list");
				const list = await execLua<BufferEntry[]>(client, "buffers", "list", []);
				const ownedCount = list.filter((b) => b.owned).length;
				return {
					content: [{ type: "text", text: `${list.length} buffers (${ownedCount} opened by pi)` }],
					details: { buffers: list },
				};
			}

			requireCapability("nvim.file.save");
			if (params.bufnr === undefined) {
				throw new Error("save requires `bufnr`");
			}
			const result = await execLua<SaveResult>(client, "file", "save", [params.bufnr]);
			if (!result.ok) {
				return {
					content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
					details: result,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `saved bufnr ${params.bufnr}${result.modified ? " (still dirty)" : ""}`,
					},
				],
				details: result,
			};
		},
	});
}

interface WindowEntry {
	win: number;
	bufnr: number;
	name: string;
	modified: boolean;
	current: boolean;
	is_stage: boolean;
}

interface Layout {
	current_win: number;
	stage_win: number | null;
	tabs: { tabnr: number; windows: WindowEntry[] }[];
}

function registerWindowTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_window",
		label: "Inspect nvim windows",
		description:
			"Inspect the editor's windows. `layout` reports every window across every tab, the focused window and pi's stage window, so the agent can see what is on screen.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("layout")], {
				description: "The window operation. Only `layout` is supported today.",
			}),
		}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			requireCapability("nvim.window.layout");
			const layout = await execLua<Layout>(client, "window", "layout", []);
			const winCount = layout.tabs.reduce((n, t) => n + t.windows.length, 0);
			return {
				content: [
					{
						type: "text",
						text: `${winCount} windows across ${layout.tabs.length} tab(s); stage ${layout.stage_win ?? "none"}`,
					},
				],
				details: layout,
			};
		},
	});
}

/** Resolve the paired client or explain how to pair. */
function requireClient(get: ClientResolver): NeovimClient {
	const client = get();
	if (!client) {
		throw new Error("no nvim paired with this pi session; call `nvim_attach` to pair, then retry.");
	}
	return client;
}

/** Refuse a verb the paired plugin is too old to support. */
function requireCapability(capability: string): void {
	if (!peerHas(capability)) {
		throw new Error(
			`the paired nvim does not support ${capability}; update the neovim-pi plugin to use this tool.`,
		);
	}
}

/** Call a `neovim-pi.<module>.<fn>` lua function over the wire. */
async function execLua<T>(
	client: NeovimClient,
	module: string,
	fn: string,
	args: unknown[],
): Promise<T> {
	return (await client.request("nvim_exec_lua", [
		`return require("neovim-pi.${module}").${fn}(...)`,
		args,
	])) as T;
}

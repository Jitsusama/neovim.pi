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
import { turnState } from "./cursor.js";
import { peerHas } from "./handshake.js";

type ClientResolver = () => NeovimClient | null;

/** Register the editor-control tools (`nvim_file`, `nvim_text`, `nvim_buffer`, `nvim_window`, `nvim_cursor`, `nvim_diff`). */
export function registerEditorTools(pi: ExtensionAPI, getClient: ClientResolver): void {
	registerFileTool(pi, getClient);
	registerTextTool(pi, getClient);
	registerBufferTool(pi, getClient);
	registerWindowTool(pi, getClient);
	registerCursorTool(pi, getClient);
	registerDiffTool(pi, getClient);
}

interface OpenResult {
	bufnr: number;
	path: string;
	lines: number;
	win: number;
}

function registerFileTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_file",
		label: "Open a file in nvim",
		description:
			"Open a real file from disk into a window pi owns (never the window you are focused on). `mode` controls placement: `current` reuses pi's primary stage window, `split`/`vsplit` open a new pi-owned window beside it. Optional `line`/`col` land the cursor. Returns the bufnr to use with nvim_text and the window it opened in.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("open")], {
				description: "The file operation. Only `open` is supported today.",
			}),
			path: Type.String({
				description: "Path to the file. Relative paths resolve against the cwd.",
			}),
			mode: Type.Optional(
				Type.Union([Type.Literal("current"), Type.Literal("split"), Type.Literal("vsplit")], {
					description:
						"Where to show the file. `current` (default) reuses pi's primary stage window; `split` opens a horizontal split beside it; `vsplit` a vertical one. All are focus-preserving.",
				}),
			),
			line: Type.Optional(
				Type.Number({ description: "1-indexed line to land the cursor on after opening." }),
			),
			col: Type.Optional(
				Type.Number({
					description:
						"0-indexed byte column for the cursor; defaults to 0. Ignored without `line`.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			requireCapability("nvim.file.open");
			const opts: Record<string, unknown> = { mode: params.mode ?? "current" };
			if (params.line !== undefined) {
				opts.line = params.line;
			}
			if (params.col !== undefined) {
				opts.col = params.col;
			}
			const result = await execLua<OpenResult>(client, "file", "open", [params.path, opts]);
			return {
				content: [
					{
						type: "text",
						text: `opened ${result.path} (bufnr ${result.bufnr}, ${result.lines} lines) in window ${result.win}`,
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

interface SwitchResult {
	ok: boolean;
	win?: number;
	bufnr?: number;
	error?: string;
}

interface DeleteResult {
	ok: boolean;
	modified?: boolean;
	error?: string;
}

interface ReloadResult {
	ok: boolean;
	modified?: boolean;
	changedtick?: number;
	lines?: number;
	error?: string;
}

interface InfoResult extends BufferEntry {
	ok: boolean;
	lines: number;
	changedtick: number;
	error?: string;
}

function registerBufferTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_buffer",
		label: "Inspect or manage nvim buffers",
		description:
			"Act on the editor's real-file buffers. `list` reports every buffer and which ones pi owns; `info` reports one buffer in detail. `save` writes a buffer pi opened back to its file (pi warns rather than auto-saves, so this is how an edit reaches disk). `reload` re-reads a buffer pi opened from disk, the inverse of save. `switch` shows an existing buffer on pi's stage window. `delete` removes a buffer pi opened. `reload` and `delete` refuse a buffer pi does not own and refuse a buffer with unsaved changes unless `force` discards them.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("list"),
					Type.Literal("info"),
					Type.Literal("save"),
					Type.Literal("reload"),
					Type.Literal("switch"),
					Type.Literal("delete"),
				],
				{
					description:
						"List every buffer (`list`), report one in detail (`info`), save one pi owns (`save`), reload one pi owns from disk (`reload`), show one on pi's stage (`switch`) or remove one pi owns (`delete`).",
				},
			),
			bufnr: Type.Optional(
				Type.Number({
					description:
						"Buffer handle for `info`, `save`, `reload`, `switch` and `delete`. Returned by nvim_file or nvim_buffer list.",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description: "For `delete` and `reload`: discard unsaved changes instead of refusing.",
				}),
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

			if (params.bufnr === undefined) {
				throw new Error(`${params.action} requires \`bufnr\``);
			}

			if (params.action === "info") {
				requireCapability("nvim.buffer.info");
				const result = await execLua<InfoResult>(client, "buffers", "info", [params.bufnr]);
				if (!result.ok) {
					return {
						content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
						details: result,
					};
				}
				const flags = [
					result.modified ? "modified" : "clean",
					result.owned ? "pi-owned" : "not pi-owned",
					result.loaded ? "loaded" : "unloaded",
				].join(", ");
				return {
					content: [
						{
							type: "text",
							text: `bufnr ${result.bufnr}: ${result.name || "[no name]"} (${result.lines} lines, ${flags}, changedtick ${result.changedtick})`,
						},
					],
					details: result,
				};
			}

			if (params.action === "save") {
				requireCapability("nvim.file.save");
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
			}

			if (params.action === "switch") {
				requireCapability("nvim.buffer.switch");
				const result = await execLua<SwitchResult>(client, "buffers", "switch", [params.bufnr]);
				if (!result.ok) {
					return {
						content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
						details: result,
					};
				}
				return {
					content: [
						{ type: "text", text: `showing bufnr ${result.bufnr} in window ${result.win}` },
					],
					details: result,
				};
			}

			if (params.action === "reload") {
				requireCapability("nvim.file.reload");
				const reloadArgs: unknown[] = [params.bufnr];
				if (params.force !== undefined) {
					reloadArgs.push(params.force);
				}
				const result = await execLua<ReloadResult>(client, "file", "reload", reloadArgs);
				if (!result.ok) {
					const reason = result.modified
						? `refused: buffer ${params.bufnr} has unsaved changes; pass force to discard them`
						: `refused: ${result.error ?? "unknown reason"}`;
					return { content: [{ type: "text", text: reason }], details: result };
				}
				return {
					content: [
						{
							type: "text",
							text: `reloaded bufnr ${params.bufnr} (${result.lines} lines, changedtick ${result.changedtick})`,
						},
					],
					details: result,
				};
			}

			requireCapability("nvim.buffer.delete");
			const deleteArgs: unknown[] = [params.bufnr];
			if (params.force !== undefined) {
				deleteArgs.push(params.force);
			}
			const result = await execLua<DeleteResult>(client, "buffers", "delete", deleteArgs);
			if (!result.ok) {
				const reason = result.modified
					? `refused: buffer ${params.bufnr} has unsaved changes; pass force to discard them`
					: `refused: ${result.error ?? "unknown reason"}`;
				return { content: [{ type: "text", text: reason }], details: result };
			}
			return {
				content: [{ type: "text", text: `deleted bufnr ${params.bufnr}` }],
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

interface FocusResult {
	ok: boolean;
	win?: number;
	error?: string;
}

interface CloseResult {
	ok: boolean;
	error?: string;
}

function registerWindowTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_window",
		label: "Inspect or manage nvim windows",
		description:
			"Act on the editor's windows. `layout` reports every window across every tab, the focused window and pi's stage window. `focus` moves the human's focus to a window (the one verb that deliberately does so). `close` closes a window pi owns, and refuses any window pi did not create so the human's windows are never closed out from under them.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("layout"), Type.Literal("focus"), Type.Literal("close")], {
				description:
					"Report the layout (`layout`), move focus to a window (`focus`) or close a pi-owned window (`close`).",
			}),
			win: Type.Optional(
				Type.Number({
					description:
						"Window handle for `focus` and `close`. Use a handle from `layout` or an open result.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);

			if (params.action === "layout") {
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
			}

			if (params.win === undefined) {
				throw new Error(`${params.action} requires \`win\``);
			}

			if (params.action === "focus") {
				requireCapability("nvim.window.focus");
				const result = await execLua<FocusResult>(client, "window", "focus", [params.win]);
				if (!result.ok) {
					return {
						content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
						details: result,
					};
				}
				return {
					content: [{ type: "text", text: `focused window ${result.win}` }],
					details: result,
				};
			}

			requireCapability("nvim.window.close");
			const result = await execLua<CloseResult>(client, "window", "close", [params.win]);
			if (!result.ok) {
				return {
					content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
					details: result,
				};
			}
			return {
				content: [{ type: "text", text: `closed window ${params.win}` }],
				details: result,
			};
		},
	});
}

interface CursorInfo {
	win: number;
	bufnr: number;
	name: string;
	line: number;
	col: number;
	mode: string;
}

interface Selection {
	win: number;
	bufnr: number;
	kind: string;
	start: { line: number; col: number };
	finish: { line: number; col: number };
	text: string;
	empty: boolean;
}

function registerCursorTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_cursor",
		label: "Read or move the cursor and selection in nvim",
		description:
			"Read or move the cursor, read the human's visual selection, and check whose turn it is. `get` reports where the cursor is, defaulting to the window you are focused on. `set` moves the cursor in a named window: pass `win` deliberately, since pi otherwise never moves the human's cursor. `get_selection` returns the human's visual selection, the live one while they are selecting and the last completed one otherwise, so you can act on what they highlighted. `turn` reports whether the human is actively typing, so you can defer edits to a buffer they share with you until they pause.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("get"),
					Type.Literal("set"),
					Type.Literal("get_selection"),
					Type.Literal("turn"),
				],
				{
					description:
						"Read the cursor (`get`), move it in a window (`set`), read the visual selection (`get_selection`) or check whose turn it is (`turn`).",
				},
			),
			win: Type.Optional(
				Type.Number({
					description:
						"Window handle. `get` and `get_selection` default to the focused window; `set` requires it.",
				}),
			),
			line: Type.Optional(Type.Number({ description: "1-indexed line for `set`." })),
			col: Type.Optional(
				Type.Number({ description: "0-indexed byte column for `set`; defaults to 0." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);

			if (params.action === "turn") {
				// Read-only inference over pi's own cursor cache; no
				// nvim round trip and no capability gate, since nothing
				// is asked of the peer. void the unused client so the
				// pairing check above still runs for every action.
				void client;
				const state = turnState();
				const verdict = state.typing
					? "the human is typing — defer edits to a buffer you share with them"
					: state.humanActive
						? "the human is active — proceed with care"
						: "no recent human activity — your turn";
				const since = state.msSinceMove === null ? "never" : `${state.msSinceMove}ms ago`;
				return {
					content: [
						{ type: "text", text: `${verdict} (mode ${state.mode ?? "?"}, last move ${since})` },
					],
					details: state,
				};
			}

			if (params.action === "get") {
				requireCapability("nvim.cursor.get");
				const info = await execLua<CursorInfo>(client, "cursor", "get", [params.win ?? 0]);
				return {
					content: [
						{
							type: "text",
							text: `cursor at ${info.line}:${info.col} in bufnr ${info.bufnr} (window ${info.win}, mode ${info.mode})`,
						},
					],
					details: info,
				};
			}

			if (params.action === "get_selection") {
				requireCapability("nvim.cursor.selection.get");
				const sel = await execLua<Selection>(client, "cursor", "get_selection", [params.win ?? 0]);
				if (sel.empty) {
					return { content: [{ type: "text", text: "no visual selection" }], details: sel };
				}
				const span = `${sel.start.line}:${sel.start.col} to ${sel.finish.line}:${sel.finish.col}`;
				return {
					content: [
						{
							type: "text",
							text: `${sel.kind} selection ${span} in bufnr ${sel.bufnr}\n${sel.text}`,
						},
					],
					details: sel,
				};
			}

			if (params.win === undefined) {
				throw new Error(
					"set requires `win`: name the window to move, since pi does not move the human's cursor by default.",
				);
			}
			if (params.line === undefined) {
				throw new Error("set requires `line`");
			}
			requireCapability("nvim.window.cursor.set");
			const col = params.col ?? 0;
			await execLua(client, "cursor", "set", [params.win, params.line, col]);
			return {
				content: [
					{ type: "text", text: `moved cursor to ${params.line}:${col} in window ${params.win}` },
				],
				details: { win: params.win, line: params.line, col },
			};
		},
	});
}

interface DiffSide {
	win: number;
	bufnr: number;
}

interface DiffFilesResult {
	left: DiffSide;
	right: DiffSide;
}

interface DiffOffResult {
	ok: boolean;
	error?: string;
}

function registerDiffTool(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_diff",
		label: "Show a diff in nvim",
		description:
			"Show a side-by-side diff in windows pi owns, never the window you are focused on. `files` diffs two real files against each other. `off` ends the diff in a pi-owned window; pair it with `nvim_window close` to remove the window afterwards. This is a view and changes neither file.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("files"), Type.Literal("off")], {
				description: "Diff two files (`files`) or end a diff in a window (`off`).",
			}),
			left: Type.Optional(Type.String({ description: "Path to the left file for `files`." })),
			right: Type.Optional(Type.String({ description: "Path to the right file for `files`." })),
			win: Type.Optional(Type.Number({ description: "Window handle for `off`." })),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);

			if (params.action === "files") {
				requireCapability("nvim.diff.files");
				if (params.left === undefined || params.right === undefined) {
					throw new Error("files requires `left` and `right` paths");
				}
				const result = await execLua<DiffFilesResult>(client, "diff", "files", [
					params.left,
					params.right,
				]);
				return {
					content: [
						{
							type: "text",
							text: `diffing ${params.left} (win ${result.left.win}) against ${params.right} (win ${result.right.win})`,
						},
					],
					details: result,
				};
			}

			requireCapability("nvim.diff.off");
			if (params.win === undefined) {
				throw new Error("off requires `win`");
			}
			const result = await execLua<DiffOffResult>(client, "diff", "off", [params.win]);
			if (!result.ok) {
				return {
					content: [{ type: "text", text: `refused: ${result.error ?? "unknown reason"}` }],
					details: result,
				};
			}
			return {
				content: [{ type: "text", text: `diff off in window ${params.win}` }],
				details: result,
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

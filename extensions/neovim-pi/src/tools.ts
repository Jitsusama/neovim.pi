/**
 * Pi tools the agent calls to drive nvim.
 *
 * Each tool is a thin wrapper around an `nvim.*`
 * capability. The agent doesn't see the wire protocol;
 * it sees `nvim.buffer.open` as a tool with typed
 * parameters.
 *
 * The list here is intentionally small. The companion's
 * job is plumbing, not a full nvim API. Other pi
 * extensions register higher-level tools (like
 * `pr.threads.list`) that use the lib to read state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NeovimClient } from "neovim";
import { Type } from "typebox";

type ClientResolver = () => NeovimClient | null;

/** Register the always-on tools that drive the nvim peer. */
export function registerNvimTools(pi: ExtensionAPI, getClient: ClientResolver): void {
	pi.registerTool({
		name: "nvim_buffer_open",
		label: "Open buffer in nvim",
		description: "Open a `pi://` URI as a buffer in the paired neovim instance.",
		parameters: Type.Object({
			uri: Type.String({ description: "The `pi://` URI to open." }),
			focus: Type.Optional(
				Type.Boolean({ description: "Move the user's cursor to this buffer. Default: true." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			const focus = params.focus ?? true;
			await client.request("nvim_exec_lua", [
				`return require("neovim-pi.buffer").open(...)`,
				[params.uri, focus],
			]);
			return {
				content: [{ type: "text", text: `opened ${params.uri} in nvim` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "nvim_buffer_close",
		label: "Close buffer in nvim",
		description: "Close a `pi://` buffer in nvim. No-op if the buffer is absent.",
		parameters: Type.Object({
			uri: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			await client.request("nvim_exec_lua", [
				`return require("neovim-pi.buffer").close(...)`,
				[params.uri],
			]);
			return {
				content: [{ type: "text", text: `closed ${params.uri}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "nvim_buffer_is_modified",
		label: "Check buffer dirty state",
		description: "Return true if any nvim buffer pointing at this path has unsaved changes.",
		parameters: Type.Object({
			path: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			const dirty = (await client.request("nvim_exec_lua", [
				`return require("neovim-pi.buffer").is_modified(...)`,
				[params.path],
			])) as boolean;
			return {
				content: [{ type: "text", text: dirty ? "modified" : "clean" }],
				details: { modified: dirty },
			};
		},
	});

	pi.registerTool({
		name: "nvim_buffer_reload",
		label: "Reload buffer from disk",
		description: "Force-reload buffers that point at a path so they pick up agent edits.",
		parameters: Type.Object({
			path: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const client = requireClient(getClient);
			await client.request("nvim_exec_lua", [
				`return require("neovim-pi.buffer").reload(...)`,
				[params.path],
			]);
			return {
				content: [{ type: "text", text: `reloaded ${params.path}` }],
				details: {},
			};
		},
	});
}

function requireClient(get: ClientResolver): NeovimClient {
	const client = get();
	if (!client) {
		throw new Error("nvim is not attached; run :PiAttach in neovim, then retry.");
	}
	return client;
}

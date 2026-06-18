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
}

function requireClient(get: ClientResolver): NeovimClient {
	const client = get();
	if (!client) {
		throw new Error("no nvim paired with this pi session; call `nvim_attach` to pair, then retry.");
	}
	return client;
}

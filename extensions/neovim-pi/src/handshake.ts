/**
 * Capability handshake.
 *
 * Right after attach, both sides advertise their feature
 * set. The handshake is a single RPC each way:
 *
 *   pi  → nvim : `pi.hello`    { version, capabilities }
 *   nvim → pi  : `nvim.hello`  { version, capabilities }
 *
 * Capabilities are additive flag names. Unknown flags
 * are silently ignored; missing flags degrade
 * gracefully. The spec for each flag lives in
 * `doc/capabilities.md`.
 */

import type { NeovimClient } from "neovim";

/** Wire version this implementation speaks. */
export const PROTOCOL_VERSION = "0.1.0";

/** Capabilities this pi extension advertises. */
export const PI_CAPABILITIES: readonly string[] = [
	"pi.session.get",
	"pi.session.subscribe",
	"pi.tool.list",
	"pi.tool.invoke",
	"pi.status.subscribe",
	"pi.prompt.append",
	"pi.buffer.uri.resolve",
];

/** Capabilities the nvim peer is expected to expose (best-effort check). */
export const EXPECTED_NVIM_CAPABILITIES: readonly string[] = [
	"nvim.buffer.open",
	"nvim.buffer.close",
	"nvim.buffer.markStale",
	"nvim.buffer.isModified",
	"nvim.buffer.reload",
	"nvim.window.cursor.set",
	"nvim.extmark.set",
	"nvim.extmark.clear",
	"nvim.file.open",
	"nvim.file.save",
	"nvim.text.getRange",
	"nvim.text.setRange",
	"nvim.window.layout",
	"nvim.buffer.list",
];

export interface PeerInfo {
	version: string;
	capabilities: string[];
}

let peer: PeerInfo | null = null;

/** Returns the peer's last-seen handshake info. */
export function getPeerInfo(): PeerInfo | null {
	return peer;
}

/**
 * Send our hello and receive nvim's. Throws on protocol mismatch.
 *
 * `nvim_get_api_info` returns `[channelId, apiMetadata]`. We pass
 * the channel id into the lua handshake so nvim can call back
 * into us via `vim.rpcrequest`/`rpcnotify`.
 */
export async function performHandshake(client: NeovimClient): Promise<PeerInfo> {
	const apiInfo = (await client.request("nvim_get_api_info", [])) as [number, unknown];
	const channelId = apiInfo[0];

	const response = (await client.request("nvim_exec_lua", [
		`return require("neovim-pi.handshake").exchange(...)`,
		[PROTOCOL_VERSION, PI_CAPABILITIES, channelId],
	])) as PeerInfo;

	if (!response?.version) {
		throw new Error("nvim handshake returned no version");
	}

	peer = response;
	return response;
}

/** Returns true when the peer advertised a capability. */
export function peerHas(capability: string): boolean {
	return peer?.capabilities.includes(capability) ?? false;
}

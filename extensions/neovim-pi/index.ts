/**
 * neovim-pi: bidirectional pi ↔ neovim bridge.
 *
 * Discovers a running nvim socket, attaches over
 * msgpack-rpc, exchanges a capability handshake and
 * stands up a method registry. Other pi extensions can
 * reach the live client via the public API exported
 * from `../../lib/`.
 *
 * Lifecycle:
 *   session_start    → attach (idempotent; respects reason)
 *   session_shutdown → close socket, drop client cache
 *
 * Registration is the only thing this file does. Every
 * substantive concern lives in `src/`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { attachToNeovim, detachFromNeovim, getClient } from "./src/attach.js";
import { registerNvimTools } from "./src/tools.js";

export default async function (pi: ExtensionAPI) {
	// -- Lifecycle: attach on session start, detach on shutdown --

	pi.on("session_start", async (_event, ctx) => {
		try {
			await attachToNeovim();
			ctx.ui.setStatus("nvim", "attached");
		} catch (err) {
			// Non-fatal: pi works fine without nvim. We just won't
			// be able to open `pi://` buffers in nvim until the
			// user runs :PiAttach or a fresh socket appears.
			const reason = err instanceof Error ? err.message : String(err);
			ctx.ui.setStatus("nvim", `not attached (${reason})`);
		}
	});

	pi.on("session_shutdown", async () => {
		await detachFromNeovim();
	});

	// -- Tools the agent can call to drive nvim --

	registerNvimTools(pi, () => getClient());

	// -- /nvim-status command: quick health check --

	pi.registerCommand("nvim-status", {
		description: "Show the current pi ↔ nvim connection status.",
		handler: async (_args, ctx) => {
			const client = getClient();
			if (!client) {
				ctx.ui.notify("nvim: not attached", "info");
				return;
			}
			const channelId = await client.channelId;
			ctx.ui.notify(`nvim: attached (channel ${channelId})`, "success");
		},
	});
}

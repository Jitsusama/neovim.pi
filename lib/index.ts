/**
 * Public types and helpers for pi extensions that want
 * to talk to a paired neovim session.
 *
 * The `neovim-pi` extension owns the connection
 * lifecycle, one per conversation. This lib exposes the
 * public surface other extensions consume: types,
 * capability flags, what a paired client's plugin
 * advertised, and the pieces a conversation's pairing is
 * built from.
 *
 * It holds no pairing of its own. A host runs many
 * conversations in one process, so a module-level "the
 * client" could not say whose it was; a caller that has
 * a client asks about that client.
 *
 * Import as:
 *
 *   import { peerHas, type PeerInfo } from "neovim.pi/lib";
 *
 * **Cross-package callers** can't import this lib because
 * pi loads packages with isolated module roots. They use
 * the `pi.events` bridge instead, which reaches the
 * conversation whose bus they emit on:
 *
 *   pi.events.emit("neovim-pi:register-handler", {
 *     method: "buffer.uri.resolve",
 *     handler: async (args) => ({ lines: ["hello"] }),
 *   });
 *
 * Re-emit on receipt of `neovim-pi:ready` to handle the
 * case where neovim-pi loads after your extension.
 * See `doc/protocol.md` for the full contract.
 */

export { type Connection, createConnection } from "../extensions/neovim-pi/src/attach.ts";
export {
	EXPECTED_NVIM_CAPABILITIES,
	getPeerInfo,
	type PeerInfo,
	PI_CAPABILITIES,
	PROTOCOL_VERSION,
	peerHas,
} from "../extensions/neovim-pi/src/handshake.ts";
export { createRegistry, type Registry } from "../extensions/neovim-pi/src/registry.ts";
export { createStatus, type Status } from "../extensions/neovim-pi/src/status.ts";

/**
 * Public types and helpers for pi extensions that want
 * to talk to a paired neovim session.
 *
 * The `neovim-pi` extension owns the connection
 * lifecycle. This lib exposes the public surface other
 * extensions consume: types, capability flags, the
 * method-registration helper.
 *
 * Import as:
 *
 *   import { addMethod, isAttached, getClient } from "neovim.pi/lib";
 */

export {
	EXPECTED_NVIM_CAPABILITIES,
	getPeerInfo,
	type PeerInfo,
	PI_CAPABILITIES,
	PROTOCOL_VERSION,
	peerHas,
} from "../extensions/neovim-pi/src/handshake.js";
export { addMethod, removeMethod } from "../extensions/neovim-pi/src/registry.js";
export {
	composeStatus,
	setFragment,
	subscribe as subscribeStatus,
} from "../extensions/neovim-pi/src/status.js";

import { getClient as _getClient, getPairedSocket } from "../extensions/neovim-pi/src/attach.js";

/** Returns the live NeovimClient, or null if not attached. */
export const getClient = _getClient;

/** Returns true when pi is currently paired with nvim. */
export function isAttached(): boolean {
	return _getClient() !== null;
}

/** Returns the socket path of the current pairing, or null. */
export { getPairedSocket };

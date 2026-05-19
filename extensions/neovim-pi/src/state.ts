/**
 * Session-persistent pairing memory.
 *
 * Pairings survive `/reload` so the user doesn't have
 * to reattach on every code change. We use pi's session
 * entry log (`pi.appendEntry`) as the storage substrate:
 * each attach appends a pairing entry, each detach
 * appends a null entry. On session_start we walk newest
 * first and honour the most recent record.
 *
 * State is per-session, not global. Different pi
 * sessions can pair with different nvim instances
 * without interfering.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Custom entry type for our pairing log. */
export const PAIRING_ENTRY_TYPE = "neovim-pi:pairing";

interface PairingRecord {
	/** Absolute socket path, or null when explicitly detached. */
	socket: string | null;
}

/** Record an attach in the session log. */
export function rememberPairing(pi: ExtensionAPI, socket: string): void {
	pi.appendEntry(PAIRING_ENTRY_TYPE, { socket } satisfies PairingRecord);
}

/** Record a detach in the session log. */
export function forgetPairing(pi: ExtensionAPI): void {
	pi.appendEntry(PAIRING_ENTRY_TYPE, { socket: null } satisfies PairingRecord);
}

/**
 * Read the most recent pairing intent from the session
 * log. Returns the socket path the user last attached
 * to, or null if they detached or never attached.
 */
export function lastPairing(ctx: ExtensionContext): string | null {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "custom") continue;
		if (entry.customType !== PAIRING_ENTRY_TYPE) continue;

		const data = entry.data as PairingRecord | undefined;
		return data?.socket ?? null;
	}
	return null;
}

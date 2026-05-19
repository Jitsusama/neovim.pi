/**
 * Connection lifecycle: attach, detach, accessor.
 *
 * Pairing is always explicit: the caller supplies a
 * socket path. Discovery and selection live in
 * `discovery.ts` and the `nvim_attach` tool.
 *
 * The neovim npm package monkey-patches `console`; we
 * pass a no-op logger via `attach()` to opt out.
 */

import type { NeovimClient } from "neovim";
import { attach } from "neovim";
import { performHandshake } from "./handshake.js";
import { silentLogger } from "./logger.js";
import { registerHandlers } from "./registry.js";

let client: NeovimClient | null = null;
let pairedSocket: string | null = null;

/** Returns the currently attached client, or null if unattached. */
export function getClient(): NeovimClient | null {
	return client;
}

/** Returns the socket path of the current pairing, or null. */
export function getPairedSocket(): string | null {
	return pairedSocket;
}

/**
 * Attach to a specific nvim socket. Throws if already
 * attached to a different socket (caller must detach
 * first); idempotent when the path matches.
 */
export async function attachToSocket(socket: string): Promise<NeovimClient> {
	if (client && pairedSocket === socket) return client;
	if (client) {
		throw new Error(`already paired with ${pairedSocket}; detach first to switch to ${socket}`);
	}

	const next = attach({ socket, options: { logger: silentLogger() } });
	registerHandlers(next);
	await performHandshake(next);

	next.on("disconnect", () => {
		if (client === next) {
			client = null;
			pairedSocket = null;
		}
	});

	client = next;
	pairedSocket = socket;
	return next;
}

/**
 * Detach and release the connection. Safe to call
 * multiple times.
 *
 * The npm `neovim` package exposes `client.quit()`, but
 * that sends `:qa!` to nvim and kills the user's
 * editor. We never want that. Close our side of the
 * socket directly so nvim sees an EOF on its channel
 * and detaches the peer without exiting.
 */
export async function detachFromNeovim(): Promise<void> {
	if (!client) return;
	const c = client;
	client = null;
	pairedSocket = null;
	try {
		const stream = (c as unknown as { transport?: { _stream?: { end?: () => void } } }).transport
			?._stream;
		stream?.end?.();
	} catch {
		// Best-effort: dropping our reference lets GC reclaim the
		// socket eventually. Nvim will see an idle channel until
		// then, which is harmless (no commands flow through it).
	}
}

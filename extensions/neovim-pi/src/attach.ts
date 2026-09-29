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
import { connectTo, type Link } from "./connection.js";
import { clearCursor } from "./cursor.js";
import { performHandshake } from "./handshake.js";
import { silentLogger } from "./logger.js";
import { registerHandlers } from "./registry.js";

/**
 * How long a connected nvim has to finish the handshake.
 *
 * A remembered pairing is retried at session start, which waits on
 * it, so a socket that accepts and never answers would hold the
 * session there for good. A live nvim answers in milliseconds.
 */
export const ATTACH_TIMEOUT_MS = 5000;

let client: NeovimClient | null = null;
let pairedSocket: string | null = null;
let link: Link | null = null;

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

	const opened = await connectTo(socket);
	const next = attach({
		reader: opened.reader,
		writer: opened.writer,
		options: { logger: silentLogger() },
	});
	registerHandlers(next);
	try {
		await answered(greet(next), opened, `handshake on ${socket}`);
	} catch (error) {
		opened.close();
		throw error;
	}

	next.on("disconnect", () => {
		if (client === next) {
			client = null;
			pairedSocket = null;
			link = null;
		}
	});

	client = next;
	pairedSocket = socket;
	link = opened;
	return next;
}

/** The handshake, then the start of the cursor stream. */
async function greet(next: NeovimClient): Promise<void> {
	await performHandshake(next);

	// Begin the human-cursor push stream. The receiver was wired
	// at activation (installCursorStream); this tells nvim to
	// start emitting debounced CursorMoved/CursorMovedI snapshots.
	// Best-effort: an nvim whose plugin predates the stream just
	// errors, which we swallow so pairing still succeeds.
	try {
		await next.request("nvim_exec_lua", ['require("neovim-pi.cursor").watch()', []]);
	} catch {
		// No cursor stream on this nvim; degrade quietly.
	}
}

/**
 * The work's answer, or a failure once the socket hangs up or the
 * clock runs out. The client never settles a request whose socket
 * closed, so without the first a hang-up would wait out the clock.
 */
async function answered(work: Promise<unknown>, opened: Link, what: string): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const clock = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`nvim did not answer the ${what} within ${ATTACH_TIMEOUT_MS}ms`)),
			ATTACH_TIMEOUT_MS,
		);
	});
	const hangup = opened.closed.then(() => {
		throw new Error(`nvim hung up during the ${what}`);
	});
	try {
		await Promise.race([work, hangup, clock]);
	} finally {
		clearTimeout(timer);
	}
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
	const opened = link;
	client = null;
	pairedSocket = null;
	link = null;

	// Drop the cached human cursor; a stale position must not
	// outlive the pairing. We reach here only on a clean detach
	// (the disconnect handler nulls `client` first, so this
	// function returns early in that path), so the socket is
	// still live and the reset request completes promptly.
	clearCursor();
	try {
		// reset() drops the nvim-side ownership ledger, forgets pi's
		// stage windows and stops the cursor stream. Without this the
		// ledger and stage_win outlive the pairing, and because nvim
		// reuses buffer numbers a reattach could green-light
		// reload/delete --force on what is now the human's buffer.
		// Bounded like the handshake, since a session's shutdown
		// waits on this and a hung nvim would hold it for good.
		const reset = c.request("nvim_exec_lua", ['require("neovim-pi").reset()', []]);
		await (opened ? answered(reset, opened, "reset") : reset);
	} catch {
		// nvim may already be tearing down; the stream is harmless
		// if it lingers, and a later attach re-clears the augroup.
	}
	opened?.close();
}

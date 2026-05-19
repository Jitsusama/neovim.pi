/**
 * Socket discovery and msgpack-rpc attach lifecycle.
 *
 * Discovery order:
 *   1. `$NVIM_LISTEN_ADDRESS`
 *   2. `$XDG_RUNTIME_DIR/neovim-pi.sock`
 *   3. `$XDG_RUNTIME_DIR/nvim.*.sock` (newest)
 *
 * The connection is held in module scope so other files
 * in the extension can read it via `getClient()`. The
 * neovim npm package monkey-patches `console`; we pass
 * a no-op logger via `attach()` to opt out.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NeovimClient } from "neovim";
import { attach } from "neovim";
import { performHandshake } from "./handshake.js";
import { silentLogger } from "./logger.js";
import { registerHandlers } from "./registry.js";

let client: NeovimClient | null = null;

/** Returns the currently attached client, or null if unattached. */
export function getClient(): NeovimClient | null {
	return client;
}

/** Attach to a running nvim socket. Idempotent. */
export async function attachToNeovim(): Promise<NeovimClient> {
	if (client) return client;

	const socket = await findSocket();
	if (!socket) {
		throw new Error("no nvim socket found");
	}

	client = attach({ socket, options: { logger: silentLogger() } });

	registerHandlers(client);
	await performHandshake(client);

	client.on("disconnect", () => {
		client = null;
	});

	return client;
}

/**
 * Detach and release the connection. Safe to call multiple times.
 *
 * The npm `neovim` package exposes `client.quit()`, but that
 * sends `:qa!` to nvim and kills the user's editor. We never
 * want that. Close our side of the socket directly so nvim
 * sees an EOF on its channel and detaches the peer without
 * exiting.
 */
export async function detachFromNeovim(): Promise<void> {
	if (!client) return;
	const c = client;
	client = null;
	try {
		// The neovim client wraps a node `net.Socket` (or stdio) on
		// `transport._stream`. End it ourselves; if the internal shape
		// changes upstream, the catch below keeps us safe.
		const stream = (c as unknown as { transport?: { _stream?: { end?: () => void } } }).transport
			?._stream;
		stream?.end?.();
	} catch {
		// Best-effort: dropping our reference lets GC reclaim the
		// socket eventually. Nvim will see an idle channel until then,
		// which is harmless (no commands flow through it).
	}
}

/** Find the socket to attach to. Returns null if none. */
async function findSocket(): Promise<string | null> {
	if (process.env.NVIM_LISTEN_ADDRESS) {
		return process.env.NVIM_LISTEN_ADDRESS;
	}

	const xdgRuntime = process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".local", "state", "pi");

	// Preferred fixed name (the nvim plugin writes this by default).
	const preferred = join(xdgRuntime, "neovim-pi.sock");
	if (await exists(preferred)) return preferred;

	// Fall back to any `nvim.*.sock` in the runtime dir, newest first.
	try {
		const entries = await fs.readdir(xdgRuntime, { withFileTypes: true });
		const sockets = entries
			.filter((e) => e.name.startsWith("nvim.") && e.name.endsWith(".sock"))
			.map((e) => join(xdgRuntime, e.name));
		if (sockets.length === 0) return null;

		const stats = await Promise.all(
			sockets.map(async (p) => ({ p, m: (await fs.stat(p)).mtimeMs })),
		);
		stats.sort((a, b) => b.m - a.m);
		return stats[0]?.p ?? null;
	} catch {
		return null;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

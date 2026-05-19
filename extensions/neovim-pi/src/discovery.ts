/**
 * Socket discovery for paired-nvim selection.
 *
 * The nvim plugin defaults to listening on
 * `~/.local/state/pi/nvim-<pid>.sock`. We enumerate the
 * pi state dir for any socket files matching that
 * pattern and report metadata the agent can show the
 * user when picking which nvim to pair with.
 *
 * `$XDG_RUNTIME_DIR` is respected when set (Linux);
 * otherwise we fall back to `~/.local/state/pi`, which
 * matches the lua plugin's default.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SocketCandidate {
	/** Absolute path to the socket file. */
	socket: string;
	/** PID parsed from the socket filename, if present. */
	pid: number | null;
	/** mtime of the socket file in epoch milliseconds. */
	mtimeMs: number;
}

/** Directory the nvim plugin and pi both look at. */
export function stateDir(): string {
	return process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".local", "state", "pi");
}

/**
 * List all sockets that look like an `neovim-pi`-aware nvim.
 *
 * Matches files of the form `nvim-<pid>.sock` (the plugin
 * default) and the legacy `neovim-pi.sock` if anything
 * still uses it. Sorted newest first.
 */
export async function listSocketCandidates(): Promise<SocketCandidate[]> {
	const dir = stateDir();

	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const candidates: SocketCandidate[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".sock")) continue;
		if (!entry.name.startsWith("nvim-") && entry.name !== "neovim-pi.sock") continue;

		const socket = join(dir, entry.name);

		let mtimeMs = 0;
		try {
			mtimeMs = (await fs.stat(socket)).mtimeMs;
		} catch {
			// Stat can race with cleanup; skip this candidate.
			continue;
		}

		const pidMatch = entry.name.match(/^nvim-(\d+)\.sock$/);
		const pid = pidMatch?.[1] ? Number.parseInt(pidMatch[1], 10) : null;

		candidates.push({ socket, pid, mtimeMs });
	}

	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return candidates;
}

/** Returns true when the path is a live socket on disk. */
export async function socketExists(path: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path);
		return stat.isSocket();
	} catch {
		return false;
	}
}

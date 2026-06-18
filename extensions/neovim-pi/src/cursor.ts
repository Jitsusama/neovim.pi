/**
 * Human-cursor cache.
 *
 * The nvim side pushes a debounced snapshot of the human's
 * cursor on every move (see `lua/neovim-pi/cursor.lua` and
 * the `nvim.cursor.stream` capability). This module is the
 * receiving end: it caches the latest snapshot so pi can
 * answer "where is the human, and were they just typing?"
 * without a round trip. The turn-taking rule reads it.
 */

import { addNotificationHandler } from "./registry.js";

export interface CursorSnapshot {
	win: number;
	bufnr: number;
	name: string;
	line: number;
	col: number;
	mode: string;
	source: string;
	/** Local epoch ms when pi received the push. */
	receivedAt: number;
}

export type CursorPayload = Omit<CursorSnapshot, "receivedAt">;

let cached: CursorSnapshot | null = null;

/** Store the latest pushed cursor snapshot, stamped now. */
export function recordCursor(payload: CursorPayload): void {
	cached = { ...payload, receivedAt: Date.now() };
}

/** Return the most recent cursor snapshot, or null. */
export function lastCursor(): CursorSnapshot | null {
	return cached;
}

/** Drop the cached cursor (on detach, or between sessions). */
export function clearCursor(): void {
	cached = null;
}

/**
 * Wire the `cursor.moved` notification into the cache. The
 * lua side pushes one positional argument: the snapshot
 * table, which the dispatcher hands us as `args[0]`.
 */
export function installCursorStream(): void {
	addNotificationHandler("cursor.moved", (args) => {
		const payload = args[0] as CursorPayload | undefined;
		if (payload) recordCursor(payload);
	});
}

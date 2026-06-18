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

export interface TurnState {
	/** A cursor push arrived within the recency window. */
	humanActive: boolean;
	/** ...and that push was in an insert mode. */
	typing: boolean;
	mode: string | null;
	/** Milliseconds since the last push, or null if none. */
	msSinceMove: number | null;
	/** The human's focused buffer at the last push, or null. */
	bufnr: number | null;
}

/**
 * Infer whether the human is mid-turn from the cached push.
 *
 * The stream only emits on a move, so a push that landed
 * within `withinMs` means the human just moved or typed and
 * the turn is theirs; silence past that window means they
 * have likely paused and pi may proceed. `typing` narrows
 * that to insert modes, where an edit from pi is most likely
 * to collide with the keystroke in flight. The clock is
 * pi's own (`receivedAt` was stamped on receipt), so `now`
 * and the stamp share a frame.
 */
export function turnState(withinMs = 1500, now = Date.now()): TurnState {
	if (!cached) {
		return { humanActive: false, typing: false, mode: null, msSinceMove: null, bufnr: null };
	}
	const msSinceMove = now - cached.receivedAt;
	const humanActive = msSinceMove < withinMs;
	return {
		humanActive,
		typing: humanActive && cached.mode.startsWith("i"),
		mode: cached.mode,
		msSinceMove,
		bufnr: cached.bufnr,
	};
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

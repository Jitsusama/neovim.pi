/**
 * Human-cursor cache.
 *
 * The nvim side pushes a debounced snapshot of the human's
 * cursor on every move (see `lua/neovim-pi/cursor.lua` and
 * the `nvim.cursor.stream` capability). This module is the
 * receiving end: it caches the latest snapshot so pi can
 * answer "where is the human, and were they just typing?"
 * without a round trip. The turn-taking rule reads it.
 *
 * Each snapshot is kept against the client it came in on,
 * so it belongs to that pairing alone: a host runs many
 * conversations in one process, each paired with its own
 * nvim, and one's human must never read as another's.
 */

import type { NeovimClient } from "neovim";
import type { Registry } from "./registry.ts";

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

/** Each pairing's latest snapshot, gone with its client. */
const cursors = new WeakMap<NeovimClient, CursorSnapshot>();

/** Store the latest snapshot a client pushed, stamped now. */
export function recordCursor(client: NeovimClient, payload: CursorPayload): void {
	cursors.set(client, { ...payload, receivedAt: Date.now() });
}

/** Return the most recent snapshot a client pushed, or null. */
export function lastCursor(client: NeovimClient): CursorSnapshot | null {
	return cursors.get(client) ?? null;
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
export function turnState(client: NeovimClient, withinMs = 1500, now = Date.now()): TurnState {
	const cached = cursors.get(client);
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

/** Drop a pairing's cached cursor (on detach). */
export function clearCursor(client: NeovimClient): void {
	cursors.delete(client);
}

/**
 * Wire the `cursor.moved` notification into the cache. The
 * lua side pushes one positional argument: the snapshot
 * table, which the dispatcher hands us as `args[0]`.
 */
export function installCursorStream(registry: Registry): void {
	registry.addNotificationHandler("cursor.moved", (args, client) => {
		const payload = args[0] as CursorPayload | undefined;
		if (payload) recordCursor(client, payload);
	});
}

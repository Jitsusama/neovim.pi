import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearCursor,
	type CursorSnapshot,
	installCursorStream,
	lastCursor,
	recordCursor,
	turnState,
} from "../../extensions/neovim-pi/src/cursor.js";
import {
	registerHandlers,
	removeNotificationHandler,
} from "../../extensions/neovim-pi/src/registry.js";

function fakeClient(): { emitNotification: (method: string, args: unknown[]) => void } {
	const emitter = new EventEmitter();
	registerHandlers(emitter as unknown as NeovimClient);
	return {
		emitNotification: (method, args) => emitter.emit("notification", method, args),
	};
}

const sample: Omit<CursorSnapshot, "receivedAt"> = {
	win: 1,
	bufnr: 2,
	name: "/work/foo.ts",
	line: 5,
	col: 3,
	mode: "n",
	source: "human",
};

describe("cursor cache", () => {
	beforeEach(() => clearCursor());
	afterEach(() => removeNotificationHandler("cursor.moved"));

	it("starts empty", () => {
		expect(lastCursor()).toBeNull();
	});

	it("records the latest snapshot stamped with receivedAt", () => {
		recordCursor(sample);
		const last = lastCursor();
		expect(last?.line).toBe(5);
		expect(last?.source).toBe("human");
		expect(typeof last?.receivedAt).toBe("number");
	});

	it("keeps the most recent push, replacing the prior one", () => {
		recordCursor(sample);
		recordCursor({ ...sample, line: 42 });
		expect(lastCursor()?.line).toBe(42);
	});

	it("caches a cursor.moved notification once the stream is installed", () => {
		installCursorStream();
		const { emitNotification } = fakeClient();
		emitNotification("pi.dispatch", ["cursor.moved", { ...sample, line: 9 }]);
		expect(lastCursor()?.line).toBe(9);
	});
});

describe("turnState", () => {
	beforeEach(() => clearCursor());

	it("reports no activity when nothing has been pushed", () => {
		const state = turnState();
		expect(state.humanActive).toBe(false);
		expect(state.typing).toBe(false);
		expect(state.msSinceMove).toBeNull();
		expect(state.mode).toBeNull();
	});

	it("flags the human active and typing on a recent insert-mode push", () => {
		recordCursor({ ...sample, mode: "i" });
		const at = lastCursor()?.receivedAt ?? 0;
		const state = turnState(1500, at + 100);
		expect(state.humanActive).toBe(true);
		expect(state.typing).toBe(true);
		expect(state.mode).toBe("i");
		expect(state.bufnr).toBe(sample.bufnr);
	});

	it("flags active but not typing on a recent normal-mode push", () => {
		recordCursor({ ...sample, mode: "n" });
		const at = lastCursor()?.receivedAt ?? 0;
		const state = turnState(1500, at + 100);
		expect(state.humanActive).toBe(true);
		expect(state.typing).toBe(false);
	});

	it("goes quiet once the push falls outside the recency window", () => {
		recordCursor({ ...sample, mode: "i" });
		const at = lastCursor()?.receivedAt ?? 0;
		const state = turnState(1500, at + 5000);
		expect(state.humanActive).toBe(false);
		expect(state.typing).toBe(false);
		expect(state.msSinceMove).toBe(5000);
	});
});

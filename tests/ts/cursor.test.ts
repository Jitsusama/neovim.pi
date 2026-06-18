import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearCursor,
	type CursorSnapshot,
	installCursorStream,
	lastCursor,
	recordCursor,
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

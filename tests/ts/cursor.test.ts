import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import {
	clearCursor,
	type CursorSnapshot,
	installCursorStream,
	lastCursor,
	recordCursor,
	turnState,
} from "../../extensions/neovim-pi/src/cursor.js";
import { createRegistry, type Registry } from "../../extensions/neovim-pi/src/registry.js";

/** A stand-in client; each one is a pairing of its own. */
function client(): NeovimClient {
	return new EventEmitter() as unknown as NeovimClient;
}

/** A paired client whose notifications reach `registry`. */
function pairedWith(registry: Registry): {
	client: NeovimClient;
	emitNotification: (method: string, args: unknown[]) => void;
} {
	const paired = client();
	registry.registerHandlers(paired);
	const emitter = paired as unknown as EventEmitter;
	return {
		client: paired,
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
	it("starts empty", () => {
		expect(lastCursor(client())).toBeNull();
	});

	it("records the latest snapshot stamped with receivedAt", () => {
		const paired = client();
		recordCursor(paired, sample);
		const last = lastCursor(paired);
		expect(last?.line).toBe(5);
		expect(last?.source).toBe("human");
		expect(typeof last?.receivedAt).toBe("number");
	});

	it("keeps the most recent push, replacing the prior one", () => {
		const paired = client();
		recordCursor(paired, sample);
		recordCursor(paired, { ...sample, line: 42 });
		expect(lastCursor(paired)?.line).toBe(42);
	});

	it("forgets a pairing's snapshot once cleared", () => {
		const paired = client();
		recordCursor(paired, sample);
		clearCursor(paired);
		expect(lastCursor(paired)).toBeNull();
	});

	it("caches a cursor.moved notification once the stream is installed", () => {
		const registry = createRegistry();
		installCursorStream(registry);
		const { client: paired, emitNotification } = pairedWith(registry);
		emitNotification("pi.dispatch", ["cursor.moved", { ...sample, line: 9 }]);
		expect(lastCursor(paired)?.line).toBe(9);
	});

	it("keeps each pairing's cursor apart, so one nvim's push is never another's", () => {
		const first = createRegistry();
		const second = createRegistry();
		installCursorStream(first);
		installCursorStream(second);
		const a = pairedWith(first);
		const b = pairedWith(second);

		a.emitNotification("pi.dispatch", ["cursor.moved", { ...sample, line: 9 }]);
		clearCursor(b.client);

		expect({
			first: lastCursor(a.client)?.line,
			second: lastCursor(b.client),
		}).toEqual({ first: 9, second: null });
	});
});

describe("turnState", () => {
	it("reports no activity when nothing has been pushed", () => {
		const state = turnState(client());
		expect(state.humanActive).toBe(false);
		expect(state.typing).toBe(false);
		expect(state.msSinceMove).toBeNull();
		expect(state.mode).toBeNull();
	});

	it("flags the human active and typing on a recent insert-mode push", () => {
		const paired = client();
		recordCursor(paired, { ...sample, mode: "i" });
		const at = lastCursor(paired)?.receivedAt ?? 0;
		const state = turnState(paired, 1500, at + 100);
		expect(state.humanActive).toBe(true);
		expect(state.typing).toBe(true);
		expect(state.mode).toBe("i");
		expect(state.bufnr).toBe(sample.bufnr);
	});

	it("flags active but not typing on a recent normal-mode push", () => {
		const paired = client();
		recordCursor(paired, { ...sample, mode: "n" });
		const at = lastCursor(paired)?.receivedAt ?? 0;
		const state = turnState(paired, 1500, at + 100);
		expect(state.humanActive).toBe(true);
		expect(state.typing).toBe(false);
	});

	it("goes quiet once the push falls outside the recency window", () => {
		const paired = client();
		recordCursor(paired, { ...sample, mode: "i" });
		const at = lastCursor(paired)?.receivedAt ?? 0;
		const state = turnState(paired, 1500, at + 5000);
		expect(state.humanActive).toBe(false);
		expect(state.typing).toBe(false);
		expect(state.msSinceMove).toBe(5000);
	});

	it("reads only its own pairing's pushes", () => {
		const typing = client();
		const quiet = client();
		recordCursor(typing, { ...sample, mode: "i" });
		expect(turnState(quiet).humanActive).toBe(false);
	});
});

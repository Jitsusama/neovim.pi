import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The neovim package, and the winston logger it brings, took about
 * 600 ms of a pi start's CPU to load on 3 November. Pairing is
 * explicit and most sessions never pair, so the package should load
 * at the first pairing, not when the extension does.
 */
const loaded = vi.hoisted(() => ({ times: 0 }));

class FakeClient extends EventEmitter {
	channelId = Promise.resolve(7);
}

vi.mock("neovim", () => {
	loaded.times += 1;
	return { attach: vi.fn(() => new FakeClient()) };
});

vi.mock("../../extensions/neovim-pi/src/connection.js", () => ({
	connectTo: vi.fn(async () => ({
		reader: {},
		writer: {},
		closed: new Promise<void>(() => {}),
		close: vi.fn(),
	})),
}));

vi.mock("../../extensions/neovim-pi/src/handshake.js", () => ({
	performHandshake: vi.fn(async () => ({ version: "0.1.0", capabilities: [] })),
}));

vi.mock("../../extensions/neovim-pi/src/registry.js", () => ({
	registerHandlers: vi.fn(),
}));

import { attachToSocket, detachFromNeovim } from "../../extensions/neovim-pi/src/attach.js";

describe("the neovim client", () => {
	afterEach(async () => {
		await detachFromNeovim();
	});

	it("is loaded at the first pairing, not when the extension loads", async () => {
		expect(loaded.times).toBe(0);

		await attachToSocket("/tmp/test.sock");

		expect(loaded.times).toBe(1);
	});
});

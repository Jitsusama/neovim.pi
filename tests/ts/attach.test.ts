import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * attach.ts orchestrates the connection lifecycle. We
 * mock the `neovim` package's attach() and the inner
 * handshake call so tests focus on the state machine
 * (paired/unpaired, idempotency, conflict, cleanup on
 * disconnect) without needing a live nvim peer.
 */
const fakeClients: FakeClient[] = [];

class FakeClient extends EventEmitter {
	channelId = Promise.resolve(7);
	transport = { _stream: { end: vi.fn() } };
}

vi.mock("neovim", () => ({
	attach: vi.fn(() => {
		const client = new FakeClient();
		fakeClients.push(client);
		return client;
	}),
}));

vi.mock("../../extensions/neovim-pi/src/handshake.js", () => ({
	performHandshake: vi.fn(async () => ({ version: "0.1.0", capabilities: [] })),
}));

vi.mock("../../extensions/neovim-pi/src/registry.js", () => ({
	registerHandlers: vi.fn(),
}));

import {
	attachToSocket,
	detachFromNeovim,
	getClient,
	getPairedSocket,
} from "../../extensions/neovim-pi/src/attach.js";

describe("attach lifecycle", () => {
	beforeEach(() => {
		fakeClients.length = 0;
	});

	afterEach(async () => {
		await detachFromNeovim();
	});

	it("starts unattached", () => {
		expect(getClient()).toBeNull();
		expect(getPairedSocket()).toBeNull();
	});

	it("attaches to a socket and reports the pairing", async () => {
		await attachToSocket("/tmp/test.sock");
		expect(getClient()).not.toBeNull();
		expect(getPairedSocket()).toBe("/tmp/test.sock");
	});

	it("is idempotent when called twice with the same socket", async () => {
		const first = await attachToSocket("/tmp/test.sock");
		const second = await attachToSocket("/tmp/test.sock");
		expect(first).toBe(second);
		// Only one underlying client should have been created.
		expect(fakeClients).toHaveLength(1);
	});

	it("refuses to switch sockets without an explicit detach", async () => {
		await attachToSocket("/tmp/a.sock");
		await expect(attachToSocket("/tmp/b.sock")).rejects.toThrow(/detach first/i);
	});

	it("clears the pairing when detached", async () => {
		await attachToSocket("/tmp/test.sock");
		await detachFromNeovim();
		expect(getClient()).toBeNull();
		expect(getPairedSocket()).toBeNull();
	});

	it("ends the socket stream on detach (so nvim doesn't exit)", async () => {
		await attachToSocket("/tmp/test.sock");
		const stream = fakeClients[0]?.transport._stream;
		await detachFromNeovim();
		expect(stream?.end).toHaveBeenCalled();
	});

	it("detach is safe to call when unpaired", async () => {
		await expect(detachFromNeovim()).resolves.toBeUndefined();
		expect(getClient()).toBeNull();
	});

	it("clears the pairing when the peer disconnects unexpectedly", async () => {
		await attachToSocket("/tmp/test.sock");
		const client = fakeClients[0];
		client?.emit("disconnect");
		expect(getClient()).toBeNull();
		expect(getPairedSocket()).toBeNull();
	});

	it("allows re-attaching to a new socket after detach", async () => {
		await attachToSocket("/tmp/first.sock");
		await detachFromNeovim();
		await attachToSocket("/tmp/second.sock");
		expect(getPairedSocket()).toBe("/tmp/second.sock");
	});
});

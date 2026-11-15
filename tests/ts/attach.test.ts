import { EventEmitter } from "node:events";
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
}

/** Every connection opened, so a test can see which were closed. */
const fakeLinks: { close: ReturnType<typeof vi.fn> }[] = [];

vi.mock("../../extensions/neovim-pi/src/connection.js", () => ({
	connectTo: vi.fn(async () => {
		const link = {
			reader: {},
			writer: {},
			closed: new Promise<void>(() => {}),
			close: vi.fn(),
		};
		fakeLinks.push(link);
		return link;
	}),
}));

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

import { type Connection, createConnection } from "../../extensions/neovim-pi/src/attach.js";
import { createRegistry } from "../../extensions/neovim-pi/src/registry.js";

describe("attach lifecycle", () => {
	let connection: Connection;

	beforeEach(() => {
		fakeClients.length = 0;
		fakeLinks.length = 0;
		connection = createConnection(createRegistry());
	});

	afterEach(async () => {
		await connection.detachFromNeovim();
	});

	it("starts unattached", () => {
		expect(connection.getClient()).toBeNull();
		expect(connection.getPairedSocket()).toBeNull();
	});

	it("attaches to a socket and reports the pairing", async () => {
		await connection.attachToSocket("/tmp/test.sock");
		expect(connection.getClient()).not.toBeNull();
		expect(connection.getPairedSocket()).toBe("/tmp/test.sock");
	});

	it("is idempotent when called twice with the same socket", async () => {
		const first = await connection.attachToSocket("/tmp/test.sock");
		const second = await connection.attachToSocket("/tmp/test.sock");
		expect(first).toBe(second);
		// Only one underlying client should have been created.
		expect(fakeClients).toHaveLength(1);
	});

	it("refuses to switch sockets without an explicit detach", async () => {
		await connection.attachToSocket("/tmp/a.sock");
		await expect(connection.attachToSocket("/tmp/b.sock")).rejects.toThrow(/detach first/i);
	});

	it("clears the pairing when detached", async () => {
		await connection.attachToSocket("/tmp/test.sock");
		await connection.detachFromNeovim();
		expect(connection.getClient()).toBeNull();
		expect(connection.getPairedSocket()).toBeNull();
	});

	it("closes its socket on detach (so nvim doesn't exit)", async () => {
		await connection.attachToSocket("/tmp/test.sock");
		await connection.detachFromNeovim();
		expect(fakeLinks[0]?.close).toHaveBeenCalled();
	});

	it("detach is safe to call when unpaired", async () => {
		await expect(connection.detachFromNeovim()).resolves.toBeUndefined();
		expect(connection.getClient()).toBeNull();
	});

	it("clears the pairing when the peer disconnects unexpectedly", async () => {
		await connection.attachToSocket("/tmp/test.sock");
		const client = fakeClients[0];
		client?.emit("disconnect");
		expect(connection.getClient()).toBeNull();
		expect(connection.getPairedSocket()).toBeNull();
	});

	it("allows re-attaching to a new socket after detach", async () => {
		await connection.attachToSocket("/tmp/first.sock");
		await connection.detachFromNeovim();
		await connection.attachToSocket("/tmp/second.sock");
		expect(connection.getPairedSocket()).toBe("/tmp/second.sock");
	});
});

describe("two conversations' connections", () => {
	beforeEach(() => {
		fakeClients.length = 0;
		fakeLinks.length = 0;
	});

	it("keep their own pairings, so one pairing leaves the other unpaired", async () => {
		const first = createConnection(createRegistry());
		const second = createConnection(createRegistry());

		await first.attachToSocket("/tmp/first.sock");

		expect({
			first: first.getPairedSocket(),
			second: second.getPairedSocket(),
			secondClient: second.getClient(),
		}).toEqual({ first: "/tmp/first.sock", second: null, secondClient: null });
		await first.detachFromNeovim();
	});

	it("pair with different nvims at once, and a detach releases only its own", async () => {
		const first = createConnection(createRegistry());
		const second = createConnection(createRegistry());

		await first.attachToSocket("/tmp/first.sock");
		await second.attachToSocket("/tmp/second.sock");
		await first.detachFromNeovim();

		expect({
			first: first.getPairedSocket(),
			second: second.getPairedSocket(),
			closed: fakeLinks.map((link) => link.close.mock.calls.length),
		}).toEqual({ first: null, second: "/tmp/second.sock", closed: [1, 0] });
		await second.detachFromNeovim();
	});
});

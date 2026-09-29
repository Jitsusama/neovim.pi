import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ATTACH_TIMEOUT_MS,
	attachToSocket,
	detachFromNeovim,
	getClient,
} from "../../extensions/neovim-pi/src/attach.js";
import { getPeerInfo } from "../../extensions/neovim-pi/src/handshake.js";

/**
 * Pairing against sockets that are really there, with the real
 * `neovim` client, since the failures worth guarding happen inside
 * it. A socket file outlives the nvim that made it whenever nvim
 * dies hard, and a session that remembers the pairing tries it at
 * every start. The client read a refused connection as a promise
 * nobody handled, and pi has no handler for one, so pi exited.
 */

/** Slack for a machine under load, on top of the clock under test. */
const MARGIN_MS = 3000;

const REPO = resolve(__dirname, "..", "..");
const HAVE_NVIM = spawnSync("nvim", ["--version"]).status === 0;

let dir: string;
let servers: Server[];
let problems: unknown[];

const collect = (reason: unknown): void => {
	problems.push(reason);
};

beforeEach(() => {
	// A socket path is capped near a hundred bytes, so this stays short.
	dir = mkdtempSync(join(tmpdir(), "nvp-"));
	servers = [];
	problems = [];
	process.on("unhandledRejection", collect);
	process.on("uncaughtException", collect);
});

afterEach(async () => {
	await detachFromNeovim();
	for (const server of servers) server.close();
	process.off("unhandledRejection", collect);
	process.off("uncaughtException", collect);
	rmSync(dir, { recursive: true, force: true });
});

/** A socket that answers connections the way `onConnect` says. */
async function listen(name: string, onConnect: (socket: Socket) => void): Promise<string> {
	const path = join(dir, name);
	const server = createServer(onConnect);
	servers.push(server);
	await new Promise<void>((done) => server.listen(path, done));
	return path;
}

/**
 * A socket file with nobody listening on it, which is what a hard
 * death leaves. Closing a server removes its file, so a second name
 * for the same socket is what outlives it.
 */
async function staleSocket(): Promise<string> {
	const live = await listen("live.sock", () => {});
	const stale = join(dir, "stale.sock");
	linkSync(live, stale);
	const server = servers.pop();
	await new Promise<void>((done) => server?.close(() => done()));
	return stale;
}

/**
 * How a promise settled and how long that took, or that it was still
 * running once its clock and the margin had both gone by, so a hang
 * fails an assertion instead of the test's own timeout.
 */
async function settle(work: Promise<unknown>): Promise<{ error?: Error; took: number }> {
	const started = Date.now();
	let timer: NodeJS.Timeout | undefined;
	const budget = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error("still running")),
			ATTACH_TIMEOUT_MS + MARGIN_MS,
		);
	});
	try {
		await Promise.race([work, budget]);
		return { took: Date.now() - started };
	} catch (error) {
		return { error: error as Error, took: Date.now() - started };
	} finally {
		clearTimeout(timer);
	}
}

/** Long enough for a rejection nobody handled to be reported. */
const reported = (): Promise<void> => new Promise((done) => setTimeout(done, 300));

describe("pairing with a socket nvim is not answering on", () => {
	it("fails the attach, and leaves nothing unhandled, when nobody is listening", async () => {
		const outcome = await settle(attachToSocket(await staleSocket()));
		await reported();

		expect(problems).toEqual([]);
		expect(outcome.error?.message).toMatch(/ECONNREFUSED/);
		expect(getClient()).toBeNull();
	}, 20_000);

	it("gives up at its clock on a socket that accepts and never answers", async () => {
		const outcome = await settle(attachToSocket(await listen("mute.sock", () => {})));
		await reported();

		expect(problems).toEqual([]);
		expect(outcome.error?.message).toMatch(/did not answer/);
		expect(outcome.took).toBeLessThan(ATTACH_TIMEOUT_MS + MARGIN_MS);
		expect(getClient()).toBeNull();
	}, 20_000);

	it("fails at once, not at its clock, when the peer hangs up mid-handshake", async () => {
		const socket = await listen("hangup.sock", (peer) => {
			peer.once("data", () => peer.destroy());
		});
		const outcome = await settle(attachToSocket(socket));
		await reported();

		expect(problems).toEqual([]);
		expect(outcome.error?.message).toMatch(/hung up/);
		expect(outcome.took).toBeLessThan(MARGIN_MS);
		expect(getClient()).toBeNull();
	}, 20_000);
});

describe.skipIf(!HAVE_NVIM)("pairing with a real nvim", () => {
	/** A headless nvim with this plugin on its path, and its socket. */
	async function startNvim(): Promise<{ nvim: ChildProcess; socket: string }> {
		const socket = join(dir, "nvim.sock");
		const nvim = spawn(
			"nvim",
			["--headless", "--clean", "--listen", socket, "--cmd", `set rtp+=${REPO}`],
			{ stdio: "ignore" },
		);
		const deadline = Date.now() + 10_000;
		while (!existsSync(socket) && Date.now() < deadline) {
			await new Promise((done) => setTimeout(done, 50));
		}
		return { nvim, socket };
	}

	it("still pairs, handshake and all", async () => {
		const { nvim, socket } = await startNvim();
		try {
			await attachToSocket(socket);

			expect(getClient()).not.toBeNull();
			expect(getPeerInfo()?.version).toBeTruthy();
		} finally {
			await detachFromNeovim();
			nvim.kill("SIGKILL");
		}
	}, 30_000);

	it("lets go of an nvim that dies, and a late write to it ends nothing", async () => {
		const { nvim, socket } = await startNvim();
		try {
			const paired = await attachToSocket(socket);
			nvim.kill("SIGKILL");
			const deadline = Date.now() + 10_000;
			while (getClient() && Date.now() < deadline) {
				await new Promise((done) => setTimeout(done, 50));
			}
			expect(getClient()).toBeNull();

			// A tool call already holding the client writes to a socket
			// whose far end is gone.
			void paired.request("nvim_get_mode", []).catch(() => {});
			void paired.request("nvim_get_mode", []).catch(() => {});
			await reported();

			expect(problems).toEqual([]);
		} finally {
			nvim.kill("SIGKILL");
		}
	}, 30_000);
});

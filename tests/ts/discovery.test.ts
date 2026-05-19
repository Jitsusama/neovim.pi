import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSocketCandidates, socketExists, stateDir } from "../../extensions/neovim-pi/src/discovery.js";

describe("stateDir", () => {
	const original = process.env.XDG_RUNTIME_DIR;
	afterEach(() => {
		if (original === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = original;
	});

	it("uses XDG_RUNTIME_DIR when set", () => {
		process.env.XDG_RUNTIME_DIR = "/run/user/1000";
		expect(stateDir()).toBe("/run/user/1000");
	});

	it("falls back to ~/.local/state/pi when XDG is unset", () => {
		delete process.env.XDG_RUNTIME_DIR;
		expect(stateDir()).toMatch(/\.local\/state\/pi$/);
	});
});

describe("listSocketCandidates", () => {
	let dir: string;
	let servers: net.Server[];

	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), "neovim-pi-test-"));
		process.env.XDG_RUNTIME_DIR = dir;
		servers = [];
	});

	afterEach(async () => {
		for (const server of servers) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		await fs.rm(dir, { recursive: true, force: true });
	});

	async function liveSocket(name: string): Promise<string> {
		const path = join(dir, name);
		const server = net.createServer();
		await new Promise<void>((resolve) => server.listen(path, resolve));
		servers.push(server);
		return path;
	}

	it("returns an empty list when no sockets exist", async () => {
		await expect(listSocketCandidates()).resolves.toEqual([]);
	});

	it("returns an empty list when the directory does not exist", async () => {
		process.env.XDG_RUNTIME_DIR = join(dir, "missing");
		await expect(listSocketCandidates()).resolves.toEqual([]);
	});

	it("parses pid out of nvim-<pid>.sock", async () => {
		await liveSocket("nvim-1234.sock");
		const [candidate] = await listSocketCandidates();
		expect(candidate?.pid).toBe(1234);
		expect(candidate?.socket).toMatch(/nvim-1234\.sock$/);
	});

	it("includes the legacy neovim-pi.sock name", async () => {
		await liveSocket("neovim-pi.sock");
		const [candidate] = await listSocketCandidates();
		expect(candidate?.pid).toBeNull();
	});

	it("ignores non-socket files and unrelated names", async () => {
		await fs.writeFile(join(dir, "notes.txt"), "hi");
		await fs.writeFile(join(dir, "nvim-9.json"), "{}");
		await liveSocket("nvim-9.sock");
		const candidates = await listSocketCandidates();
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.pid).toBe(9);
	});

	it("sorts newest first by mtime", async () => {
		const older = await liveSocket("nvim-100.sock");
		await new Promise((resolve) => setTimeout(resolve, 20));
		const newer = await liveSocket("nvim-200.sock");
		const candidates = await listSocketCandidates();
		expect(candidates.map((c) => c.socket)).toEqual([newer, older]);
	});

	it("reads the cwd sidecar when the plugin wrote one", async () => {
		await liveSocket("nvim-7.sock");
		await fs.writeFile(join(dir, "nvim-7.cwd"), "/work/project-foo\n");
		const [candidate] = await listSocketCandidates();
		expect(candidate?.cwd).toBe("/work/project-foo");
	});

	it("leaves cwd null when no sidecar is present", async () => {
		await liveSocket("nvim-8.sock");
		const [candidate] = await listSocketCandidates();
		expect(candidate?.cwd).toBeNull();
	});

	it("treats an empty sidecar as no cwd", async () => {
		await liveSocket("nvim-9.sock");
		await fs.writeFile(join(dir, "nvim-9.cwd"), "   \n");
		const [candidate] = await listSocketCandidates();
		expect(candidate?.cwd).toBeNull();
	});
});

describe("socketExists", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), "neovim-pi-test-"));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("returns false for a missing path", async () => {
		await expect(socketExists(join(dir, "nope.sock"))).resolves.toBe(false);
	});

	it("returns false for a regular file", async () => {
		const path = join(dir, "regular");
		await fs.writeFile(path, "");
		await expect(socketExists(path)).resolves.toBe(false);
	});

	it("returns true for an actual socket", async () => {
		const path = join(dir, "live.sock");
		const server = net.createServer();
		await new Promise<void>((resolve) => server.listen(path, resolve));
		try {
			await expect(socketExists(path)).resolves.toBe(true);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});

import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the connection layer. We're not testing the npm `neovim`
// package or its msgpack-rpc transport here; we're testing what
// lifecycle-tools.ts does with the attach/detach state machine.
const attachState: { socket: string | null; client: { channelId: number } | null } = {
	socket: null,
	client: null,
};

vi.mock("../../extensions/neovim-pi/src/attach.js", () => ({
	attachToSocket: async (socket: string) => {
		if (attachState.socket && attachState.socket !== socket) {
			throw new Error(`already paired with ${attachState.socket}`);
		}
		attachState.socket = socket;
		attachState.client = { channelId: 99 };
		return attachState.client;
	},
	detachFromNeovim: async () => {
		attachState.socket = null;
		attachState.client = null;
	},
	getClient: () => attachState.client,
	getPairedSocket: () => attachState.socket,
}));

import { registerLifecycleTools } from "../../extensions/neovim-pi/src/lifecycle-tools.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface CapturedTool {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate: () => void,
		ctx: ExtensionContext,
	) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
}

function fakePi(): { pi: ExtensionAPI; tools: Map<string, CapturedTool>; entries: unknown[] } {
	const tools = new Map<string, CapturedTool>();
	const entries: unknown[] = [];
	const pi = {
		registerTool: (def: CapturedTool) => {
			tools.set(def.name, def);
		},
		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	return { pi, tools, entries };
}

function fakeCtx(opts: { select?: (prompt: string, options: string[]) => Promise<string> } = {}): {
	ctx: ExtensionContext;
	statusCalls: string[];
} {
	const statusCalls: string[] = [];
	const ctx = {
		ui: {
			select: opts.select ?? (async () => ""),
			setStatus: (_slot: string, content: string | undefined) => {
				statusCalls.push(content ?? "<cleared>");
			},
			theme: { fg: (tone: string, text: string) => `<${tone}>${text}</${tone}>` },
		},
	} as unknown as ExtensionContext;
	return { ctx, statusCalls };
}

async function liveSocket(dir: string, name: string): Promise<{ path: string; close: () => Promise<void> }> {
	const path = join(dir, name);
	const server = net.createServer();
	await new Promise<void>((resolve) => server.listen(path, resolve));
	return {
		path,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

describe("lifecycle tools", () => {
	let dir: string;
	let cleanups: Array<() => Promise<void>>;
	const originalXdg = process.env.XDG_RUNTIME_DIR;

	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), "neovim-pi-lc-"));
		process.env.XDG_RUNTIME_DIR = dir;
		cleanups = [];
		attachState.socket = null;
		attachState.client = null;
	});

	afterEach(async () => {
		for (const close of cleanups) await close();
		await fs.rm(dir, { recursive: true, force: true });
		if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = originalXdg;
	});

	describe("nvim_list_candidates", () => {
		it("reports no candidates when nothing is listening", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();

			const result = await tools.get("nvim_list_candidates")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.content[0]?.text).toMatch(/no candidate/i);
		});

		it("reports each listening socket the discoverer finds", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-555.sock");
			cleanups.push(sock.close);

			const result = await tools.get("nvim_list_candidates")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.content[0]?.text).toContain("nvim-555.sock");
			expect(result?.content[0]?.text).toContain("pid 555");
		});
	});

	describe("nvim_attach", () => {
		it("rejects a hint pointing at no socket", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();

			await expect(
				tools
					.get("nvim_attach")
					?.execute("id", { socket: "/tmp/does-not-exist.sock" }, new AbortController().signal, () => {}, ctx),
			).rejects.toThrow(/no nvim socket/i);
		});

		it("auto-attaches when exactly one candidate exists", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-100.sock");
			cleanups.push(sock.close);

			const result = await tools.get("nvim_attach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.details).toMatchObject({ socket: sock.path });
			expect(attachState.socket).toBe(sock.path);
		});

		it("asks the user when multiple candidates exist", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const sockA = await liveSocket(dir, "nvim-100.sock");
			const sockB = await liveSocket(dir, "nvim-200.sock");
			cleanups.push(sockA.close, sockB.close);

			let promptedWith: string[] = [];
			const { ctx } = fakeCtx({
				select: async (_prompt, options) => {
					promptedWith = options;
					// Pick whichever option mentions 200
					return options.find((o) => o.includes("nvim-200")) ?? options[0]!;
				},
			});

			const result = await tools.get("nvim_attach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(promptedWith).toHaveLength(2);
			expect(result?.details).toMatchObject({ socket: sockB.path });
		});

		it("rejects when no candidates exist and no hint is provided", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			await expect(
				tools.get("nvim_attach")?.execute("id", {}, new AbortController().signal, () => {}, ctx),
			).rejects.toThrow(/no candidate/i);
		});

		it("records the pairing intent in the session log", async () => {
			const { pi, tools, entries } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-300.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			// Walk back to find the most recent entry for our custom type.
			const last = [...entries].reverse().find(
				(e) => (e as { customType?: string }).customType === "neovim-pi:pairing",
			) as { data: { socket: string } } | undefined;
			expect(last?.data.socket).toBe(sock.path);
		});

		it("paints the status line in the success tone after attaching", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx, statusCalls } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-400.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			expect(statusCalls.some((s) => s.includes("success"))).toBe(true);
		});
	});

	describe("nvim_detach", () => {
		it("releases the current pairing", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-500.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			const result = await tools.get("nvim_detach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);

			expect(result?.content[0]?.text).toContain("unpaired");
			expect(attachState.socket).toBeNull();
		});

		it("is safe to call when not paired", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();

			const result = await tools.get("nvim_detach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.content[0]?.text).toMatch(/no pairing/i);
		});

		it("paints the status line in the muted tone after detach", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx, statusCalls } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-600.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			await tools.get("nvim_detach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(statusCalls.at(-1)).toContain("muted");
		});

		it("forgets the pairing intent in the session log", async () => {
			const { pi, tools, entries } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-700.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			await tools.get("nvim_detach")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			const last = [...entries].reverse().find(
				(e) => (e as { customType?: string }).customType === "neovim-pi:pairing",
			) as { data: { socket: string | null } } | undefined;
			expect(last?.data.socket).toBeNull();
		});
	});

	describe("nvim_status", () => {
		it("reports not paired when unattached", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();

			const result = await tools.get("nvim_status")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.content[0]?.text).toMatch(/not paired/i);
			expect(result?.details).toMatchObject({ attached: false });
		});

		it("reports the socket and channel when paired", async () => {
			const { pi, tools } = fakePi();
			registerLifecycleTools(pi);
			const { ctx } = fakeCtx();
			const sock = await liveSocket(dir, "nvim-800.sock");
			cleanups.push(sock.close);

			await tools.get("nvim_attach")?.execute("id", { socket: sock.path }, new AbortController().signal, () => {}, ctx);
			const result = await tools.get("nvim_status")?.execute("id", {}, new AbortController().signal, () => {}, ctx);
			expect(result?.content[0]?.text).toContain(sock.path);
			expect(result?.details).toMatchObject({ attached: true, socket: sock.path });
		});
	});
});

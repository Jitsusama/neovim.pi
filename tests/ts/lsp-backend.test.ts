import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import { performHandshake } from "../../extensions/neovim-pi/src/handshake.js";
import {
	createNeovimLspBackend,
	registerLspBackend,
} from "../../extensions/neovim-pi/src/lsp-backend.js";

/** A client whose nvim_exec_lua records the call and returns a canned reply. */
function client(
	reply: unknown,
	calls?: Array<{ code: string; args: unknown[] }>,
): NeovimClient {
	return {
		request: async (method: string, params: unknown[]) => {
			if (method === "nvim_exec_lua") {
				calls?.push({ code: params[0] as string, args: params[1] as unknown[] });
			}
			return reply;
		},
	} as unknown as NeovimClient;
}

/** Seed the module-level peer capabilities via a handshake. */
async function seedPeer(capabilities: string[]): Promise<void> {
	const c = {
		request: async (method: string) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { version: "0.1.0", capabilities };
		},
	} as unknown as NeovimClient;
	await performHandshake(c);
}

const range = {
	start: { line: 3, character: 4 },
	end: { line: 3, character: 9 },
};

describe("createNeovimLspBackend", () => {
	it("maps definition results and forwards tool coordinates", async () => {
		const calls: Array<{ code: string; args: unknown[] }> = [];
		const backend = createNeovimLspBackend(() =>
			client({ ok: true, items: [{ path: "/a.ts", range }] }, calls),
		);
		const result = await backend.definition({
			path: "/b.ts",
			position: { line: 12, character: 5 },
		});
		expect(result).toEqual([{ path: "/a.ts", range }]);
		expect(calls[0].code).toContain('require("neovim-pi.lsp").definition');
		expect(calls[0].args).toEqual(["/b.ts", 12, 5]);
	});

	it("maps diagnostics with severity, source and code", async () => {
		const backend = createNeovimLspBackend(() =>
			client({
				ok: true,
				items: [
					{
						path: "/a.ts",
						range,
						severity: "error",
						message: "boom",
						source: "ts",
						code: "2304",
					},
				],
			}),
		);
		const result = await backend.diagnostics("/a.ts");
		expect(result).toEqual([
			{
				path: "/a.ts",
				range,
				severity: "error",
				message: "boom",
				source: "ts",
				code: "2304",
			},
		]);
	});

	it("returns hover contents or null", async () => {
		const withHover = createNeovimLspBackend(() =>
			client({ ok: true, hover: { contents: "const x: number" } }),
		);
		expect(await withHover.hover({ path: "/a.ts", position: range.start })).toEqual({
			contents: "const x: number",
			range: undefined,
		});

		const without = createNeovimLspBackend(() => client({ ok: true, hover: null }));
		expect(await without.hover({ path: "/a.ts", position: range.start })).toBeNull();
	});

	it("maps document and workspace symbols", async () => {
		const backend = createNeovimLspBackend(() =>
			client({
				ok: true,
				items: [
					{
						name: "foo",
						kind: "function",
						location: { path: "/a.ts", range },
						containerName: "mod",
					},
				],
			}),
		);
		const symbols = await backend.documentSymbols("/a.ts");
		expect(symbols).toEqual([
			{
				name: "foo",
				kind: "function",
				location: { path: "/a.ts", range },
				containerName: "mod",
			},
		]);
	});

	it("maps rename into a workspace edit", async () => {
		const calls: Array<{ code: string; args: unknown[] }> = [];
		const backend = createNeovimLspBackend(() =>
			client(
				{
					ok: true,
					changes: [
						{ path: "/a.ts", edits: [{ range, newText: "renamed" }] },
					],
				},
				calls,
			),
		);
		const edit = await backend.rename(
			{ path: "/a.ts", position: { line: 1, character: 2 } },
			"renamed",
		);
		expect(edit).toEqual({
			changes: [{ path: "/a.ts", edits: [{ range, newText: "renamed" }] }],
		});
		expect(calls[0].args).toEqual(["/a.ts", 1, 2, "renamed"]);
	});

	it("forwards a code-action range in the tool convention", async () => {
		const calls: Array<{ code: string; args: unknown[] }> = [];
		const backend = createNeovimLspBackend(() =>
			client({ ok: true, items: [{ title: "Fix", kind: "quickfix" }] }, calls),
		);
		const actions = await backend.codeActions("/a.ts", range);
		expect(actions).toEqual([{ title: "Fix", kind: "quickfix" }]);
		expect(calls[0].args[1]).toEqual({
			start_line: 3,
			start_char: 4,
			end_line: 3,
			end_char: 9,
		});
	});

	it("returns empty results when nvim reports no server", async () => {
		const backend = createNeovimLspBackend(() =>
			client({ ok: false, reason: "no-client" }),
		);
		expect(await backend.definition({ path: "/a.ts", position: range.start })).toEqual([]);
		expect(await backend.diagnostics("/a.ts")).toEqual([]);
		expect(await backend.hover({ path: "/a.ts", position: range.start })).toBeNull();
	});
});

describe("registerLspBackend", () => {
	function bus() {
		const handlers = new Map<string, Array<(data: unknown) => void>>();
		const emitted: Array<{ name: string; data: unknown }> = [];
		return {
			handlers,
			emitted,
			events: {
				on(name: string, handler: (data: unknown) => void) {
					const list = handlers.get(name) ?? [];
					list.push(handler);
					handlers.set(name, list);
				},
				emit(name: string, data?: unknown) {
					emitted.push({ name, data: data ?? null });
				},
			},
			on() {},
		};
	}

	it("announces the backend immediately and again on lsp:ready", () => {
		const b = bus();
		registerLspBackend(b as never, () => null);
		expect(b.emitted.filter((e) => e.name === "lsp:register-backend")).toHaveLength(1);

		for (const handler of b.handlers.get("lsp:ready") ?? []) handler(null);
		expect(b.emitted.filter((e) => e.name === "lsp:register-backend")).toHaveLength(2);
	});

	it("reports availability only while paired with a capable nvim", async () => {
		const b = bus();
		let paired: NeovimClient | null = null;
		registerLspBackend(b as never, () => paired);
		const entry = b.emitted[0].data as {
			name: string;
			priority: number;
			isAvailable: () => boolean;
		};
		expect(entry.name).toBe("neovim");
		expect(entry.priority).toBe(50);

		await seedPeer(["nvim.lsp.query"]);
		expect(entry.isAvailable()).toBe(false); // not paired yet

		paired = client({ ok: true, items: [] });
		expect(entry.isAvailable()).toBe(true); // paired and capable

		await seedPeer([]); // capability withdrawn
		expect(entry.isAvailable()).toBe(false);
	});
});

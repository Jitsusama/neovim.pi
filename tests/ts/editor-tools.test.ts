import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import { registerEditorTools } from "../../extensions/neovim-pi/src/editor-tools.js";
import { performHandshake } from "../../extensions/neovim-pi/src/handshake.js";

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

function setup(getClient: () => NeovimClient | null): Map<string, CapturedTool> {
	const tools = new Map<string, CapturedTool>();
	const pi = {
		registerTool: (def: CapturedTool) => {
			tools.set(def.name, def);
		},
	} as unknown as ExtensionAPI;
	registerEditorTools(pi, getClient);
	return tools;
}

const noopCtx = {} as ExtensionContext;
const noopSignal = new AbortController().signal;

//// Seed the module-level peer with a capability list, so
//// requireCapability passes (or, with an empty list, degrades).
async function seedPeer(capabilities: string[]): Promise<void> {
	const client = {
		request: async (method: string) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { version: "0.1.0", capabilities };
		},
	} as unknown as NeovimClient;
	await performHandshake(client);
}

//// A client whose every nvim_exec_lua returns one canned
//// payload — the lua result the tool then renders.
function cannedClient(result: unknown): NeovimClient {
	return {
		request: async () => result,
	} as unknown as NeovimClient;
}

async function runTool(
	tool: CapturedTool | undefined,
	params: Record<string, unknown>,
): Promise<string> {
	const out = await (tool as CapturedTool).execute(
		"id",
		params,
		noopSignal,
		() => {},
		noopCtx,
	);
	return out.content.map((c) => c.text).join("\n");
}

describe("editor-control tools", () => {
	it("registers the documented editor-control surface", () => {
		const tools = setup(() => null);
		expect([...tools.keys()].sort()).toEqual([
			"nvim_buffer",
			"nvim_cursor",
			"nvim_diff",
			"nvim_file",
			"nvim_text",
			"nvim_window",
		]);
	});

	it("every tool refuses to run without a paired peer", async () => {
		const tools = setup(() => null);
		for (const [, tool] of tools) {
			await expect(
				tool.execute("id", {}, noopSignal, () => {}, noopCtx),
			).rejects.toThrow(/no nvim paired/i);
		}
	});

	it("degrades with an update-the-plugin error when the peer lacks the capability", async () => {
		await seedPeer([]); // paired, but advertises nothing
		const tools = setup(() => cannedClient(null));
		await expect(
			runTool(tools.get("nvim_text"), { action: "set_range", bufnr: 1, text: "x" }),
		).rejects.toThrow(/does not support nvim\.text\.setRange.*update the neovim-pi plugin/i);
	});

	it("renders a changedtick conflict as a re-read instruction", async () => {
		await seedPeer(["nvim.text.setRange"]);
		const tools = setup(() => cannedClient({ ok: false, conflict: true, changedtick: 42 }));
		const text = await runTool(tools.get("nvim_text"), { action: "set_range", bufnr: 1, text: "x" });
		expect(text).toContain("changedtick 42");
		expect(text).toMatch(/re-read and retry/);
	});

	it("renders a modified-buffer delete refusal with the force hint", async () => {
		await seedPeer(["nvim.buffer.delete"]);
		const tools = setup(() => cannedClient({ ok: false, modified: true }));
		const text = await runTool(tools.get("nvim_buffer"), { action: "delete", bufnr: 7 });
		expect(text).toBe("refused: buffer 7 has unsaved changes; pass force to discard them");
	});
});

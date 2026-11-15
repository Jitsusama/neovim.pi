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

//// A paired client that advertised `capabilities` in its
//// handshake, so requireCapability passes (or, with an empty
//// list, degrades), and whose every nvim_exec_lua after it
//// returns one canned payload: the lua result the tool renders.
async function pairedClient(capabilities: string[], result: unknown): Promise<NeovimClient> {
	let shaken = false;
	const client = {
		request: async (method: string) => {
			if (method === "nvim_get_api_info") return [1, {}];
			if (shaken) return result;
			shaken = true;
			return { version: "0.1.0", capabilities };
		},
	} as unknown as NeovimClient;
	await performHandshake(client);
	return client;
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
		const client = await pairedClient([], null); // paired, but advertises nothing
		const tools = setup(() => client);
		await expect(
			runTool(tools.get("nvim_text"), { action: "set_range", bufnr: 1, text: "x" }),
		).rejects.toThrow(/does not support nvim\.text\.setRange.*update the neovim-pi plugin/i);
	});

	it("renders a changedtick conflict as a re-read instruction", async () => {
		const client = await pairedClient(["nvim.text.setRange"], {
			ok: false,
			conflict: true,
			changedtick: 42,
		});
		const tools = setup(() => client);
		const text = await runTool(tools.get("nvim_text"), { action: "set_range", bufnr: 1, text: "x" });
		expect(text).toContain("changedtick 42");
		expect(text).toMatch(/re-read and retry/);
	});

	it("renders a modified-buffer delete refusal with the force hint", async () => {
		const client = await pairedClient(["nvim.buffer.delete"], { ok: false, modified: true });
		const tools = setup(() => client);
		const text = await runTool(tools.get("nvim_buffer"), { action: "delete", bufnr: 7 });
		expect(text).toBe("refused: buffer 7 has unsaved changes; pass force to discard them");
	});

	it("gates on what this pairing's nvim advertised, not another pairing's", async () => {
		// Another conversation in the same host pairs with a newer
		// plugin after this one did; this pairing stays as it was.
		const own = await pairedClient([], null);
		await pairedClient(["nvim.text.setRange"], null);
		const tools = setup(() => own);
		await expect(
			runTool(tools.get("nvim_text"), { action: "set_range", bufnr: 1, text: "x" }),
		).rejects.toThrow(/does not support nvim\.text\.setRange/i);
	});
});

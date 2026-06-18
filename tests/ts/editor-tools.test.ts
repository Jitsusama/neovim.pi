import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import { registerEditorTools } from "../../extensions/neovim-pi/src/editor-tools.js";

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
});

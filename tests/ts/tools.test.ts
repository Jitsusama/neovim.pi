import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import { registerNvimTools } from "../../extensions/neovim-pi/src/tools.js";
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

interface RecordedRequest {
	method: string;
	args: unknown[];
}

function fakeClient(response: unknown = null): {
	client: NeovimClient;
	requests: RecordedRequest[];
} {
	const requests: RecordedRequest[] = [];
	const client = {
		request: async (method: string, args: unknown[]) => {
			requests.push({ method, args });
			return response;
		},
	} as unknown as NeovimClient;
	return { client, requests };
}

function setup(getClient: () => NeovimClient | null): Map<string, CapturedTool> {
	const tools = new Map<string, CapturedTool>();
	const pi = {
		registerTool: (def: CapturedTool) => {
			tools.set(def.name, def);
		},
	} as unknown as ExtensionAPI;
	registerNvimTools(pi, getClient);
	return tools;
}

const noopCtx = {} as ExtensionContext;
const noopSignal = new AbortController().signal;

describe("nvim tools", () => {
	it("registers exactly the documented set of tools", () => {
		const tools = setup(() => null);
		const names = [...tools.keys()].sort();
		expect(names).toEqual([
			"nvim_buffer_close",
			"nvim_buffer_is_modified",
			"nvim_buffer_open",
			"nvim_buffer_reload",
		]);
	});

	it("every tool refuses to run without a paired peer", async () => {
		const tools = setup(() => null);
		for (const [name, tool] of tools) {
			await expect(
				tool.execute(
					"id",
					name === "nvim_buffer_is_modified" || name === "nvim_buffer_reload"
						? { path: "/x" }
						: { uri: "pi://x" },
					noopSignal,
					() => {},
					noopCtx,
				),
			).rejects.toThrow(/no nvim paired/i);
		}
	});

	describe("nvim_buffer_open", () => {
		it("forwards the URI and focus flag to the lua adapter", async () => {
			const { client, requests } = fakeClient();
			const tools = setup(() => client);
			await tools.get("nvim_buffer_open")?.execute(
				"id",
				{ uri: "pi://test/foo", focus: false },
				noopSignal,
				() => {},
				noopCtx,
			);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.method).toBe("nvim_exec_lua");
			const [, callArgs] = requests[0]?.args as [string, unknown[]];
			expect(callArgs).toEqual(["pi://test/foo", false]);
		});

		it("defaults focus to true when the caller omits it", async () => {
			const { client, requests } = fakeClient();
			const tools = setup(() => client);
			await tools.get("nvim_buffer_open")?.execute(
				"id",
				{ uri: "pi://test/foo" },
				noopSignal,
				() => {},
				noopCtx,
			);
			const [, callArgs] = requests[0]?.args as [string, unknown[]];
			expect(callArgs).toEqual(["pi://test/foo", true]);
		});

		it("reports what was opened in the user-visible content", async () => {
			const { client } = fakeClient();
			const tools = setup(() => client);
			const result = await tools.get("nvim_buffer_open")?.execute(
				"id",
				{ uri: "pi://test/foo" },
				noopSignal,
				() => {},
				noopCtx,
			);
			expect(result?.content[0]?.text).toContain("pi://test/foo");
		});
	});

	describe("nvim_buffer_close", () => {
		it("forwards the URI to the lua adapter", async () => {
			const { client, requests } = fakeClient();
			const tools = setup(() => client);
			await tools
				.get("nvim_buffer_close")
				?.execute("id", { uri: "pi://test/foo" }, noopSignal, () => {}, noopCtx);
			const [, callArgs] = requests[0]?.args as [string, unknown[]];
			expect(callArgs).toEqual(["pi://test/foo"]);
		});
	});

	describe("nvim_buffer_is_modified", () => {
		it("surfaces the dirty flag in the details payload", async () => {
			const { client } = fakeClient(true);
			const tools = setup(() => client);
			const result = await tools
				.get("nvim_buffer_is_modified")
				?.execute("id", { path: "/work/foo.ts" }, noopSignal, () => {}, noopCtx);
			expect(result?.details).toMatchObject({ modified: true });
			expect(result?.content[0]?.text).toBe("modified");
		});

		it("renders 'clean' when nvim reports the buffer is not dirty", async () => {
			const { client } = fakeClient(false);
			const tools = setup(() => client);
			const result = await tools
				.get("nvim_buffer_is_modified")
				?.execute("id", { path: "/work/foo.ts" }, noopSignal, () => {}, noopCtx);
			expect(result?.details).toMatchObject({ modified: false });
			expect(result?.content[0]?.text).toBe("clean");
		});
	});

	describe("nvim_buffer_reload", () => {
		it("forwards the path to the lua adapter", async () => {
			const { client, requests } = fakeClient();
			const tools = setup(() => client);
			await tools
				.get("nvim_buffer_reload")
				?.execute("id", { path: "/work/foo.ts" }, noopSignal, () => {}, noopCtx);
			const [, callArgs] = requests[0]?.args as [string, unknown[]];
			expect(callArgs).toEqual(["/work/foo.ts"]);
		});
	});
});

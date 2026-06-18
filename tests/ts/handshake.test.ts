import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import {
	getPeerInfo,
	PI_CAPABILITIES,
	PROTOCOL_VERSION,
	peerHas,
	performHandshake,
} from "../../extensions/neovim-pi/src/handshake.js";

/**
 * Minimum NeovimClient surface our handshake touches:
 * `request(method, args)`. Tests build a stand-in that
 * routes calls to a programmable callback so we can
 * observe the wire protocol pi sends to nvim and decide
 * what to send back.
 */
function fakeClient(handler: (method: string, args: unknown[]) => unknown): NeovimClient {
	return {
		request: async (method: string, args: unknown[]) => handler(method, args),
	} as unknown as NeovimClient;
}

describe("performHandshake", () => {
	it("queries the channel id and passes it into the lua exchange", async () => {
		const calls: Array<{ method: string; args: unknown[] }> = [];
		const client = fakeClient((method, args) => {
			calls.push({ method, args });
			if (method === "nvim_get_api_info") return [42, { metadata: "stub" }];
			if (method === "nvim_exec_lua") return { version: "0.1.0", capabilities: [] };
			throw new Error(`unexpected method ${method}`);
		});

		await performHandshake(client);

		expect(calls[0]?.method).toBe("nvim_get_api_info");
		// The lua call gets (PROTOCOL_VERSION, capabilities, channelId) as
		// positional args. Inspect what we sent without depending on the
		// exact lua call shape.
		const luaArgs = calls[1]?.args as [string, unknown[]];
		const passed = luaArgs[1] as [string, readonly string[], number];
		expect(passed[0]).toBe(PROTOCOL_VERSION);
		expect(passed[1]).toEqual(PI_CAPABILITIES);
		expect(passed[2]).toBe(42);
	});

	it("returns the peer info nvim advertised", async () => {
		const client = fakeClient((method) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { version: "0.9.9", capabilities: ["nvim.buffer.open"] };
		});

		const peer = await performHandshake(client);
		expect(peer.version).toBe("0.9.9");
		expect(peer.capabilities).toContain("nvim.buffer.open");
	});

	it("rejects a handshake response with no version", async () => {
		const client = fakeClient((method) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { capabilities: [] }; // missing version
		});

		await expect(performHandshake(client)).rejects.toThrow(/version/i);
	});
});

describe("peerHas", () => {
	it("reports capabilities the peer advertised in its last handshake", async () => {
		const client = fakeClient((method) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { version: "0.1.0", capabilities: ["nvim.buffer.open", "nvim.status.publish"] };
		});
		await performHandshake(client);
		expect(peerHas("nvim.buffer.open")).toBe(true);
		expect(peerHas("nvim.status.publish")).toBe(true);
	});

	it("reports false for capabilities the peer did not advertise", async () => {
		const client = fakeClient((method) => {
			if (method === "nvim_get_api_info") return [1, {}];
			return { version: "0.1.0", capabilities: ["nvim.buffer.open"] };
		});
		await performHandshake(client);
		expect(peerHas("nvim.cursor.set")).toBe(false);
		expect(peerHas("totally.made.up")).toBe(false);
	});
});

describe("getPeerInfo", () => {
	it("returns the most recent peer info after a handshake", async () => {
		const client = fakeClient((method) => {
			if (method === "nvim_get_api_info") return [7, {}];
			return { version: "1.2.3", capabilities: ["nvim.buffer.markStale"] };
		});
		await performHandshake(client);
		const peer = getPeerInfo();
		expect(peer?.version).toBe("1.2.3");
		expect(peer?.capabilities).toContain("nvim.buffer.markStale");
	});
});

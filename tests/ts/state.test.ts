import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { forgetPairing, lastPairing, rememberPairing } from "../../extensions/neovim-pi/src/state.js";

/**
 * Wire up a fake pi session that joins `appendEntry`
 * (the write side of state.ts) and `sessionManager.getEntries`
 * (the read side) against a shared in-memory log. This lets
 * us test what callers actually care about: that remembering
 * a socket means a later `lastPairing` returns it, without
 * the test having to know how the entry is stored.
 */
function fakeSession(): { pi: ExtensionAPI; ctx: ExtensionContext } {
	const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const pi = {
		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		sessionManager: { getEntries: () => entries as unknown[] },
	} as unknown as ExtensionContext;
	return { pi, ctx };
}

describe("pairing memory round-trip", () => {
	it("has no pairing when nothing has happened", () => {
		const { ctx } = fakeSession();
		expect(lastPairing(ctx)).toBeNull();
	});

	it("remembers the socket that was just attached", () => {
		const { pi, ctx } = fakeSession();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		expect(lastPairing(ctx)).toBe("/tmp/nvim-1.sock");
	});

	it("forgets when explicitly detached", () => {
		const { pi, ctx } = fakeSession();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		forgetPairing(pi);
		expect(lastPairing(ctx)).toBeNull();
	});

	it("returns the most recent socket when re-attached", () => {
		const { pi, ctx } = fakeSession();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		rememberPairing(pi, "/tmp/nvim-2.sock");
		expect(lastPairing(ctx)).toBe("/tmp/nvim-2.sock");
	});

	it("survives an attach-detach-attach cycle", () => {
		const { pi, ctx } = fakeSession();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		forgetPairing(pi);
		rememberPairing(pi, "/tmp/nvim-2.sock");
		expect(lastPairing(ctx)).toBe("/tmp/nvim-2.sock");
	});

	it("is unaffected by other extensions writing to the session log", () => {
		const { pi, ctx } = fakeSession();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		// Simulate an unrelated extension appending its own entries.
		(pi as unknown as { appendEntry: (t: string, d: unknown) => void }).appendEntry(
			"other-ext:something",
			{ payload: 42 },
		);
		expect(lastPairing(ctx)).toBe("/tmp/nvim-1.sock");
	});
});

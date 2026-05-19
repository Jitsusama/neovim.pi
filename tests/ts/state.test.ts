import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	PAIRING_ENTRY_TYPE,
	forgetPairing,
	lastPairing,
	rememberPairing,
} from "../../extensions/neovim-pi/src/state.js";

/** Build the minimum slice of ExtensionAPI our state helpers touch. */
function fakeApi(): { pi: ExtensionAPI; entries: Array<{ type: string; customType?: string; data?: unknown }> } {
	const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const pi = {
		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	return { pi, entries };
}

/** Build the minimum slice of ExtensionContext lastPairing reads. */
function fakeCtx(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): ExtensionContext {
	return {
		sessionManager: { getEntries: () => entries as unknown[] },
	} as unknown as ExtensionContext;
}

describe("rememberPairing", () => {
	it("appends a pairing entry with the socket path", () => {
		const { pi, entries } = fakeApi();
		rememberPairing(pi, "/tmp/nvim-1.sock");
		expect(entries).toEqual([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/nvim-1.sock" } },
		]);
	});
});

describe("forgetPairing", () => {
	it("appends a pairing entry with a null socket", () => {
		const { pi, entries } = fakeApi();
		forgetPairing(pi);
		expect(entries).toEqual([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: null } },
		]);
	});
});

describe("lastPairing", () => {
	it("returns null when no entries exist", () => {
		expect(lastPairing(fakeCtx([]))).toBeNull();
	});

	it("returns null when no pairing entry exists", () => {
		const ctx = fakeCtx([
			{ type: "user", data: "hi" },
			{ type: "custom", customType: "other-ext", data: {} },
		]);
		expect(lastPairing(ctx)).toBeNull();
	});

	it("returns the most recent socket when set", () => {
		const ctx = fakeCtx([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/old.sock" } },
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/new.sock" } },
		]);
		expect(lastPairing(ctx)).toBe("/tmp/new.sock");
	});

	it("returns null when the latest pairing entry is a detach", () => {
		const ctx = fakeCtx([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/old.sock" } },
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: null } },
		]);
		expect(lastPairing(ctx)).toBeNull();
	});

	it("ignores unrelated custom entry types between pairings", () => {
		const ctx = fakeCtx([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/a.sock" } },
			{ type: "custom", customType: "another-ext", data: {} },
		]);
		expect(lastPairing(ctx)).toBe("/tmp/a.sock");
	});

	it("uses the session log read by getEntries (not internal state)", () => {
		// Sanity: lastPairing must not cache. Caller's getEntries is the source of truth.
		const getEntries = vi.fn().mockReturnValueOnce([
			{ type: "custom", customType: PAIRING_ENTRY_TYPE, data: { socket: "/tmp/x.sock" } },
		]);
		const ctx = { sessionManager: { getEntries } } as unknown as ExtensionContext;
		expect(lastPairing(ctx)).toBe("/tmp/x.sock");
		expect(getEntries).toHaveBeenCalledTimes(1);
	});
});

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { STATUS_SLOT, clearStatus, renderStatus } from "../../extensions/neovim-pi/src/status-line.js";

/**
 * Captures every setStatus call so tests can assert on
 * what showed up in the footer. The theme.fg shim records
 * the tone so a successful render is distinguishable from
 * a muted one without depending on the exact ANSI bytes.
 */
function fakeCtx(): {
	ctx: ExtensionContext;
	slots: Array<{ slot: string; content: string | undefined }>;
	lastTone: () => string | null;
} {
	const slots: Array<{ slot: string; content: string | undefined }> = [];
	let lastTone: string | null = null;
	const ctx = {
		ui: {
			setStatus: (slot: string, content: string | undefined) => {
				slots.push({ slot, content });
			},
			theme: {
				fg: (tone: string, text: string) => {
					lastTone = tone;
					return `<${tone}>${text}</${tone}>`;
				},
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, slots, lastTone: () => lastTone };
}

describe("renderStatus", () => {
	it("writes a paired indicator into the footer when attached", () => {
		const { ctx, slots, lastTone } = fakeCtx();
		renderStatus(ctx, true);
		expect(slots).toHaveLength(1);
		expect(slots[0]?.slot).toBe(STATUS_SLOT);
		expect(lastTone()).toBe("success");
	});

	it("writes an unpaired indicator when detached", () => {
		const { ctx, slots, lastTone } = fakeCtx();
		renderStatus(ctx, false);
		expect(slots).toHaveLength(1);
		expect(lastTone()).toBe("muted");
	});

	it("can be called repeatedly to reflect state transitions", () => {
		const { ctx, slots } = fakeCtx();
		renderStatus(ctx, true);
		renderStatus(ctx, false);
		renderStatus(ctx, true);
		expect(slots).toHaveLength(3);
		expect(slots.every((s) => s.slot === STATUS_SLOT)).toBe(true);
	});
});

describe("clearStatus", () => {
	it("releases the footer slot", () => {
		const { ctx, slots } = fakeCtx();
		clearStatus(ctx);
		expect(slots).toEqual([{ slot: STATUS_SLOT, content: undefined }]);
	});
});

import { describe, expect, it } from "vitest";
import {
	PAIRED_ONLY_TOOLS,
	pairedToolSurface,
} from "../../extensions/neovim-pi/src/tool-surface.js";

const LIFECYCLE = [
	"nvim_list_candidates",
	"nvim_attach",
	"nvim_detach",
	"nvim_status",
];
const REGISTERED = ["read", "bash", ...LIFECYCLE, ...PAIRED_ONLY_TOOLS];

describe("which neovim tools a session carries", () => {
	it("carries only the pairing tools while nothing is paired", () => {
		expect(pairedToolSurface(REGISTERED, REGISTERED, false)).toEqual([
			"read",
			"bash",
			...LIFECYCLE,
		]);
	});

	it("carries the editor tools once paired", () => {
		const unpaired = pairedToolSurface(REGISTERED, REGISTERED, false);
		expect(pairedToolSurface(unpaired, REGISTERED, true)).toEqual([
			"read",
			"bash",
			...LIFECYCLE,
			...PAIRED_ONLY_TOOLS,
		]);
	});

	it("leaves every other tool as another extension set it", () => {
		const active = ["read", "nvim_attach"];
		expect(pairedToolSurface(active, REGISTERED, true)).toEqual([
			"read",
			"nvim_attach",
			...PAIRED_ONLY_TOOLS,
		]);
	});

	it("names every editor tool that needs a pairing to do anything", () => {
		expect([...PAIRED_ONLY_TOOLS].sort()).toEqual(
			[
				"nvim_buffer",
				"nvim_buffer_open",
				"nvim_cursor",
				"nvim_diff",
				"nvim_file",
				"nvim_text",
				"nvim_window",
			].sort(),
		);
	});
});

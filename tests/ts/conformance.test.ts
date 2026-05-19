import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NeovimClient } from "neovim";
import { describe, expect, it } from "vitest";
import {
	PI_CAPABILITIES,
	PROTOCOL_VERSION,
	performHandshake,
} from "../../extensions/neovim-pi/src/handshake.js";

/**
 * Conformance vectors describe a protocol scenario that any
 * pi-side or nvim-side implementation should pass. They live
 * in `tests/conformance/*.json` and are consumed by both
 * languages so wire compatibility is enforced from both ends.
 */

interface ConformanceStep {
	from: "pi" | "nvim";
	to: "pi" | "nvim";
	call: { method: string; args: unknown[] };
	expect: {
		version: string;
		capabilities: { contains: string[] };
	};
}

interface ConformanceVector {
	name: string;
	description: string;
	steps: ConformanceStep[];
}

function loadVector(name: string): ConformanceVector {
	const path = join(__dirname, "..", "conformance", `${name}.json`);
	return JSON.parse(readFileSync(path, "utf8")) as ConformanceVector;
}

describe("conformance: handshake/v0.1.0", () => {
	const vector = loadVector("handshake");
	const piStep = vector.steps.find((s) => s.from === "pi" && s.to === "nvim");
	if (!piStep) throw new Error("handshake vector missing the pi->nvim step");

	it("pi advertises the version the vector requires", () => {
		expect(PROTOCOL_VERSION).toBe(piStep.expect.version);
	});

	it("pi's advertised capabilities include those the vector references", () => {
		const piCaps = piStep.call.args[1] as [string, string[]];
		const referenced = piCaps[1];
		for (const cap of referenced) {
			expect(PI_CAPABILITIES).toContain(cap);
		}
	});

	it("performHandshake parses a peer response shaped like the vector's expect", async () => {
		const peerResponse = {
			version: piStep.expect.version,
			capabilities: piStep.expect.capabilities.contains,
		};
		const recorded: Array<{ method: string; args: unknown[] }> = [];
		const client = {
			request: async (method: string, args: unknown[]) => {
				recorded.push({ method, args });
				if (method === "nvim_get_api_info") return [42, {}];
				if (method === "nvim_exec_lua") return peerResponse;
				throw new Error(`unexpected method ${method}`);
			},
		} as unknown as NeovimClient;

		const info = await performHandshake(client);
		expect(info.version).toBe(peerResponse.version);
		for (const cap of piStep.expect.capabilities.contains) {
			expect(info.capabilities).toContain(cap);
		}
	});

	it("performHandshake invokes the lua exchange function the vector names", async () => {
		const recorded: Array<{ method: string; args: unknown[] }> = [];
		const client = {
			request: async (method: string, args: unknown[]) => {
				recorded.push({ method, args });
				if (method === "nvim_get_api_info") return [99, {}];
				return { version: "0.1.0", capabilities: [] };
			},
		} as unknown as NeovimClient;
		await performHandshake(client);
		const exec = recorded.find((r) => r.method === "nvim_exec_lua");
		expect(exec).toBeDefined();
		const luaSrc = (exec?.args as [string, unknown[]])[0];
		// The vector's source string requires `exchange(...)`; we
		// don't enforce the exact whitespace, but the symbol must
		// be there so wire compatibility holds.
		expect(luaSrc).toContain("neovim-pi.handshake");
		expect(luaSrc).toContain("exchange");
	});
});

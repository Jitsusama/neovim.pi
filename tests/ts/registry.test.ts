import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { afterEach, describe, expect, it } from "vitest";
import { addMethod, registerHandlers, removeMethod } from "../../extensions/neovim-pi/src/registry.js";

/**
 * The npm `neovim` client surfaces incoming requests as a
 * "request" event with `(method, args, resp)`. resp.send
 * takes `(value, isError?)`. Tests build a minimal stand-in
 * that captures what the dispatcher sends so we can assert
 * the exact arg order.
 */
function fakeClient(): {
	client: NeovimClient;
	requests: { method: string; args: unknown[]; resp: CapturedResp }[];
	emit: (method: string, args: unknown[]) => Promise<CapturedResp>;
} {
	const emitter = new EventEmitter();
	const requests: { method: string; args: unknown[]; resp: CapturedResp }[] = [];

	const client = emitter as unknown as NeovimClient;
	registerHandlers(client);

	async function emit(method: string, args: unknown[]): Promise<CapturedResp> {
		const resp = new CapturedResp();
		requests.push({ method, args, resp });
		emitter.emit("request", method, args, resp);
		await resp.settled;
		return resp;
	}

	return { client, requests, emit };
}

class CapturedResp {
	value: unknown = undefined;
	isError: boolean | undefined = undefined;
	private resolve: () => void = () => {};
	settled = new Promise<void>((resolve) => {
		this.resolve = resolve;
	});

	send(value: unknown, isError?: boolean): void {
		this.value = value;
		this.isError = isError;
		this.resolve();
	}
}

describe("registerHandlers", () => {
	afterEach(() => {
		// The dispatcher seeds method handlers in a module-scope map.
		// Reset between tests so suites don't leak state.
		removeMethod("custom.echo");
		removeMethod("custom.boom");
	});

	it("seeds a default `buffer.uri.resolve` handler", async () => {
		const { emit } = fakeClient();
		const resp = await emit("pi.dispatch", ["buffer.uri.resolve", "pi://local/x"]);
		expect(resp.isError).toBeFalsy();
		expect((resp.value as { lines: string[] }).lines[0]).toMatch(/no scheme handler/);
		expect((resp.value as { lines: string[] }).lines.join("\n")).toContain("pi://local/x");
	});

	it("flags an unknown top-level method as an error", async () => {
		const { emit } = fakeClient();
		const resp = await emit("not.pi.dispatch", []);
		expect(resp.isError).toBe(true);
		expect(String(resp.value)).toContain("not.pi.dispatch");
	});

	it("flags an unknown dispatched method as an error", async () => {
		const { emit } = fakeClient();
		const resp = await emit("pi.dispatch", ["does.not.exist"]);
		expect(resp.isError).toBe(true);
		expect(String(resp.value)).toContain("does.not.exist");
	});

	it("dispatches to registered handlers and returns success", async () => {
		const { emit } = fakeClient();
		addMethod("custom.echo", (args) => ({ got: args }));
		const resp = await emit("pi.dispatch", ["custom.echo", 1, 2, 3]);
		expect(resp.isError).toBeFalsy();
		expect(resp.value).toEqual({ got: [1, 2, 3] });
	});

	it("converts thrown handler errors into error responses", async () => {
		const { emit } = fakeClient();
		addMethod("custom.boom", () => {
			throw new Error("kaboom");
		});
		const resp = await emit("pi.dispatch", ["custom.boom"]);
		expect(resp.isError).toBe(true);
		expect(String(resp.value)).toContain("kaboom");
	});

	it("returns the handler's value as-is on success (regression: resp.send signature)", async () => {
		// The previous bug: resp.send(null, result) was treating `result`
		// as the isError flag, so successful responses sent `null` on the
		// wire and crashed the nvim side. The wire contract we care about
		// is: whatever a handler returns is what nvim sees, byte-for-byte
		// shape. Round-trip a value through and assert structural equality.
		const { emit } = fakeClient();
		const payload = { lines: ["line one", "line two"], filetype: "markdown" };
		addMethod("custom.echo", () => payload);
		const resp = await emit("pi.dispatch", ["custom.echo"]);
		expect(resp.isError).toBeFalsy();
		expect(resp.value).toEqual(payload);
	});
});

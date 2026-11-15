import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { beforeEach, describe, expect, it } from "vitest";
import { createRegistry, type Registry } from "../../extensions/neovim-pi/src/registry.js";

/** The registry under test, a fresh one for each test. */
let registry: Registry;

/**
 * The npm `neovim` client surfaces incoming requests as a
 * "request" event with `(method, args, resp)`. resp.send
 * takes `(value, isError?)`. Tests build a minimal stand-in
 * that captures what the dispatcher sends so we can assert
 * the exact arg order.
 */
function fakeClient(into: Registry = registry): {
	client: NeovimClient;
	requests: { method: string; args: unknown[]; resp: CapturedResp }[];
	emit: (method: string, args: unknown[]) => Promise<CapturedResp>;
	emitNotification: (method: string, args: unknown[]) => void;
} {
	const emitter = new EventEmitter();
	const requests: { method: string; args: unknown[]; resp: CapturedResp }[] = [];

	const client = emitter as unknown as NeovimClient;
	into.registerHandlers(client);

	async function emit(method: string, args: unknown[]): Promise<CapturedResp> {
		const resp = new CapturedResp();
		requests.push({ method, args, resp });
		emitter.emit("request", method, args, resp);
		await resp.settled;
		return resp;
	}

	function emitNotification(method: string, args: unknown[]): void {
		emitter.emit("notification", method, args);
	}

	return { client, requests, emit, emitNotification };
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
	beforeEach(() => {
		registry = createRegistry();
	});

	it("routes a pi.dispatch notification to a registered notification handler", () => {
		const received: unknown[][] = [];
		registry.addNotificationHandler("cursor.update", (args) => {
			received.push(args);
		});
		const { emitNotification } = fakeClient();
		emitNotification("pi.dispatch", ["cursor.update", { line: 5, col: 2 }]);
		expect(received).toEqual([[{ line: 5, col: 2 }]]);
	});

	it("hands a notification handler the client the notification came on", () => {
		const from: NeovimClient[] = [];
		registry.addNotificationHandler("cursor.update", (_args, sender) => {
			from.push(sender);
		});
		const { client, emitNotification } = fakeClient();
		emitNotification("pi.dispatch", ["cursor.update", {}]);
		expect(from).toEqual([client]);
	});

	it("ignores a notification whose dispatched name has no handler", () => {
		const { emitNotification } = fakeClient();
		expect(() => emitNotification("pi.dispatch", ["nobody.listening", 1])).not.toThrow();
	});

	it("seeds a default `buffer.uri.resolve` handler", async () => {
		const { emit } = fakeClient();
		const resp = await emit("pi.dispatch", ["buffer.uri.resolve", "pi://local/x"]);
		expect(resp.isError).toBeFalsy();
		expect((resp.value as { lines: string[] }).lines[0]).toMatch(/no scheme handler/);
		expect((resp.value as { lines: string[] }).lines.join("\n")).toContain("pi://local/x");
	});

	it("preserves an extension-registered scheme handler across a later attach", async () => {
		// A second attach calls registerHandlers again on a fresh
		// client. Re-seeding the built-in default must not clobber a
		// scheme handler an extension already claimed via addMethod.
		fakeClient();
		registry.addMethod("buffer.uri.resolve", () => ({ lines: ["owned by extension"] }));
		const { emit } = fakeClient();
		const resp = await emit("pi.dispatch", ["buffer.uri.resolve", "pi://pr/x"]);
		expect(resp.isError).toBeFalsy();
		expect((resp.value as { lines: string[] }).lines).toEqual(["owned by extension"]);
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
		registry.addMethod("custom.echo", (args) => ({ got: args }));
		const resp = await emit("pi.dispatch", ["custom.echo", 1, 2, 3]);
		expect(resp.isError).toBeFalsy();
		expect(resp.value).toEqual({ got: [1, 2, 3] });
	});

	it("converts thrown handler errors into error responses", async () => {
		const { emit } = fakeClient();
		registry.addMethod("custom.boom", () => {
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
		registry.addMethod("custom.echo", () => payload);
		const resp = await emit("pi.dispatch", ["custom.echo"]);
		expect(resp.isError).toBeFalsy();
		expect(resp.value).toEqual(payload);
	});
});

describe("two conversations' registries", () => {
	it("answer only their own methods, so one conversation's handler never reaches another's nvim", async () => {
		const mine = createRegistry();
		const theirs = createRegistry();
		mine.addMethod("custom.echo", () => "mine");

		const [own, other] = await Promise.all([
			fakeClient(mine).emit("pi.dispatch", ["custom.echo"]),
			fakeClient(theirs).emit("pi.dispatch", ["custom.echo"]),
		]);

		expect({
			own: [own.value, own.isError],
			other: [other.value, other.isError],
		}).toEqual({
			own: ["mine", undefined],
			other: ["unknown pi method: custom.echo", true],
		});
	});

	it("keep their own scheme handler, and a later registry still gets the default", async () => {
		const claimed = createRegistry();
		const fresh = createRegistry();
		claimed.addMethod("buffer.uri.resolve", () => ({ lines: ["owned"] }));

		const [owned, defaulted] = await Promise.all([
			fakeClient(claimed).emit("pi.dispatch", ["buffer.uri.resolve", "pi://x/y"]),
			fakeClient(fresh).emit("pi.dispatch", ["buffer.uri.resolve", "pi://x/y"]),
		]);

		expect((owned.value as { lines: string[] }).lines).toEqual(["owned"]);
		expect((defaulted.value as { lines: string[] }).lines[0]).toMatch(/no scheme handler/);
	});
});

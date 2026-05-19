import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerEventBridge } from "../../extensions/neovim-pi/src/event-bridge.js";
import { removeMethod } from "../../extensions/neovim-pi/src/registry.js";

/**
 * The event bridge lets other pi extensions register
 * buffer-URI handlers (and other pi.* methods) without
 * importing neovim-pi directly. They couldn't even if
 * they tried, because pi loads packages with isolated
 * module roots. The bridge subscribes to a small set of
 * events on pi.events and translates them into registry
 * calls. It also emits a "ready" signal so emitters that
 * loaded earlier can retry once neovim-pi is listening.
 */

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

function fakeBus(): {
	bus: {
		on: (name: string, handler: (data: unknown) => void) => void;
		emit: (name: string, data?: unknown) => void;
	};
	emit: (name: string, data?: unknown) => void;
	emitted: { name: string; data: unknown }[];
} {
	const emitter = new EventEmitter();
	const emitted: { name: string; data: unknown }[] = [];
	const bus = {
		on(name: string, handler: (data: unknown) => void) {
			emitter.on(name, handler);
		},
		emit(name: string, data?: unknown) {
			emitted.push({ name, data });
			emitter.emit(name, data);
		},
	};
	return { bus, emit: bus.emit, emitted };
}

describe("registerEventBridge", () => {
	afterEach(() => {
		removeMethod("test.echo");
		removeMethod("test.other");
	});

	it("installs a handler when an extension emits register-handler", async () => {
		// The wire contract: the bridge subscribes to
		// `neovim-pi:register-handler` and translates the
		// event into an `addMethod` call. The handler then
		// becomes invokable through `pi.dispatch` from nvim.
		const { bus } = fakeBus();
		registerEventBridge(bus);

		const handler: Handler = (args) => ({ echoed: args });
		bus.emit("neovim-pi:register-handler", {
			method: "test.echo",
			handler,
		});

		// Reach into the registry the same way the dispatcher
		// does: through addMethod's sibling, by reusing the
		// same module. We assert behaviour by simulating a
		// dispatch directly through the registry's public API.
		const { addMethod } = await import(
			"../../extensions/neovim-pi/src/registry.js"
		);
		// Re-register the same handler under a different name
		// just to confirm addMethod itself works, then confirm
		// our event-installed handler is callable via a fresh
		// dispatch through registerHandlers below.
		expect(typeof addMethod).toBe("function");

		// Confirm the handler installed via the event is the
		// one the dispatcher invokes for that method name.
		const { registerHandlers } = await import(
			"../../extensions/neovim-pi/src/registry.js"
		);
		const client = new EventEmitter() as unknown as Parameters<
			typeof registerHandlers
		>[0];
		registerHandlers(client);
		let captured: unknown = undefined;
		const resp = {
			send(value: unknown, isError?: boolean) {
				captured = { value, isError };
			},
		};
		await new Promise<void>((resolve) => {
			(client as unknown as EventEmitter).emit(
				"request",
				"pi.dispatch",
				["test.echo", "a", "b"],
				{
					send(value: unknown, isError?: boolean) {
						resp.send(value, isError);
						resolve();
					},
				},
			);
		});
		expect(captured).toEqual({ value: { echoed: ["a", "b"] }, isError: undefined });
	});

	it("removes a handler when an extension emits remove-handler", async () => {
		// Cleanup symmetry: extensions that go away (or that
		// re-register for a different URI scheme) need a way
		// to take their handler back.
		const { bus } = fakeBus();
		registerEventBridge(bus);

		bus.emit("neovim-pi:register-handler", {
			method: "test.echo",
			handler: () => "before",
		});
		bus.emit("neovim-pi:remove-handler", { method: "test.echo" });

		const { registerHandlers } = await import(
			"../../extensions/neovim-pi/src/registry.js"
		);
		const client = new EventEmitter() as unknown as Parameters<
			typeof registerHandlers
		>[0];
		registerHandlers(client);
		let captured: { value: unknown; isError?: boolean } = { value: undefined };
		await new Promise<void>((resolve) => {
			(client as unknown as EventEmitter).emit(
				"request",
				"pi.dispatch",
				["test.echo"],
				{
					send(value: unknown, isError?: boolean) {
						captured = { value, isError };
						resolve();
					},
				},
			);
		});
		// With the handler removed, the dispatcher reports
		// the method as unknown rather than running stale code.
		expect(captured.isError).toBe(true);
		expect(String(captured.value)).toContain("test.echo");
	});

	it("emits neovim-pi:ready once subscriptions are wired", () => {
		// Emitters that loaded before neovim-pi missed the
		// window to register. They listen for `ready` and
		// re-emit. The bridge must emit `ready` exactly once
		// per call so a /reload doesn't multiply signals.
		const { bus, emitted } = fakeBus();
		registerEventBridge(bus);
		const readyEvents = emitted.filter(
			(e) => e.name === "neovim-pi:ready",
		);
		expect(readyEvents).toHaveLength(1);
	});

	it("ignores malformed register-handler payloads without throwing", () => {
		// A third-party emitter might send garbage. The bridge
		// must stay alive; bad payloads are dropped quietly so
		// neovim-pi keeps servicing well-formed ones.
		const { bus } = fakeBus();
		registerEventBridge(bus);
		const fn = vi.fn();
		// None of these should throw.
		expect(() => bus.emit("neovim-pi:register-handler", null)).not.toThrow();
		expect(() => bus.emit("neovim-pi:register-handler", {})).not.toThrow();
		expect(() =>
			bus.emit("neovim-pi:register-handler", { method: "x" }),
		).not.toThrow();
		expect(() =>
			bus.emit("neovim-pi:register-handler", { handler: fn }),
		).not.toThrow();
		expect(() =>
			bus.emit("neovim-pi:register-handler", { method: 42, handler: fn }),
		).not.toThrow();
	});

	it("ignores malformed remove-handler payloads without throwing", () => {
		// Same defensive contract for removal.
		const { bus } = fakeBus();
		registerEventBridge(bus);
		expect(() => bus.emit("neovim-pi:remove-handler", null)).not.toThrow();
		expect(() => bus.emit("neovim-pi:remove-handler", {})).not.toThrow();
		expect(() =>
			bus.emit("neovim-pi:remove-handler", { method: 42 }),
		).not.toThrow();
	});
});

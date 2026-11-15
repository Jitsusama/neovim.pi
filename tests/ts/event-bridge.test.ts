import { EventEmitter } from "node:events";
import type { NeovimClient } from "neovim";
import { describe, expect, it, vi } from "vitest";
import { registerEventBridge } from "../../extensions/neovim-pi/src/event-bridge.js";
import { createRegistry, type Registry } from "../../extensions/neovim-pi/src/registry.js";

/**
 * The event bridge lets other pi extensions register
 * buffer-URI handlers (and other pi.* methods) without
 * importing neovim-pi directly. They couldn't even if
 * they tried, because pi loads packages with isolated
 * module roots. The bridge subscribes to a small set of
 * events on pi.events and translates them into calls on
 * its conversation's registry. It also emits a "ready"
 * signal so emitters that loaded earlier can retry once
 * neovim-pi is listening.
 */

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

function fakeBus(): {
	bus: {
		on: (name: string, handler: (data: unknown) => void) => void;
		emit: (name: string, data?: unknown) => void;
	};
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
	return { bus, emitted };
}

/** What a client paired through `registry` answers nvim's `pi.dispatch` of `args`. */
async function dispatch(
	registry: Registry,
	args: unknown[],
): Promise<{ value: unknown; isError?: boolean }> {
	const emitter = new EventEmitter();
	registry.registerHandlers(emitter as unknown as NeovimClient);
	return new Promise((resolve) => {
		emitter.emit("request", "pi.dispatch", args, {
			send(value: unknown, isError?: boolean) {
				resolve({ value, isError });
			},
		});
	});
}

describe("registerEventBridge", () => {
	it("installs a handler when an extension emits register-handler", async () => {
		// The wire contract: the bridge subscribes to
		// `neovim-pi:register-handler` and adds the handler to
		// its registry, so it answers `pi.dispatch` from nvim.
		const { bus } = fakeBus();
		const registry = createRegistry();
		registerEventBridge(bus, registry);

		const handler: Handler = (args) => ({ echoed: args });
		bus.emit("neovim-pi:register-handler", { method: "test.echo", handler });

		expect(await dispatch(registry, ["test.echo", "a", "b"])).toEqual({
			value: { echoed: ["a", "b"] },
			isError: undefined,
		});
	});

	it("removes a handler when an extension emits remove-handler", async () => {
		// Cleanup symmetry: extensions that go away (or that
		// re-register for a different URI scheme) need a way
		// to take their handler back.
		const { bus } = fakeBus();
		const registry = createRegistry();
		registerEventBridge(bus, registry);

		bus.emit("neovim-pi:register-handler", { method: "test.echo", handler: () => "before" });
		bus.emit("neovim-pi:remove-handler", { method: "test.echo" });

		// With the handler removed, the dispatcher reports
		// the method as unknown rather than running stale code.
		const captured = await dispatch(registry, ["test.echo"]);
		expect(captured.isError).toBe(true);
		expect(String(captured.value)).toContain("test.echo");
	});

	it("adds a handler only to the registry of the bus it was emitted on", async () => {
		// A host runs many conversations in one process, each
		// with its own bus and registry; one conversation's
		// handler must never answer another's nvim.
		const first = { ...fakeBus(), registry: createRegistry() };
		const second = { ...fakeBus(), registry: createRegistry() };
		registerEventBridge(first.bus, first.registry);
		registerEventBridge(second.bus, second.registry);

		first.bus.emit("neovim-pi:register-handler", { method: "test.echo", handler: () => "first" });

		const [own, other] = await Promise.all([
			dispatch(first.registry, ["test.echo"]),
			dispatch(second.registry, ["test.echo"]),
		]);
		expect({ own: own.value, other: other.isError }).toEqual({ own: "first", other: true });
	});

	it("emits neovim-pi:ready once subscriptions are wired", () => {
		// Emitters that loaded before neovim-pi missed the
		// window to register. They listen for `ready` and
		// re-emit. The bridge must emit `ready` exactly once
		// per call so a /reload doesn't multiply signals.
		const { bus, emitted } = fakeBus();
		registerEventBridge(bus, createRegistry());
		const readyEvents = emitted.filter((e) => e.name === "neovim-pi:ready");
		expect(readyEvents).toHaveLength(1);
	});

	it("ignores malformed register-handler payloads without throwing", () => {
		// A third-party emitter might send garbage. The bridge
		// must stay alive; bad payloads are dropped quietly so
		// neovim-pi keeps servicing well-formed ones.
		const { bus } = fakeBus();
		registerEventBridge(bus, createRegistry());
		const fn = vi.fn();
		// None of these should throw.
		expect(() => bus.emit("neovim-pi:register-handler", null)).not.toThrow();
		expect(() => bus.emit("neovim-pi:register-handler", {})).not.toThrow();
		expect(() => bus.emit("neovim-pi:register-handler", { method: "x" })).not.toThrow();
		expect(() => bus.emit("neovim-pi:register-handler", { handler: fn })).not.toThrow();
		expect(() => bus.emit("neovim-pi:register-handler", { method: 42, handler: fn })).not.toThrow();
	});

	it("ignores malformed remove-handler payloads without throwing", () => {
		// Same defensive contract for removal.
		const { bus } = fakeBus();
		registerEventBridge(bus, createRegistry());
		expect(() => bus.emit("neovim-pi:remove-handler", null)).not.toThrow();
		expect(() => bus.emit("neovim-pi:remove-handler", {})).not.toThrow();
		expect(() => bus.emit("neovim-pi:remove-handler", { method: 42 })).not.toThrow();
	});
});

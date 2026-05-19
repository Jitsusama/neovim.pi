/**
 * Event-based registration bridge.
 *
 * Pi loads packages with isolated module roots, so other
 * pi extensions can't `import { addMethod }` from
 * neovim-pi directly. Instead, they emit events on the
 * shared `pi.events` bus and this bridge translates them
 * into registry calls.
 *
 * Two events are recognised:
 *
 *   neovim-pi:register-handler { method, handler }
 *     → addMethod(method, handler)
 *   neovim-pi:remove-handler   { method }
 *     → removeMethod(method)
 *
 * On subscription the bridge emits `neovim-pi:ready` once
 * so extensions that loaded before neovim-pi can retry.
 * Combined with a registration-on-init emit from the
 * caller side, this makes the handshake load-order
 * independent.
 *
 * The bridge is defensive: malformed payloads from
 * third-party emitters are dropped silently rather than
 * crashing neovim-pi.
 */

import { addMethod, removeMethod } from "./registry.js";

/** Minimal event-bus shape the bridge depends on. */
export interface EventBus {
	on(name: string, handler: (data: unknown) => void): void;
	emit(name: string, data?: unknown): void;
}

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

interface RegisterPayload {
	method: string;
	handler: Handler;
}

interface RemovePayload {
	method: string;
}

/**
 * Subscribe the registration bridge to `bus` and emit the
 * `neovim-pi:ready` signal once subscriptions are wired.
 */
export function registerEventBridge(bus: EventBus): void {
	bus.on("neovim-pi:register-handler", (data) => {
		const payload = asRegisterPayload(data);
		if (payload === null) return;
		addMethod(payload.method, payload.handler);
	});
	bus.on("neovim-pi:remove-handler", (data) => {
		const payload = asRemovePayload(data);
		if (payload === null) return;
		removeMethod(payload.method);
	});
	bus.emit("neovim-pi:ready");
}

function asRegisterPayload(data: unknown): RegisterPayload | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	if (typeof record.method !== "string") return null;
	if (typeof record.handler !== "function") return null;
	return { method: record.method, handler: record.handler as Handler };
}

function asRemovePayload(data: unknown): RemovePayload | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	if (typeof record.method !== "string") return null;
	return { method: record.method };
}

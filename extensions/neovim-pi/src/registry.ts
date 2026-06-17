/**
 * Method registry: the `pi.*` RPC methods that nvim can
 * call back into.
 *
 * Each method is a thin wrapper around either the pi
 * ExtensionAPI (when feasible) or domain state held by
 * other extensions. Other pi extensions extend the
 * registry by calling `addMethod()` from the public lib
 * (see `pi/lib/registry.ts`).
 */

import type { NeovimClient } from "neovim";

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

const handlers = new Map<string, Handler>();

type NotificationHandler = (args: unknown[]) => void;

const notificationHandlers = new Map<string, NotificationHandler>();

/** Register a handler under `pi.<name>`. Last registration wins. */
export function addMethod(name: string, handler: Handler): void {
	handlers.set(name, handler);
}

/** Seed a built-in handler only when the slot is unclaimed. */
function seedDefault(name: string, handler: Handler): void {
	if (!handlers.has(name)) handlers.set(name, handler);
}

/** Remove a handler. Safe if absent. */
export function removeMethod(name: string): void {
	handlers.delete(name);
}

/** Register a fire-and-forget notification handler. Last registration wins. */
export function addNotificationHandler(name: string, handler: NotificationHandler): void {
	notificationHandlers.set(name, handler);
}

/** Remove a notification handler. Safe if absent. */
export function removeNotificationHandler(name: string): void {
	notificationHandlers.delete(name);
}

/** Wire the dispatcher into a freshly-attached client. */
export function registerHandlers(client: NeovimClient): void {
	// All pi-side methods funnel through a single `request` handler
	// on nvim's side using `rpcrequest(channel_id, "pi.dispatch", ...)`.
	// This keeps the channel registration count to one and lets us
	// route by method name in JS.
	// The npm `neovim` package's `resp.send(value, isError?)` API
	// puts the value first and uses an optional boolean second arg
	// to flag it as an error. Getting that signature backwards (as
	// any node msgpack-rpc veteran will) leads to silent null
	// responses and userdata-typed return values on the nvim side.
	client.on(
		"request",
		async (
			method: string,
			args: unknown[],
			resp: { send: (value: unknown, isError?: boolean) => void },
		) => {
			if (method !== "pi.dispatch") {
				resp.send(`unknown method: ${method}`, true);
				return;
			}

			const [name, ...rest] = args as [string, ...unknown[]];
			const handler = handlers.get(name);
			if (!handler) {
				resp.send(`unknown pi method: ${name}`, true);
				return;
			}

			try {
				const result = await handler(rest);
				resp.send(result);
			} catch (err) {
				resp.send(err instanceof Error ? err.message : String(err), true);
			}
		},
	);

	// Notifications are fire-and-forget: nvim sends them via
	// `rpcnotify(pi_chan, "pi.dispatch", name, ...)`, which the npm
	// client surfaces as a `notification` event with no response
	// channel. The cursor stream rides this path. We route by the
	// dispatched name and swallow handler errors, since there is no
	// caller to report them back to.
	client.on("notification", (method: string, args: unknown[]) => {
		if (method !== "pi.dispatch") return;
		const [name, ...rest] = args as [string, ...unknown[]];
		const handler = notificationHandlers.get(name);
		if (!handler) return;
		try {
			handler(rest);
		} catch {
			// A misbehaving notification handler must not take down the
			// dispatch loop; there is no response channel to surface the
			// error on, so the failure is dropped deliberately.
		}
	});

	// Seed the always-on built-ins, but only when their slot is
	// still unclaimed. registerHandlers runs on every attach, so an
	// unconditional re-seed here would clobber a scheme handler an
	// extension already registered via addMethod (last write wins) —
	// resetting `buffer.uri.resolve` to the default on every reattach.
	seedDefault("ping", () => "pong");
	seedDefault("hello", () => ({ name: "neovim-pi" }));
	seedDefault("buffer.uri.resolve", (args) => resolveUri(args));
}

/**
 * Default URI resolver for `pi://` buffers.
 *
 * Each owning extension registers its own scheme via
 * `addMethod("buffer.uri.resolve", ...)` (last write wins).
 * When no extension has claimed a scheme, this default
 * returns a self-documenting message so the user can see
 * what happened instead of staring at an empty buffer.
 */
function resolveUri(args: unknown[]): { lines: string[]; filetype?: string } {
	const uri = String(args[0] ?? "");
	return {
		lines: [
			`neovim-pi: no scheme handler registered for ${uri}`,
			"",
			"This is the default `buffer.uri.resolve` response. An",
			"extension that owns the URI scheme should override it via",
			'  `addMethod("buffer.uri.resolve", yourHandler)`',
			"from the public lib. See `doc/protocol.md` for the contract.",
		],
	};
}

/**
 * Method registry: the `pi.*` RPC methods that nvim can
 * call back into.
 *
 * Each method is a thin wrapper around either the pi
 * ExtensionAPI (when feasible) or domain state held by
 * other extensions. Other pi extensions extend the
 * registry through the `pi.events` bridge
 * (`event-bridge.ts`).
 *
 * A registry belongs to one conversation. A host runs
 * many conversations in one process and may share this
 * module among them, and each conversation's extensions
 * register handlers that close over that conversation's
 * own state, so a handler registered in one must never
 * answer a call from another's nvim.
 */

import type { NeovimClient } from "neovim";

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

/** A notification's arguments, with the client it came in on. */
type NotificationHandler = (args: unknown[], client: NeovimClient) => void;

/** One conversation's `pi.*` methods and notification handlers. */
export interface Registry {
	/** Register a handler under `pi.<name>`. Last registration wins. */
	addMethod(name: string, handler: Handler): void;
	/** Remove a handler. Safe if absent. */
	removeMethod(name: string): void;
	/** Register a fire-and-forget notification handler. Last registration wins. */
	addNotificationHandler(name: string, handler: NotificationHandler): void;
	/** Remove a notification handler. Safe if absent. */
	removeNotificationHandler(name: string): void;
	/** Wire the dispatcher into a freshly-attached client. */
	registerHandlers(client: NeovimClient): void;
}

/** A registry of its own, for one conversation. */
export function createRegistry(): Registry {
	const handlers = new Map<string, Handler>();
	const notificationHandlers = new Map<string, NotificationHandler>();

	/** Seed a built-in handler only when the slot is unclaimed. */
	const seedDefault = (name: string, handler: Handler): void => {
		if (!handlers.has(name)) handlers.set(name, handler);
	};

	return {
		addMethod(name, handler) {
			handlers.set(name, handler);
		},
		removeMethod(name) {
			handlers.delete(name);
		},
		addNotificationHandler(name, handler) {
			notificationHandlers.set(name, handler);
		},
		removeNotificationHandler(name) {
			notificationHandlers.delete(name);
		},
		registerHandlers(client) {
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
					handler(rest, client);
				} catch {
					// A misbehaving notification handler must not take down the
					// dispatch loop; there is no response channel to surface the
					// error on, so the failure is dropped deliberately.
				}
			});

			// Seed the always-on built-ins, but only when their slot is
			// still unclaimed. registerHandlers runs on every attach, so an
			// unconditional re-seed here would clobber a scheme handler an
			// extension already registered (last write wins), resetting
			// `buffer.uri.resolve` to the default on every reattach.
			seedDefault("ping", () => "pong");
			seedDefault("hello", () => ({ name: "neovim-pi" }));
			seedDefault("buffer.uri.resolve", (args) => resolveUri(args));
		},
	};
}

/**
 * Default URI resolver for `pi://` buffers.
 *
 * Each owning extension registers its own scheme through
 * the `neovim-pi:register-handler` event (last write
 * wins). When no extension has claimed a scheme, this
 * default returns a self-documenting message so the user
 * can see what happened instead of staring at an empty
 * buffer.
 */
function resolveUri(args: unknown[]): { lines: string[]; filetype?: string } {
	const uri = String(args[0] ?? "");
	return {
		lines: [
			`neovim-pi: no scheme handler registered for ${uri}`,
			"",
			"This is the default `buffer.uri.resolve` response. An",
			"extension that owns the URI scheme should override it by",
			"emitting `neovim-pi:register-handler` on `pi.events`",
			"with method `buffer.uri.resolve`. See `doc/protocol.md`.",
		],
	};
}

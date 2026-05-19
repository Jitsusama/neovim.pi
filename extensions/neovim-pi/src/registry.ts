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

/** Register a handler under `pi.<name>`. Last registration wins. */
export function addMethod(name: string, handler: Handler): void {
	handlers.set(name, handler);
}

/** Remove a handler. Safe if absent. */
export function removeMethod(name: string): void {
	handlers.delete(name);
}

/** Wire the dispatcher into a freshly-attached client. */
export function registerHandlers(client: NeovimClient): void {
	// All pi-side methods funnel through a single `request` handler
	// on nvim's side using `rpcrequest(channel_id, "pi.dispatch", ...)`.
	// This keeps the channel registration count to one and lets us
	// route by method name in JS.
	client.on(
		"request",
		async (
			method: string,
			args: unknown[],
			resp: { send: (err: unknown, value?: unknown) => void },
		) => {
			if (method !== "pi.dispatch") {
				resp.send(`unknown method: ${method}`);
				return;
			}

			const [name, ...rest] = args as [string, ...unknown[]];
			const handler = handlers.get(name);
			if (!handler) {
				resp.send(`unknown pi method: ${name}`);
				return;
			}

			try {
				const result = await handler(rest);
				resp.send(null, result);
			} catch (err) {
				resp.send(err instanceof Error ? err.message : String(err));
			}
		},
	);

	// Seed with the always-on built-ins. Other extensions add more.
	addMethod("ping", () => "pong");
	addMethod("hello", () => ({ name: "neovim-pi" }));
	addMethod("buffer.uri.resolve", (args) => resolveUri(args));
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

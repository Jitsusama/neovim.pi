/**
 * Status fragment composition for the nvim channel.
 *
 * Other pi extensions push fragments under their own
 * namespace via `setStatus(namespace, text)`. The
 * companion composes them into a single line that nvim
 * subscribers can render however they like (statusline,
 * winbar, notify, ignore).
 *
 * This module exposes a tiny pub/sub so the companion
 * can re-emit updates over RPC. The pi UI rendering is
 * still owned by pi's native `ctx.ui.setStatus()`.
 */

type Listener = (composed: string) => void;

const fragments = new Map<string, string>();
const listeners = new Set<Listener>();

/** Push or clear a fragment under a namespace. Empty clears. */
export function setFragment(namespace: string, text: string): void {
	if (text === "") {
		fragments.delete(namespace);
	} else {
		fragments.set(namespace, text);
	}
	notify();
}

/** Compose the current set of fragments into a single string. */
export function composeStatus(separator = " · "): string {
	return Array.from(fragments.values()).filter(Boolean).join(separator);
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	listener(composeStatus());
	return () => {
		listeners.delete(listener);
	};
}

function notify(): void {
	const composed = composeStatus();
	for (const l of listeners) l(composed);
}

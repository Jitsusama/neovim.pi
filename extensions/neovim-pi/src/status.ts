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
 *
 * A status line belongs to one conversation: a host runs
 * many in one process, and one's fragments must never
 * show on another's nvim.
 */

type Listener = (composed: string) => void;

/** One conversation's status fragments and who listens to them. */
export interface Status {
	/** Push or clear a fragment under a namespace. Empty clears. */
	setFragment(namespace: string, text: string): void;
	/** Compose the current set of fragments into a single string. */
	composeStatus(separator?: string): string;
	/** Subscribe to status changes. Returns an unsubscribe function. */
	subscribe(listener: Listener): () => void;
}

/** A status line of its own, for one conversation. */
export function createStatus(): Status {
	const fragments = new Map<string, string>();
	const listeners = new Set<Listener>();

	const composeStatus = (separator = " · "): string =>
		Array.from(fragments.values()).filter(Boolean).join(separator);

	return {
		setFragment(namespace, text) {
			if (text === "") {
				fragments.delete(namespace);
			} else {
				fragments.set(namespace, text);
			}
			const composed = composeStatus();
			for (const l of listeners) l(composed);
		},
		composeStatus,
		subscribe(listener) {
			listeners.add(listener);
			listener(composeStatus());
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

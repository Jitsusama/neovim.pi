/**
 * neovim-pi: bidirectional pi ↔ neovim bridge.
 *
 * Pairing is explicit: the agent calls `nvim_attach`
 * on the user's behalf. Pi never auto-attaches to a
 * random nvim that happens to be running.
 *
 * A pairing is session-scoped: pi remembers the chosen
 * socket via `pi.appendEntry`, so a `/reload` restores
 * the previous pairing automatically if the socket is
 * still alive. Detaches are remembered too.
 *
 * Lifecycle:
 *   session_start    → render status, try to silently
 *                      reattach if session log records
 *                      a still-live socket
 *   session_shutdown → close socket; nvim stays running
 *
 * Registration is the only thing this file does. Every
 * substantive concern lives in `src/`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { attachToSocket, detachFromNeovim, getClient } from "./src/attach.js";
import { installCursorStream } from "./src/cursor.js";
import { socketExists } from "./src/discovery.js";
import { registerEditorTools } from "./src/editor-tools.js";
import { registerEventBridge } from "./src/event-bridge.js";
import { registerLifecycleTools } from "./src/lifecycle-tools.js";
import { forgetPairing, lastPairing } from "./src/state.js";
import { clearStatus, renderStatus } from "./src/status-line.js";
import { registerNvimTools } from "./src/tools.js";

export default async function (pi: ExtensionAPI) {
	// -- Cross-extension registration bridge --
	//
	// Subscribe to `neovim-pi:register-handler` and
	// `neovim-pi:remove-handler` events so other pi extensions
	// can install `pi.*` method handlers without importing
	// from neovim-pi directly (which they can't, because pi
	// loads packages with isolated module roots). Emits
	// `neovim-pi:ready` once subscribed so emitters that
	// loaded earlier can retry their registration.
	registerEventBridge(pi.events);

	// -- Human-cursor push stream receiver --
	//
	// Register the `cursor.moved` notification handler once, at
	// activation. The handler map is process-scoped and survives
	// reattach, so a single install backs every pairing; nvim is
	// told to start emitting in `attachToSocket`.
	installCursorStream();

	// -- Lifecycle: restore prior pairing if still alive --

	pi.on("session_start", async (_event, ctx) => {
		const socket = lastPairing(ctx);
		if (!socket) {
			renderStatus(ctx, false);
			return;
		}

		if (!(await socketExists(socket))) {
			// Nvim died or moved on. Forget the stale pairing so we
			// don't try again next reload.
			forgetPairing(pi);
			renderStatus(ctx, false);
			return;
		}

		try {
			await attachToSocket(socket);
			renderStatus(ctx, true);
		} catch {
			forgetPairing(pi);
			renderStatus(ctx, false);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await detachFromNeovim();
		clearStatus(ctx);
	});

	// -- Tools the agent calls to drive pairing --

	registerLifecycleTools(pi);

	// -- Tools the agent calls to drive an attached nvim --

	registerNvimTools(pi, () => getClient());

	// -- Editor-control tools: edit, view and persist real files --

	registerEditorTools(pi, () => getClient());
}

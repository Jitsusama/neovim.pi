/**
 * Pairing-lifecycle tools the agent calls to manage
 * the nvim connection.
 *
 * The user steers pairing through the agent. There are
 * no slash commands: the skill teaches the agent when
 * to call these.
 *
 *   nvim_list_candidates  -> enumerate listening nvims
 *   nvim_attach           -> pair with one (picker if many)
 *   nvim_detach           -> unpair
 *   nvim_status           -> read current pairing
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { attachToSocket, detachFromNeovim, getClient, getPairedSocket } from "./attach.js";
import { listSocketCandidates, socketExists } from "./discovery.js";
import { forgetPairing, rememberPairing } from "./state.js";
import { renderStatus } from "./status-line.js";

/** Register all pairing-lifecycle tools. */
export function registerLifecycleTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "nvim_list_candidates",
		label: "List nvim candidates",
		description:
			"List nvim instances currently advertising a neovim-pi socket. Use before nvim_attach when the user wants to see what is available.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const candidates = await listSocketCandidates();
			return {
				content: [
					{
						type: "text",
						text:
							candidates.length === 0
								? "no candidate nvim sockets found"
								: candidates.map((c) => `${c.socket} (pid ${c.pid ?? "?"})`).join("\n"),
					},
				],
				details: { candidates },
			};
		},
	});

	pi.registerTool({
		name: "nvim_attach",
		label: "Pair pi with an nvim",
		description:
			"Pair this pi session with a running nvim instance. Pass `socket` to pair with a specific one, or omit to pick interactively when multiple candidates exist.",
		parameters: Type.Object({
			socket: Type.Optional(
				Type.String({
					description: "Absolute path to the nvim socket. Omit to pick from candidates.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const chosen = await chooseSocket(ctx, params.socket);
			const client = await attachToSocket(chosen);
			rememberPairing(pi, chosen);
			renderStatus(ctx, true);

			const channelId = await client.channelId;
			return {
				content: [{ type: "text", text: `paired with ${chosen} (channel ${channelId})` }],
				details: { socket: chosen, channelId },
			};
		},
	});

	pi.registerTool({
		name: "nvim_detach",
		label: "Unpair pi from nvim",
		description: "Release the current nvim pairing. Idempotent.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const wasPaired = getPairedSocket();
			await detachFromNeovim();
			forgetPairing(pi);
			renderStatus(ctx, false);
			return {
				content: [
					{
						type: "text",
						text: wasPaired ? `unpaired from ${wasPaired}` : "no pairing to release",
					},
				],
				details: { wasPaired },
			};
		},
	});

	pi.registerTool({
		name: "nvim_status",
		label: "Report nvim pairing status",
		description: "Report whether pi is paired with an nvim instance and which socket.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const client = getClient();
			const socket = getPairedSocket();
			if (!client || !socket) {
				return {
					content: [{ type: "text", text: "not paired" }],
					details: { attached: false },
				};
			}
			const channelId = await client.channelId;
			return {
				content: [{ type: "text", text: `paired with ${socket} (channel ${channelId})` }],
				details: { attached: true, socket, channelId },
			};
		},
	});
}

/**
 * Resolve which socket to pair with.
 *
 * - explicit param   -> validate and return it
 * - zero candidates  -> error
 * - one candidate    -> auto-pick
 * - multiple         -> ask the user via `ctx.ui.select`
 */
async function chooseSocket(ctx: ExtensionContext, hint?: string): Promise<string> {
	if (hint) {
		if (!(await socketExists(hint))) {
			throw new Error(`no nvim socket at ${hint}`);
		}
		return hint;
	}

	const candidates = await listSocketCandidates();
	if (candidates.length === 0) {
		throw new Error(
			"no candidate nvim sockets found; start nvim with the neovim-pi plugin loaded first",
		);
	}

	const onlyCandidate = candidates[0];
	if (candidates.length === 1 && onlyCandidate) {
		return onlyCandidate.socket;
	}

	const labels = candidates.map(
		(c) => `${c.socket}  (pid ${c.pid ?? "?"}, ${formatAge(c.mtimeMs)})`,
	);
	const chosen = await ctx.ui.select("Pair with which nvim?", labels);
	const index = labels.indexOf(chosen);
	const candidate = candidates[index];
	if (!candidate) {
		throw new Error("no nvim selected");
	}
	return candidate.socket;
}

/** Format a socket's age relative to now, for the picker. */
function formatAge(mtimeMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

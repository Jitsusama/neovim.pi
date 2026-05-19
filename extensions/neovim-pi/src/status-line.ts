/**
 * Status line indicator.
 *
 * A single nerd-font glyph in pi's footer that signals
 * whether nvim is currently paired. Green when paired,
 * dim/muted when not. Replaces verbose text status
 * messages: at-a-glance is all the user needs.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Status-line slot owned by this extension. */
export const STATUS_SLOT = "nvim";

/** Nerd-font vim glyph. Falls back to a `v` if the font lacks it. */
const GLYPH = "\u{e62b}";

/** Render the current pairing state in the footer. */
export function renderStatus(ctx: ExtensionContext, attached: boolean): void {
	const tone = attached ? "success" : "muted";
	ctx.ui.setStatus(STATUS_SLOT, ctx.ui.theme.fg(tone, GLYPH));
}

/** Clear the footer slot (on session shutdown). */
export function clearStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_SLOT, undefined);
}

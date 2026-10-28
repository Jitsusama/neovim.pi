/**
 * Status line indicator.
 *
 * Vim's mark in pi's footer, in green, while nvim is
 * paired, and nothing at all while it isn't: a mark
 * that is always there says nothing, so the footer carries
 * it only when it is true.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Status-line slot owned by this extension. */
export const STATUS_SLOT = "nvim";

/** Nerd-font vim glyph. Falls back to a `v` if the font lacks it. */
const GLYPH = "\u{e62b}";

/** Show the pairing in the footer while there is one, and clear it otherwise. */
export function renderStatus(ctx: ExtensionContext, attached: boolean): void {
	ctx.ui.setStatus(STATUS_SLOT, attached ? ctx.ui.theme.fg("success", GLYPH) : undefined);
}

/** Clear the footer slot (on session shutdown). */
export function clearStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_SLOT, undefined);
}

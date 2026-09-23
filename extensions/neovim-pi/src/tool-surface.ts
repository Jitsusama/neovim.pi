/**
 * Which neovim tools a session carries.
 *
 * Every active tool's definition is sent at the front of every request,
 * so a tool that cannot do anything still costs its definition on every
 * turn. The editor tools need a paired nvim to do anything at all, and
 * pairing is explicit: most sessions never pair. So they are carried
 * only while paired, and the pairing tools, which is how a pairing
 * starts, are carried always.
 *
 * Switching tools on or off mid-session rewrites the prompt cache once,
 * since definitions lead the prompt. Pairing and unpairing are rare, so
 * that is a cost paid once per pairing rather than on every turn.
 */

/** Tools that act on a paired nvim and do nothing without one. */
export const PAIRED_ONLY_TOOLS: readonly string[] = [
	"nvim_buffer_open",
	"nvim_file",
	"nvim_text",
	"nvim_buffer",
	"nvim_window",
	"nvim_cursor",
	"nvim_diff",
];

const PAIRED_ONLY: ReadonlySet<string> = new Set(PAIRED_ONLY_TOOLS);

/**
 * The active tool list with the editor tools set for whether a pairing
 * is live. Every other tool is left exactly as it was, in order, so
 * another extension's choices are neither undone nor overridden.
 */
export function pairedToolSurface(
	active: readonly string[],
	registered: readonly string[],
	paired: boolean,
): string[] {
	const others = active.filter((name) => !PAIRED_ONLY.has(name));
	const editor = paired ? registered.filter((name) => PAIRED_ONLY.has(name)) : [];
	return [...others, ...editor];
}

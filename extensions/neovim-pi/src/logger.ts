/**
 * Logger override for the npm `neovim` package.
 *
 * The package patches the global `console` to redirect
 * writes through its own winston logger, because using
 * `console.log` on stdout would corrupt a stdio-based
 * RPC channel. We attach over a Unix socket, so that
 * concern doesn't apply, and we don't want our pi
 * extension's `console.log` to be hijacked.
 *
 * Pass `silentLogger()` as `options.logger` to `attach()`
 * and the package leaves `console` alone.
 */

interface NoOpLogger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

/** Returns a logger that drops everything on the floor. */
export function silentLogger(): NoOpLogger {
	const noop = () => {};
	return { debug: noop, info: noop, warn: noop, error: noop };
}

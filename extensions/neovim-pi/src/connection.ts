/**
 * The socket under a pairing.
 *
 * The `neovim` client can open a socket itself, but it reads
 * one by iterating the stream with no handler on the result,
 * so a socket that errors becomes a rejection nobody handles.
 * Pi has no handler for one, so pi exits. A socket file with
 * nobody listening is exactly what an nvim that died hard
 * leaves behind, and a remembered pairing tries it at every
 * session start.
 *
 * So this side makes the connection and waits for it to be
 * made, which turns a refusal into an ordinary failure, and
 * hands the client a stream that can end but never errors, so
 * a socket that fails later reads as a hang-up, which the
 * client already turns into a disconnect.
 */

import { createConnection, type Socket } from "node:net";
import { PassThrough } from "node:stream";

/** An open connection to an nvim socket. */
export interface Link {
	/** What the client reads: the socket's bytes, ending when it closes. */
	readonly reader: NodeJS.ReadableStream;
	/** What the client writes to. */
	readonly writer: NodeJS.WritableStream;
	/** Settles once the socket has closed, for whatever reason. */
	readonly closed: Promise<void>;
	/** Close this side, which nvim sees as a detach, never a quit. */
	close(): void;
}

/**
 * Connect to an nvim socket, answering once the connection is
 * made. Rejects when it cannot be, a stale socket among them.
 */
export function connectTo(path: string): Promise<Link> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		socket.once("error", reject);
		socket.once("connect", () => {
			socket.off("error", reject);
			resolve(linkOver(socket));
		});
	});
}

function linkOver(socket: Socket): Link {
	const reader = new PassThrough();
	socket.pipe(reader);
	// Whatever went wrong, the client hears only that the socket
	// closed: once the error closes it, the reader ends below.
	socket.on("error", () => {});
	const closed = new Promise<void>((settle) => {
		socket.once("close", () => {
			if (!reader.writableEnded) reader.end();
			settle();
		});
	});
	return {
		reader,
		writer: socket,
		closed,
		close: () => {
			socket.end();
		},
	};
}

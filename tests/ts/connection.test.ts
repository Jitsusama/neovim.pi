import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTo } from "../../extensions/neovim-pi/src/connection.js";

/**
 * The link's promise is that a socket failing under a pairing reads
 * as a hang-up. The `neovim` client iterates what it reads with no
 * handler on the result, so a reader that errors is a rejection
 * nobody handles, and a socket error with no listener is an uncaught
 * exception. Either ends pi.
 */

let dir: string;
let server: Server;
let problems: unknown[];

const collect = (reason: unknown): void => {
	problems.push(reason);
};

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "nvc-"));
	server = createServer(() => {});
	await new Promise<void>((done) => server.listen(join(dir, "s.sock"), done));
	problems = [];
	process.on("unhandledRejection", collect);
	process.on("uncaughtException", collect);
});

afterEach(() => {
	server.close();
	process.off("unhandledRejection", collect);
	process.off("uncaughtException", collect);
	rmSync(dir, { recursive: true, force: true });
});

describe("a link whose socket fails", () => {
	it("reads as a hang-up: the reader ends, it closes, and nothing escapes", async () => {
		const link = await connectTo(join(dir, "s.sock"));
		const heard: string[] = [];
		link.reader.on("error", () => heard.push("error"));
		link.reader.on("end", () => heard.push("end"));
		link.reader.resume();

		(link.writer as Socket).destroy(new Error("the socket failed"));
		await link.closed;
		await new Promise((done) => setTimeout(done, 100));

		expect(problems).toEqual([]);
		expect(heard).toEqual(["end"]);
	});
});

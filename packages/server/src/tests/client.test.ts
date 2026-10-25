import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError, createClient, resolveClientPath } from "../client.ts";

test("a missing daemon socket rejects the stream without an uncaught process error", async () => {
  const socketPath = join(tmpdir(), `wc-${crypto.randomUUID()}.sock`);
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    import assert from "node:assert/strict";
    import { createClient } from ${JSON.stringify(new URL("../client.ts", import.meta.url).href)};
    await assert.rejects(createClient({ socketPath: ${JSON.stringify(socketPath)} }).stream({ onMessage() {} }));
    await Bun.sleep(25);
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
});

test("registration resolves relative to client not daemon without changing path bytes", () => {
  expect(resolveClientPath(" directory ", "/client")).toBe("/client/ directory ");
  expect(resolveClientPath("~/tree")).toBe(join(homedir(), "tree"));
  expect(resolveClientPath("~")).toBe(homedir());
  expect(resolveClientPath("/full\npath\\x", "/client")).toBe("/full\npath\\x");
  for (const path of ["", " ", "~other/tree", "a\0b"]) {
    expect(() => resolveClientPath(path)).toThrow();
  }
});

test("field attribution survives HTTP and client but untrusted fields do not", async () => {
  const socketPath = join(process.env.TMPDIR ?? "/tmp", `wc-client-${crypto.randomUUID()}.sock`);
  let field: unknown = "path";
  const server = Bun.serve({
    unix: socketPath,
    fetch: () => Response.json({ error: "Invalid field", field }, { status: 400 }),
  });
  try {
    const client = createClient({ socketPath });
    for (const value of [
      "path",
      "name",
      "title",
      "constructor",
      {},
      { toString: null, valueOf: null },
      null,
    ]) {
      field = value;
      try {
        await client.command({ type: "session.create", name: "test" });
        throw new Error("accepted failure");
      } catch (error) {
        if (typeof value === "string" && ["path", "name", "title"].includes(value)) {
          expect(error).toBeInstanceOf(ApiError);
          expect(String((error as ApiError).field)).toBe(String(value));
        } else {
          expect((error as ApiError).field).toBeUndefined();
          expect((error as Error).message).toBe("Invalid field");
        }
      }
    }
  } finally {
    await server.stop(true);
  }
});

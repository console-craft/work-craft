import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "./client";

test("an incompatible live daemon is rejected without commands, spawning or signalling it", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR!, "opencode", "identity-"));
  let requests = 0;
  let protocol: string | undefined;
  const server = Bun.serve({
    unix: join(directory, "daemon.sock"),
    fetch() {
      requests++;
      return Response.json({ epoch: "old", revision: 1, pid: process.pid, protocol });
    },
  });
  try {
    const client = createClient({ socketPath: join(directory, "daemon.sock") });
    for (protocol of [undefined, "work-craft/old"]) {
      await expect(client.ensureDaemon()).rejects.toThrow("Incompatible daemon");
      expect(requests).toBe(protocol === undefined ? 1 : 2);
    }
    protocol = "work-craft-projection-preview/1";
    await client.ensureDaemon();
    expect(requests).toBe(3);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true });
  }
});

test("stream identity rejects old or missing protocols before exposing a usable sender", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR!, "opencode", "stream-id-"));
  let protocol: string | undefined;
  let messages = 0;
  const server = Bun.serve({
    unix: join(directory, "d.sock"),
    fetch(request, server) {
      if (!server.upgrade(request)) {
        return new Response("upgrade", { status: 400 });
      }
    },
    websocket: {
      open(socket) {
        socket.send(
          JSON.stringify({ type: "client.ready", epoch: "old", connectionId: "old", protocol }),
        );
      },
      message() {
        messages++;
      },
    },
  });
  try {
    const client = createClient({ socketPath: join(directory, "d.sock") });
    for (protocol of [undefined, "old"]) {
      await expect(
        client.stream({
          onMessage() {
            throw new Error("Must not publish an incompatible stream");
          },
        }),
      ).rejects.toThrow("Incompatible daemon");
    }
    expect(messages).toBe(0);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true });
  }
});

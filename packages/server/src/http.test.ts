import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { createClient } from "./client.ts";
import { openDatabase } from "./database.ts";
import { startHttpServer } from "./http.ts";
import type { ServerMessage } from "./protocol.ts";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-http-"));
  const db = openDatabase(join(directory, "work-craft.db"));
  const socketPath = join(directory, "work-craft.sock");
  const server = startHttpServer(createApp({ db }), socketPath);

  return {
    client: createClient({ socketPath }),
    db,
    socketPath,
    async close() {
      await server.stop(true);
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a reconnect receives one coherent current snapshot", async () => {
  const fixture = await startTestServer();
  try {
    const first = await fixture.client.streamOnce();
    expect(first.type).toBe("snapshot");

    await fixture.client.command({ type: "session.create", name: "Main" });

    const reconnected = await fixture.client.streamOnce();
    expect(reconnected.type).toBe("snapshot");
    if (reconnected.type === "snapshot") {
      expect(reconnected.snapshot.revision).toBe(1);
      expect(reconnected.snapshot.sessions[0]?.name).toBe("Main");
    }
  } finally {
    await fixture.close();
  }
});

test("the Unix socket is owner-only", async () => {
  const fixture = await startTestServer();
  try {
    expect((await stat(fixture.socketPath)).mode & 0o777).toBe(0o600);
  } finally {
    await fixture.close();
  }
});

test("stops the Unix listener when setting owner-only mode fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-http-"));
  const db = openDatabase(join(directory, "work-craft.db"));
  const socketPath = join(directory, "work-craft.sock");
  const serveSpy = spyOn(Bun, "serve");
  const chmodSpy = spyOn(fs, "chmodSync").mockImplementationOnce(() => {
    throw new Error("chmod failed");
  });

  try {
    expect(() => startHttpServer(createApp({ db }), socketPath)).toThrow("chmod failed");
    await expect(fetch("http://localhost/health", { unix: socketPath })).rejects.toThrow();
  } finally {
    chmodSpy.mockRestore();
    const server = serveSpy.mock.results[0]?.value as Bun.Server<undefined> | undefined;
    serveSpy.mockRestore();
    await server?.stop(true);
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("routes endpoint failures by error class", async () => {
  const fixture = await startTestServer();
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://localhost${path}`, { ...init, unix: fixture.socketPath });
  try {
    const protocolError = await request("/command", {
      method: "POST",
      body: JSON.stringify({ type: "session.create", name: " " }),
    });
    expect(protocolError.status).toBe(400);
    expect(await protocolError.json()).toEqual({ error: "name must be a non-blank string" });

    expect((await request("/missing")).status).toBe(404);

    const before = await fixture.client.health();
    fixture.db.exec("DROP TABLE sessions");
    const unexpectedError = await request("/command", {
      method: "POST",
      body: JSON.stringify({ type: "session.create", name: "Main" }),
    });
    expect(unexpectedError.status).toBe(500);
    expect(await fixture.client.health()).toEqual(before);
  } finally {
    await fixture.close();
  }
});

test("only successful durable commands advance and broadcast snapshots", async () => {
  const fixture = await startTestServer();
  const messages: ServerMessage[] = [];
  let receiveFirst!: () => void;
  let receiveSecond!: () => void;
  const firstMessage = new Promise<void>((resolve) => (receiveFirst = resolve));
  const secondMessage = new Promise<void>((resolve) => (receiveSecond = resolve));
  let connection;

  try {
    connection = await fixture.client.stream({
      onMessage(message) {
        messages.push(message);
        if (messages.length === 1) {
          receiveFirst();
        } else if (messages.length === 2) {
          receiveSecond();
        }
      },
    });
    await firstMessage;

    const created = await fixture.client.command({ type: "session.create", name: "Main" });
    await secondMessage;
    expect(created.revision).toBe(1);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      type: "snapshot",
      snapshot: { revision: 1, sessions: [{ name: "Main" }] },
    });

    await expect(
      fixture.client.command({ type: "workspace.create", sessionId: "missing", name: "Nope" }),
    ).rejects.toThrow("session not found");
    expect(await fixture.client.command({ type: "daemon.stop" })).toEqual({
      ok: true,
      revision: 1,
      result: { id: "daemon", stopping: true },
    });
    await Bun.sleep(20);
    expect((await fixture.client.health()).revision).toBe(1);
    expect(messages).toHaveLength(2);
  } finally {
    connection?.close();
    await fixture.close();
  }
});

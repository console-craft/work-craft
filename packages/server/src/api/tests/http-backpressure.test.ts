import { expect, spyOn, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import WebSocket from "ws";

import { createApp } from "../../application/app.ts";
import { openDatabase } from "../../persistence/database.ts";
import { startHttpServer } from "../http.ts";
import type { ServerMessage } from "../protocol.ts";

async function fixture(mode: "control" | "full" = "full") {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-backpressure-"));
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  let peer!: Bun.ServerWebSocket<unknown>;
  const subscribe = app.subscribe;
  const capture = spyOn(app, "subscribe").mockImplementation((socket, options) => {
    peer = socket;
    subscribe(socket, options);
  });
  const socketPath = join(directory, "stream.sock");
  const server = startHttpServer(app, socketPath);
  const socket = new WebSocket(
    `ws+unix:${socketPath}:/stream${mode === "control" ? "?view=control" : ""}`,
  );
  const messages: ServerMessage[] = [];
  let closed = false;
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  socket.on("close", () => {
    closed = true;
  });
  await once(socket, "open");
  return {
    app,
    peer,
    socket,
    messages,
    closed: () => closed,
    async close() {
      socket.resume();
      socket.terminate();
      capture.mockRestore();
      await server.stop(true);
      await app.history.close();
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(predicate()).toBe(true);
}

function burst(peer: Bun.ServerWebSocket<unknown>, chunks: number): void {
  const data = Buffer.alloc(16_384, 120).toString("base64");
  for (let i = 0; i < chunks; i++) {
    peer.send(
      JSON.stringify({
        type: "terminal.output",
        epoch: "burst",
        paneId: `pane-${i % 4}`,
        cursor: (Math.floor(i / 4) + 1) * 16_384,
        geometrySequence: 0,
        data,
      }),
    );
  }
}

for (const mode of ["control", "full"] as const) {
  test(`${mode}: a paused stream survives four MiB of raw pane output and still accepts commands`, async () => {
    const a = await fixture(mode);
    try {
      a.socket.pause();
      burst(a.peer, 256);
      await Bun.sleep(100);
      a.socket.resume();
      await waitFor(
        () =>
          a.closed() || a.messages.filter(({ type }) => type === "terminal.output").length === 256,
      );
      expect(a.closed()).toBe(false);
      expect(a.messages.filter(({ type }) => type === "terminal.output")).toHaveLength(256);
      a.socket.send(JSON.stringify({ type: "client.attach", sessionId: null, requestId: 1 }));
      await waitFor(() => a.messages.some(({ type }) => type === "client.attached"));
      const attachment = a.messages.find((m) => m.type === "client.attached")!;
      if (attachment.type !== "client.attached") {
        throw new Error("Missing attachment");
      }
      a.socket.send(
        JSON.stringify({
          type: "client.command",
          requestId: 2,
          attachmentGeneration: attachment.attachment.generation,
          command: { type: "session.create", name: "After burst" },
        }),
      );
      await waitFor(() => a.messages.some(({ type }) => type === "command.result"));
      expect(a.app.snapshot().sessions[0]?.name).toBe("After burst");
    } finally {
      await a.close();
    }
  });
}

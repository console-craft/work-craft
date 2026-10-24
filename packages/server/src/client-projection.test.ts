import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompactMaterialFrame } from "./api/terminal-material";
import type { TerminalProjectionRequest } from "./api/terminal-projection-protocol";
import { createClient } from "./client";

const context = {
  epoch: "e",
  attachmentGeneration: 1,
  navigationGeneration: 2,
  geometrySequence: 3,
  runtimeGeneration: 4,
};
const frame: CompactMaterialFrame = {
  size: { cols: 1, rows: 1 },
  cursor: { x: 0, y: 0, visible: true, style: "bar", blinking: false },
  styles: [{ fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 }],
  rows: [[[1, "x", 1, 0]]],
};

async function fixture() {
  const received: TerminalProjectionRequest[] = [];
  const published: string[] = [];
  let stale = false;
  const directory = await mkdtemp(join(tmpdir(), "wc-projection-"));
  const socketPath = join(directory, "d.sock");
  const server = Bun.serve({
    unix: socketPath,
    fetch(request, server) {
      if (!server.upgrade(request)) {
        return new Response("upgrade required", { status: 400 });
      }
    },
    websocket: {
      open(socket) {
        socket.send(
          JSON.stringify({
            type: "client.ready",
            epoch: "e",
            connectionId: "test",
            protocol: "work-craft-projection-preview/1",
          }),
        );
      },
      message(socket, data) {
        const message = JSON.parse(data.toString()) as TerminalProjectionRequest;
        received.push(message);
        function reply(): void {
          socket.send(
            JSON.stringify(
              message.type === "terminal.material"
                ? {
                    type: "terminal.material.result",
                    requestId: message.requestId,
                    material: {
                      paneId: message.paneId,
                      context: {
                        ...message.context,
                        runtimeGeneration: stale ? 999 : message.context.runtimeGeneration,
                      },
                      sequence: 1,
                      frame,
                    },
                  }
                : {
                    type: "terminal.input.result",
                    requestId: message.requestId,
                    forwarded:
                      message.type === "terminal.semantic" ||
                      message.transfer.operation === "commit",
                  },
            ),
          );
        }
        reply();
      },
    },
  });
  const connection = await createClient({ socketPath }).stream({
    onMessage: (message) => published.push(message.type),
  });
  return {
    connection,
    received,
    published,
    stale() {
      stale = true;
    },
    async close() {
      connection.close();
      await server.stop(true);
      await rm(directory, { recursive: true });
    },
  };
}

test("material replies retain their capture and never publish root shell messages", async () => {
  const f = await fixture();
  try {
    const material = await f.connection.requestMaterial("p", context, 0);
    expect(material).toEqual({ paneId: "p", context, sequence: 1, frame });
    expect(f.received[0]).toMatchObject({ type: "terminal.material", context, scrollOffset: 0 });
    expect(f.published).toEqual([]);
    f.stale();
    await expect(f.connection.requestMaterial("p", context, 0)).rejects.toThrow("scope");
  } finally {
    await f.close();
  }
});

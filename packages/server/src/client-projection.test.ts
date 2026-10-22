import { expect, test } from "bun:test";
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
  let hold = false;
  let stale = false;
  let respond: (() => void) | undefined;
  const socketPath = join(
    process.env.TMPDIR ?? "/tmp",
    "opencode",
    `projection-${crypto.randomUUID()}.sock`,
  );
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
        if (hold) {
          respond = reply;
        } else {
          reply();
        }
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
    hold() {
      hold = true;
    },
    stale() {
      stale = true;
    },
    reply() {
      respond?.();
    },
    async close() {
      connection.close();
      await server.stop(true);
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

test("aborted material requests drop late replies instead of publishing obsolete pictures", async () => {
  const f = await fixture();
  try {
    f.hold();
    const abort = new AbortController();
    const request = f.connection.requestMaterial("p", context, 0, abort.signal);
    const rejected = request.catch((error) => error);
    while (f.received.length === 0) {
      await Bun.sleep(1);
    }
    abort.abort();
    expect(await rejected).toBeInstanceOf(Error);
    f.reply();
    await Bun.sleep(5);
    expect(f.published).toEqual([]);
  } finally {
    await f.close();
  }
});

test("paste snapshots caller bytes and sends bounded base64 chunks with the original context", async () => {
  const f = await fixture();
  try {
    const bytes = Array.from({ length: 70000 }, () => 120);
    const captured = {
      ...context,
      source: "input" as const,
      kind: "paste" as const,
      activitySequence: 7,
    };
    const sending = f.connection.sendSemantic("p", { kind: "paste", bytes }, captured);
    bytes.fill(0);
    expect(await sending).toEqual({ forwarded: true });
    const transfers = f.received
      .filter((message) => message.type === "terminal.paste")
      .map((message) => message.transfer);
    expect(transfers.map((transfer) => transfer.operation)).toEqual([
      "begin",
      "chunk",
      "chunk",
      "commit",
    ]);
    const chunks = transfers.filter((transfer) => transfer.operation === "chunk");
    expect(chunks.map((transfer) => Buffer.from(transfer.data, "base64").length)).toEqual([
      65536, 4464,
    ]);
    expect(Buffer.concat(chunks.map((transfer) => Buffer.from(transfer.data, "base64")))).toEqual(
      Buffer.alloc(70000, 120),
    );
    expect(
      f.received.every((message) => JSON.stringify(message.context) === JSON.stringify(captured)),
    ).toBe(true);
    expect(
      Math.max(...f.received.map((message) => Buffer.byteLength(JSON.stringify(message)))),
    ).toBeLessThan(90000);
    expect(f.published).toEqual([]);
  } finally {
    await f.close();
  }
});

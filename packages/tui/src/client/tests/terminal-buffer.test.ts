import { expect, test } from "bun:test";

import { appendTerminalChunk, snapshotTerminals } from "@/client/terminal-buffer";
import { snapshotFixture, terminalBufferFixture } from "@/tests/support/fixtures";

test("snapshot history appends only missing bytes and retains unchanged map identity", () => {
  const history = new TextEncoder().encode("old");
  const original = terminalBufferFixture({ history, historyCursor: 3 });
  const current = new Map([["p", original]]);
  const snapshot = snapshotFixture({
    terminalHistories: [
      {
        paneId: "p",
        cursor: 6,
        data: Buffer.from("oldnew").toString("base64"),
        truncated: false,
        startCursor: 0,
        prefixBytes: 0,
        initialSize: { cols: 80, rows: 24 },
        initialGridSequence: 0,
        resizes: [],
      },
    ],
  });
  const updated = snapshotTerminals(snapshot, current);
  expect(updated.get("p")!.history).toBe(history);
  expect(
    updated.get("p")!.chunks.map((chunk) => [chunk.cursor, new TextDecoder().decode(chunk.data)]),
  ).toEqual([[6, "new"]]);
  expect(snapshotTerminals(snapshot, updated)).toBe(updated);
  snapshot.terminalHistories[0]!.cursor = 3;
  snapshot.terminalHistories[0]!.data = Buffer.from("old").toString("base64");
  expect(snapshotTerminals(snapshot, updated)).toBe(updated);
  snapshot.epoch = "new-epoch";
  snapshot.terminalHistories[0]!.cursor = 6;
  snapshot.terminalHistories[0]!.data = Buffer.from("fresh!").toString("base64");
  const reset = snapshotTerminals(snapshot, updated).get("p")!;
  expect(new TextDecoder().decode(reset.history)).toBe("fresh!");
  expect(reset.chunks).toEqual([]);
  expect(reset.epoch).toBe("new-epoch");
});

test("chunk retention trims the oldest partial chunk without changing its terminal cursor", () => {
  const original = terminalBufferFixture({
    epoch: "e",
    history: new Uint8Array(),
    historyCursor: 0,
    chunks: [],
  });
  const first = appendTerminalChunk(original, 4, new Uint8Array([1, 2, 3, 4]), 0);
  const retained = appendTerminalChunk(first, 1_048_578, new Uint8Array(1_048_574).fill(5), 0);
  expect(retained.chunks.reduce((size, chunk) => size + chunk.data.byteLength, 0)).toBe(1_048_576);
  expect(retained.chunks[0]!.cursor).toBe(4);
  expect([...retained.chunks[0]!.data]).toEqual([3, 4]);
  expect([...first.chunks[0]!.data]).toEqual([1, 2, 3, 4]);
  const replaced = appendTerminalChunk(retained, 2_097_155, new Uint8Array(1_048_577).fill(6), 0);
  expect(replaced.chunks).toHaveLength(1);
  expect(replaced.chunks[0]!.data.byteLength).toBe(1_048_576);
  expect(replaced.chunks[0]!.cursor).toBe(2_097_155);
});

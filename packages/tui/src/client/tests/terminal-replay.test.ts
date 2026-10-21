import { expect, test } from "bun:test";

import type { TerminalBuffer } from "@/client/terminal-buffer";
import { appendTerminalChunk } from "@/client/terminal-buffer";
import { terminalReplaySteps } from "@/client/terminal-replay";

const encode = (text: string) => new TextEncoder().encode(text);

function buffer(overrides: Partial<TerminalBuffer> = {}): TerminalBuffer {
  return {
    epoch: "e",
    history: encode("abcdefgh"),
    historyStartCursor: 0,
    historyPrefixBytes: 0,
    historyCursor: 8,
    initialSize: { cols: 80, rows: 24 },
    initialGridSequence: 0,
    resizes: [],
    chunks: [],
    ...overrides,
  };
}

test("replay applies same-cursor resizes before later bytes", () => {
  const current = buffer({
    history: encode("1234567"),
    historyCursor: 7,
    resizes: [
      { cursor: 7, sequence: 1, cols: 100, rows: 30 },
      { cursor: 7, sequence: 2, cols: 80, rows: 24 },
      { cursor: 7, sequence: 3, cols: 120, rows: 40 },
    ],
    chunks: [{ cursor: 10, data: encode("abc"), geometrySequence: 4, origin: "live" }],
  });
  const result = terminalReplaySteps(current, { cursor: 7, gridSequence: 0 });
  expect(result.needsSnapshot).toBe(false);
  expect(result.steps.map(({ type }) => type)).toEqual(["resize", "resize", "resize", "bytes"]);
  expect(result.steps.at(-1)).toEqual({
    type: "bytes",
    cursor: 10,
    data: encode("abc"),
    origin: "live",
  });
});

test("a grid marker splits a history chunk at its absolute cursor", () => {
  const result = terminalReplaySteps(
    buffer({
      history: encode("abcd"),
      historyCursor: 4,
      resizes: [{ cursor: 2, sequence: 1, cols: 100, rows: 30 }],
    }),
    null,
  );
  expect(result.needsSnapshot).toBe(false);
  expect(result.steps).toEqual([
    { type: "resize", marker: { cursor: 0, sequence: 0, cols: 80, rows: 24 } },
    { type: "bytes", cursor: 2, data: encode("ab"), origin: "history" },
    { type: "resize", marker: { cursor: 2, sequence: 1, cols: 100, rows: 30 } },
    { type: "bytes", cursor: 4, data: encode("cd"), origin: "history" },
  ]);
});

test("a synthetic truncation prefix does not shift byte-cursor resize boundaries", () => {
  const result = terminalReplaySteps(
    buffer({
      history: encode("\x1bcabcd"),
      historyPrefixBytes: 2,
      historyStartCursor: 10,
      historyCursor: 14,
      initialGridSequence: 5,
      resizes: [{ cursor: 12, sequence: 6, cols: 100, rows: 30 }],
    }),
    null,
  );
  expect(result.needsSnapshot).toBe(false);
  expect(result.steps.filter((step) => step.type === "bytes").map(({ cursor }) => cursor)).toEqual([
    10, 12, 14,
  ]);
  expect(result.steps[3]).toEqual({
    type: "resize",
    marker: { cursor: 12, sequence: 6, cols: 100, rows: 30 },
  });
});

for (const liveBytes of [1_048_576, 2_097_152]) {
  test(`full history plus ${liveBytes} live bytes excludes the reset prefix from replay accounting`, () => {
    const prefix = encode("\x1bc\r\n[work-craft: earlier terminal output truncated]\r\n");
    const history = new Uint8Array(prefix.byteLength + 1_048_576).fill(120);
    history.set(prefix);
    const current = appendTerminalChunk(
      buffer({
        history,
        historyPrefixBytes: prefix.byteLength,
        historyStartCursor: 10,
        historyCursor: 1_048_586,
      }),
      1_048_586 + liveBytes,
      new Uint8Array(liveBytes).fill(121),
      0,
    );
    const unread = terminalReplaySteps(current, { cursor: 1_048_586, gridSequence: 0 });
    expect(unread.needsSnapshot).toBe(false);
    expect(unread.steps).toHaveLength(1);
    expect(unread.steps[0]).toMatchObject({ type: "bytes", cursor: 1_048_586 + liveBytes });
    expect(unread.steps[0]!.type === "bytes" && unread.steps[0]!.data.byteLength).toBe(liveBytes);
    expect(
      terminalReplaySteps(current, { cursor: 1_048_586 + liveBytes, gridSequence: 0 }),
    ).toEqual({ steps: [], needsSnapshot: false });
  });
}

test("replay still rejects oversized raw buffers and invalid synthetic prefix offsets", () => {
  const oversized = new Uint8Array(3_145_729);
  expect(
    terminalReplaySteps(buffer({ history: oversized, historyCursor: oversized.length }), null),
  ).toEqual({ steps: [], needsSnapshot: true });
  for (const historyPrefixBytes of [-1, 9]) {
    expect(terminalReplaySteps(buffer({ historyPrefixBytes }), null)).toEqual({
      steps: [],
      needsSnapshot: true,
    });
  }
});

test("legacy bytes precede the first known resize without guessed old dimensions", () => {
  const result = terminalReplaySteps(
    buffer({
      initialSize: null,
      initialGridSequence: null,
      resizes: [{ cursor: 8, sequence: 1, cols: 100, rows: 30 }],
    }),
    null,
  );
  expect(result.steps.map(({ type }) => type)).toEqual(["bytes", "resize"]);
  expect(result.needsSnapshot).toBe(false);
});

test("missing byte or resize intervals request a snapshot instead of parsing at a guessed grid", () => {
  const byteGap = buffer({
    chunks: [{ cursor: 12, data: encode("xy"), geometrySequence: 1, origin: "live" }],
  });
  expect(terminalReplaySteps(byteGap, null)).toEqual({ steps: [], needsSnapshot: true });
  const gridGap = buffer({ resizes: [{ cursor: 8, sequence: 2, cols: 100, rows: 30 }] });
  expect(terminalReplaySteps(gridGap, null)).toEqual({ steps: [], needsSnapshot: true });
});

test("retiring already parsed output does not force a reconnect-sized history replay", () => {
  const initial = buffer({ history: new Uint8Array(), historyCursor: 0 });
  const first = appendTerminalChunk(initial, 1_200_000, new Uint8Array(1_200_000).fill(120), 0);
  expect(terminalReplaySteps(first, { cursor: 0, gridSequence: 0 }).needsSnapshot).toBe(false);
  const second = appendTerminalChunk(first, 2_400_000, new Uint8Array(1_200_000).fill(121), 0);
  const replay = terminalReplaySteps(second, { cursor: 1_200_000, gridSequence: 0 });
  expect(replay.needsSnapshot).toBe(false);
  expect(replay.steps).toHaveLength(1);
  expect(replay.steps[0]).toMatchObject({ type: "bytes", cursor: 2_400_000 });
  expect(replay.steps[0]!.type === "bytes" && replay.steps[0]!.data.byteLength).toBe(1_200_000);
  // A new or genuinely lagging emulator still cannot invent the retired interval.
  expect(terminalReplaySteps(second, null).needsSnapshot).toBe(true);
  expect(terminalReplaySteps(second, { cursor: 1, gridSequence: 0 }).needsSnapshot).toBe(true);
});

test("a new resize at an already parsed byte cursor is still applied", () => {
  const after = { cursor: 8, gridSequence: 0 };
  expect(terminalReplaySteps(buffer(), after)).toEqual({ steps: [], needsSnapshot: false });
  const marker = { cursor: 8, sequence: 1, cols: 100, rows: 30 };
  expect(terminalReplaySteps(buffer({ resizes: [marker] }), after)).toEqual({
    steps: [{ type: "resize", marker }],
    needsSnapshot: false,
  });
});

test("snapshot-recovered chunks keep replay provenance", () => {
  const result = terminalReplaySteps(
    buffer({
      chunks: [{ cursor: 10, data: encode("\x1bZ"), geometrySequence: 1, origin: "history" }],
    }),
    { cursor: 8, gridSequence: 0 },
  );
  expect(result.steps).toEqual([
    { type: "bytes", cursor: 10, data: encode("\x1bZ"), origin: "history" },
  ]);
});

test("a retained baseline can replace obsolete native replay progress", () => {
  const result = terminalReplaySteps(
    buffer({
      history: encode("\x1bcfgh"),
      historyPrefixBytes: 2,
      historyStartCursor: 5,
      initialSize: { cols: 100, rows: 30 },
      initialGridSequence: 3,
    }),
    { cursor: 1, gridSequence: 0 },
  );
  expect(result.needsSnapshot).toBe(false);
  expect(result.steps[0]).toEqual({
    type: "resize",
    marker: { cursor: 5, sequence: 3, cols: 100, rows: 30 },
  });
  expect(result.steps.at(-1)).toEqual({
    type: "bytes",
    cursor: 8,
    data: encode("fgh"),
    origin: "history",
  });
});

test("replay rejects an over-budget marker backlog without allocating an unbounded step queue", () => {
  const current = buffer({
    resizes: Array.from({ length: 1025 }, (_, i) => ({
      cursor: 8,
      sequence: i + 1,
      cols: 80,
      rows: 24,
    })),
  });
  expect(terminalReplaySteps(current, null)).toEqual({ steps: [], needsSnapshot: true });
});

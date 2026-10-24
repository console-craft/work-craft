import { expect, test } from "bun:test";

import { appendTerminalChunk, mergePaneHistory } from "@/client/terminal-buffer";
import { createTerminalOutputs } from "@/client/terminal-output";
import type * as replay from "@/client/terminal-replay";
import { terminalBufferFixture } from "@/tests/support/fixtures";

test("pane output listeners are isolated and removable while tiny chunks retain a stable channel", () => {
  const outputs = createTerminalOutputs(new Map([["A", terminalBufferFixture()]]));
  const a = outputs.pane("A");
  let aCalls = 0;
  let bCalls = 0;
  const unsubscribe = a.subscribe(() => {
    aCalls++;
  });
  outputs.pane("B").subscribe(() => {
    bCalls++;
  });
  for (let cursor = 1; cursor <= 4096; cursor++) {
    outputs.set("A", appendTerminalChunk(a.read()!, cursor, new Uint8Array([120]), 0));
  }
  expect(outputs.pane("A")).toBe(a);
  expect(a.read()!.chunks.at(-1)!.cursor).toBe(4096);
  expect(aCalls).toBe(4096);
  expect(bCalls).toBe(0);
  unsubscribe();
  outputs.set("A", appendTerminalChunk(a.read()!, 4097, new Uint8Array([121]), 0));
  expect(aCalls).toBe(4096);
});

test("replacing terminal baselines notifies only changed panes and clears removed buffers", () => {
  const first = terminalBufferFixture();
  const outputs = createTerminalOutputs(
    new Map([
      ["A", first],
      ["B", first],
    ]),
  );
  const a = outputs.pane("A");
  const b = outputs.pane("B");
  const changes: string[] = [];
  a.subscribe(() => changes.push("A"));
  b.subscribe(() => changes.push("B"));
  outputs.replace(new Map([["A", first]]));
  expect(changes).toEqual(["B"]);
  expect(b.read()).toBeUndefined();
  expect(a.read()).toBe(first);
  expect(outputs.pane("A")).toBe(a);
});

test("a repeated old unsubscribe cannot remove a newly subscribed pane channel", () => {
  const outputs = createTerminalOutputs();
  const oldUnsubscribe = outputs.pane("A").subscribe(() => {});
  oldUnsubscribe();
  let calls = 0;
  outputs.pane("A").subscribe(() => {
    calls++;
  });
  oldUnsubscribe();
  outputs.set("A", terminalBufferFixture());
  expect(calls).toBe(1);
});

test("split VT bytes and equal-cursor resizes retain exact byte order and reply origin", () => {
  const bytes = new Uint8Array([240, 159, 153, 130, 27, 91, 50, 59, 51, 72]);
  const initial = terminalBufferFixture({
    epoch: "e",
    initialGridSequence: 0,
    resizes: [
      { cursor: 4, sequence: 1, cols: 100, rows: 30 },
      { cursor: 4, sequence: 2, cols: 120, rows: 40 },
    ],
    chunks: [{ cursor: 10, data: bytes, geometrySequence: 2, origin: "live", responseStamp: null }],
  });
  const output = createTerminalOutputs(new Map([["A", initial]])).pane("A");
  let progress: replay.ReplayProgress | null = null;
  const written: number[] = [];
  const resizes: number[] = [];
  let gridSequence = 0;
  for (let step = output.next(progress, 2); step !== null; step = output.next(progress, 2)) {
    if (step === "recover") {
      throw new Error("unexpected recovery");
    }
    if (step.type === "resize") {
      resizes.push(step.marker.sequence);
      gridSequence = step.marker.sequence;
      progress = { cursor: step.marker.cursor, gridSequence: step.marker.sequence };
    } else {
      written.push(...step.data);
      expect(step.origin).toBe("live");
      expect(step.responseStamp).toBeNull();
      expect(step.data.byteLength).toBeLessThanOrEqual(2);
      if (step.cursor > 4) {
        expect(resizes).toEqual([0, 1, 2]);
      }
      progress = { cursor: step.cursor, gridSequence };
    }
    output.consumed(progress);
  }
  expect(written).toEqual([240, 159, 153, 130, 27, 91, 50, 59, 51, 72]);
  expect(resizes).toEqual([0, 1, 2]);
});

test("unread tiny chunks coalesce separately from retained history", () => {
  let buffer = terminalBufferFixture();
  const outputs = createTerminalOutputs(new Map([["A", buffer]]));
  const output = outputs.pane("A");
  output.next(null, 8192);
  const frontier = { cursor: 0, gridSequence: 0 };
  output.consumed(frontier);
  for (let cursor = 1; cursor <= 10000; cursor++) {
    buffer = appendTerminalChunk(buffer, cursor, new Uint8Array([120]), 0);
    outputs.set("A", buffer);
  }
  const first = output.next(frontier, 8192);
  expect(first).toMatchObject({ type: "bytes", cursor: 8192 });
  if (!first || first === "recover" || first.type !== "bytes") {
    throw new Error("expected unread bytes");
  }
  expect(first.data.byteLength).toBe(8192);
  output.consumed({ cursor: 8192, gridSequence: 0 });
  expect(output.next({ cursor: 8192, gridSequence: 0 }, 8192)).toMatchObject({
    type: "bytes",
    cursor: 10000,
  });
});

test("unread resize descriptors recover once beyond the existing marker bound", () => {
  let buffer = terminalBufferFixture();
  const outputs = createTerminalOutputs(new Map([["A", buffer]]));
  const output = outputs.pane("A");
  output.next(null, 8192);
  const frontier = { cursor: 0, gridSequence: 0 };
  output.consumed(frontier);
  for (let sequence = 1; sequence <= 1025; sequence++) {
    buffer = { ...buffer, resizes: [{ cursor: 0, sequence, cols: 100, rows: 30 }] };
    outputs.set("A", buffer);
  }
  expect(output.next(frontier, 8192)).toBe("recover");
});

test("the bootstrap grid does not consume one of the 1024 retained resize slots", () => {
  const initial = terminalBufferFixture({
    resizes: Array.from({ length: 1024 }, (_, index) => ({
      cursor: 0,
      sequence: index + 1,
      cols: 100,
      rows: 30,
    })),
  });
  const output = createTerminalOutputs(new Map([["A", initial]])).pane("A");
  expect(output.next(null, 8192)).toMatchObject({ type: "resize", marker: { sequence: 0 } });
});

test("full history and live budgets exclude the display-only reset prefix", () => {
  const initial = terminalBufferFixture({
    history: new Uint8Array(1024 * 1024 + 3).fill(120),
    historyPrefixBytes: 3,
    historyCursor: 1024 * 1024,
    chunks: [
      {
        cursor: 3 * 1024 * 1024,
        data: new Uint8Array(2 * 1024 * 1024),
        geometrySequence: 0,
        origin: "live",
      },
    ],
  });
  const output = createTerminalOutputs(new Map([["A", initial]])).pane("A");
  expect(output.next(null, 8192)).toMatchObject({ type: "resize" });
});

test("a split display-only prefix never advances the raw cursor without an initial grid marker", () => {
  const initial = terminalBufferFixture({
    initialSize: null,
    initialGridSequence: null,
    history: new Uint8Array([65, 66, 67, 120, 121]),
    historyPrefixBytes: 3,
    historyStartCursor: 100,
    historyCursor: 102,
  });
  const output = createTerminalOutputs(new Map([["A", initial]])).pane("A");
  expect(output.next(null, 2)).toMatchObject({ type: "bytes", cursor: 100 });
  output.consumed({ cursor: 100, gridSequence: null });
  expect(output.next({ cursor: 100, gridSequence: null }, 2)).toMatchObject({
    type: "bytes",
    cursor: 100,
  });
  output.consumed({ cursor: 100, gridSequence: null });
  expect(output.next({ cursor: 100, gridSequence: null }, 2)).toMatchObject({
    type: "bytes",
    cursor: 102,
  });
});

test("history replacement resets only a native consumer whose acknowledged frontier was lost", () => {
  const initial = terminalBufferFixture({ history: new Uint8Array([65]), historyCursor: 1 });
  const outputs = createTerminalOutputs(new Map([["A", initial]]));
  const output = outputs.pane("A");
  output.next(null, 8192);
  output.consumed({ cursor: 0, gridSequence: 0 });
  output.next({ cursor: 0, gridSequence: 0 }, 8192);
  output.consumed({ cursor: 1, gridSequence: 0 });
  const gap = appendTerminalChunk(initial, 3, new Uint8Array([67]), 0);
  outputs.set("A", gap);
  const history = {
    paneId: "A",
    cursor: 2,
    startCursor: 1,
    prefixBytes: 0,
    truncated: false,
    data: "Qg==",
    initialSize: { cols: 80, rows: 24 },
    initialGridSequence: 0,
    resizes: [],
  };
  const repaired = mergePaneHistory(
    { epoch: initial.epoch, paneId: "A", runtimeGeneration: 0, history },
    gap,
    0,
  );
  outputs.set("A", repaired);
  expect(output.read()?.resetGeneration).toBe(0);
  expect(output.next({ cursor: 1, gridSequence: 0 }, 8192)).toMatchObject({
    type: "bytes",
    cursor: 2,
  });
  const lost = mergePaneHistory(
    {
      epoch: initial.epoch,
      paneId: "A",
      runtimeGeneration: 0,
      history: { ...history, cursor: 11, startCursor: 10, data: "eA==" },
    },
    repaired,
    0,
  );
  outputs.set("A", lost);
  expect(output.read()?.resetGeneration).toBe(1);
});

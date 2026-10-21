import { expect, spyOn, test } from "bun:test";

import { appendTerminalChunk } from "@/client/terminal-buffer";
import { createTerminalOutputs } from "@/client/terminal-output";
import * as replay from "@/client/terminal-replay";
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

test("native consumption caps writes and empty drains never rescan retained history", () => {
  const initial = terminalBufferFixture({
    history: new Uint8Array(20000).fill(120),
    historyCursor: 20000,
  });
  const outputs = createTerminalOutputs(new Map([["A", initial]]));
  const output = outputs.pane("A");
  const planning = spyOn(replay, "terminalReplaySteps");
  let progress: replay.ReplayProgress | null = null;
  const writes: number[] = [];
  try {
    for (
      let step = output.next(progress, 8192);
      step !== null;
      step = output.next(progress, 8192)
    ) {
      if (step === "recover") {
        throw new Error("unexpected recovery");
      }
      if (step.type === "resize") {
        progress = { cursor: step.marker.cursor, gridSequence: step.marker.sequence };
      } else {
        writes.push(step.data.byteLength);
        progress = { cursor: step.cursor, gridSequence: 0 };
      }
      output.consumed(progress);
    }
    expect(writes).toEqual([8192, 8192, 3616]);
    const plans = planning.mock.calls.length;
    for (let index = 0; index < 200; index++) {
      expect(output.next(progress, 8192)).toBeNull();
    }
    expect(planning.mock.calls.length).toBe(plans);
    outputs.set("A", appendTerminalChunk(initial, 20001, new Uint8Array([121]), 0));
    expect(output.next(progress, 8192)).toMatchObject({ type: "bytes", cursor: 20001 });
    expect(
      planning.mock.calls.slice(plans).every(([buffer]) => buffer.history.byteLength === 0),
    ).toBe(true);
  } finally {
    planning.mockRestore();
  }
});

test("coalescing tiny retained chunks never crosses a resize, origin or response authority boundary", () => {
  let buffer = terminalBufferFixture();
  for (let cursor = 1; cursor <= 9000; cursor++) {
    buffer = appendTerminalChunk(buffer, cursor, new Uint8Array([120]), 0);
  }
  expect(buffer.chunks.map((chunk) => chunk.data.byteLength)).toEqual([8192, 808]);
  buffer = { ...buffer, resizes: [{ cursor: 9000, sequence: 1, cols: 100, rows: 30 }] };
  buffer = appendTerminalChunk(buffer, 9001, new Uint8Array([121]), 0);
  buffer = appendTerminalChunk(buffer, 9002, new Uint8Array([122]), 0, "history");
  expect(buffer.chunks.map((chunk) => chunk.data.byteLength)).toEqual([8192, 808, 1, 1]);
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

test("unsubscribing the last native leaf releases unread work until a new consumer enters", () => {
  const initial = terminalBufferFixture();
  const outputs = createTerminalOutputs(new Map([["A", initial]]));
  const output = outputs.pane("A");
  const unsubscribe = output.subscribe(() => {});
  output.next(null, 8192);
  output.consumed({ cursor: 0, gridSequence: 0 });
  unsubscribe();
  const planning = spyOn(replay, "terminalReplaySteps");
  try {
    outputs.set("A", appendTerminalChunk(initial, 1, new Uint8Array([120]), 0));
    expect(planning).not.toHaveBeenCalled();
    expect(output.next(null, 8192)).toMatchObject({ type: "resize" });
    expect(planning).toHaveBeenCalledTimes(1);
  } finally {
    planning.mockRestore();
  }
});

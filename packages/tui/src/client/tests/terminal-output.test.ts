import { expect, test } from "bun:test";

import { appendTerminalChunk } from "@/client/terminal-buffer";
import { createTerminalOutputs } from "@/client/terminal-output";
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

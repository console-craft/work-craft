import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";

import { act, useState } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/test-render";

function listenerCounts(emitter: EventEmitter): Record<string, number> {
  return Object.fromEntries(
    emitter
      .eventNames()
      .filter((event) => typeof event === "string")
      .map((event) => [event, emitter.listenerCount(event)]),
  );
}

test("component mount cycles release listeners without false memory-leak warnings", async () => {
  let show!: (visible: boolean) => void;
  function Fixture() {
    const [visible, setVisible] = useState(false);
    show = setVisible;
    return visible ? <ComponentsDemo /> : null;
  }
  const warnings: string[] = [];
  function onWarning(warning: Error): void {
    if (warning.name === "MaxListenersExceededWarning") {
      warnings.push(warning.message);
    }
  }
  process.on("warning", onWarning);
  const processBefore = listenerCounts(process);
  const stdinBefore = listenerCounts(process.stdin);
  const defaultLimit = EventEmitter.defaultMaxListeners;
  const setup = await testRender(<Fixture />, { width: 100, height: 24 });
  const baseline = listenerCounts(setup.renderer);
  const keysBefore = listenerCounts(setup.renderer.keyInput);
  const stdinMounted = listenerCounts(process.stdin);
  try {
    let mounted: Record<string, number> | undefined;
    for (let cycle = 0; cycle < 3; cycle++) {
      await act(async () => {
        show(true);
      });
      await act(async () => setup.flush());
      const counts = listenerCounts(setup.renderer);
      expect(counts.selection).toBeGreaterThan(10);
      expect(counts).toEqual(mounted ?? counts);
      mounted = counts;
      await act(async () => {
        show(false);
      });
      expect(listenerCounts(setup.renderer)).toEqual(baseline);
      expect(listenerCounts(setup.renderer.keyInput)).toEqual(keysBefore);
      expect(listenerCounts(process.stdin)).toEqual(stdinMounted);
    }
  } finally {
    await act(async () => setup.renderer.destroy());
    await setup.renderer.closed;
    process.off("warning", onWarning);
  }
  expect(listenerCounts(process.stdin)).toEqual(stdinBefore);
  // Exclude this test's own warning listener from the post-close comparison.
  processBefore.warning! -= 1;
  expect(listenerCounts(process)).toEqual(processBefore);
  expect(EventEmitter.defaultMaxListeners).toBe(defaultLimit);
  expect(warnings).toEqual([]);
});

test("destroying a mounted component tree keeps React cleanup inside act", async () => {
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
    await act(async () => setup.flush());
    await act(async () => setup.renderer.destroy());
    await setup.renderer.closed;
    expect(errors.filter((message) => message.includes("act("))).toEqual([]);
  } finally {
    error.mockRestore();
  }
});

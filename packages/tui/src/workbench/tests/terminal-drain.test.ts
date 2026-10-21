import { expect, spyOn, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";

import { terminalDrainFor } from "@/workbench/terminal-drain";

test("busy panes round robin and yield once the aggregate two millisecond budget is spent", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
  const drain = terminalDrainFor(setup.renderer);
  let clock = 0;
  const now = spyOn(performance, "now").mockImplementation(() => clock);
  const order: string[] = [];
  let remaining = 3;
  try {
    drain.request("A", () => {
      order.push("A");
      clock++;
      return --remaining > 0;
    });
    drain.request("B", () => {
      order.push("B");
      clock++;
      return false;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["A", "B"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["A", "B", "A", "A"]);
    expect(terminalDrainFor(setup.renderer)).toBe(drain);
  } finally {
    now.mockRestore();
    drain.close();
    setup.renderer.destroy();
  }
});

test("unmount removes only its own pending pane and renderer destruction cancels remaining work", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
  const drain = terminalDrainFor(setup.renderer);
  const order: string[] = [];
  drain.request("A", () => {
    order.push("A");
    return false;
  });
  drain.request("B", () => {
    order.push("B");
    return false;
  });
  drain.remove("A");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(order).toEqual(["B"]);
  drain.request("C", () => {
    order.push("C");
    return true;
  });
  setup.renderer.destroy();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(order).toEqual(["B"]);
});

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { CliRenderEvents, type Clock, type Renderable, TextRenderable } from "@opentui/core";
import { ManualClock, setRendererCapabilities } from "@opentui/core/testing";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/interaction/focus-utils";
import * as notifications from "@/ui/notifications";

const frameClock: Clock = {
  now: performance.now.bind(performance),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
let clock: ManualClock;
let restoreTimers = () => {};

beforeEach(() => {
  clock = new ManualClock();
  const spies = [
    spyOn(globalThis, "setTimeout").mockImplementation(
      clock.setTimeout.bind(clock) as typeof setTimeout,
    ),
    spyOn(globalThis, "clearTimeout").mockImplementation(
      clock.clearTimeout.bind(clock) as typeof clearTimeout,
    ),
    spyOn(globalThis, "setInterval").mockImplementation(
      clock.setInterval.bind(clock) as typeof setInterval,
    ),
    spyOn(globalThis, "clearInterval").mockImplementation(
      clock.clearInterval.bind(clock) as typeof clearInterval,
    ),
    spyOn(performance, "now").mockImplementation(clock.now.bind(clock)),
  ];
  restoreTimers = () => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  };
});
afterEach(() => restoreTimers());

function findText(node: Renderable, text: string): TextRenderable | undefined {
  if (node instanceof TextRenderable && node.plainText === text) {
    return node;
  }
  for (const child of node.getChildren()) {
    const found = findText(child, text);
    if (found) {
      return found;
    }
  }
}

async function renderDemo() {
  // Observe the real factory's result; delivery, history and subscriptions stay real.
  const factory = spyOn(notifications, "createNotificationStore");
  try {
    const setup = await testRender(<ComponentsDemo />, {
      width: 100,
      height: 24,
      clock: frameClock,
    });
    try {
      await act(async () => setup.flush());
      // Table columns resolve from native layout; capture bounds after their reflow.
      await act(async () => setup.flush());
      const notify = factory.mock.results[0]?.value as notifications.NotificationStore | undefined;
      return { ...setup, notify };
    } catch (error) {
      act(() => setup.renderer.destroy());
      await setup.renderer.closed;
      throw error;
    }
  } finally {
    factory.mockRestore();
  }
}

async function press(setup: Awaited<ReturnType<typeof renderDemo>>, label: string) {
  const button = getFocusableRenderables(setup.renderer.root).find((node) =>
    node
      .getChildren()
      .some((child) => child instanceof TextRenderable && child.plainText === label),
  );
  expect(button).toBeDefined();
  act(() => {
    button!.focus();
    setup.mockInput.pressEnter();
  });
  await act(async () => setup.flush());
  await act(async () => setup.flush());
  return button!;
}

async function click(setup: Awaited<ReturnType<typeof renderDemo>>, x: number, y: number) {
  await act(async () => {
    await setup.mockMouse.pressDown(x, y);
    await setup.mockMouse.release(x, y);
  });
}

test("persistent demo survives expiry and pointer action visibly increments Viewed without stealing focus", async () => {
  const setup = await renderDemo();
  try {
    await press(setup, "Persistent");
    const root = setup.renderer.root;
    const persistent = setup.notify!.getSnapshot()[0]!;
    act(() => clock.advance(5_100));
    await act(async () => setup.flush());
    expect(persistent.description).toBe("Close with the mouse.");
    expect(setup.notify!.getSnapshot()[0]!.dismissedAt).toBeNull();
    const close = root.findDescendantById(`toast-${persistent.id}-close`)!;
    await click(setup, close.screenX, close.screenY);
    await act(async () => setup.flush());
    expect(root.findDescendantById(`toast-${persistent.id}`)).toBeUndefined();
    expect(findText(root, "History: 1 · Viewed: 0")).toBeDefined();
    const button = await press(setup, "With action");
    const record = setup.notify!.getSnapshot()[0]!;
    const action = root.findDescendantById(`toast-${record.id}-action`)!;
    expect(action.focusable).toBe(false);
    await click(setup, action.screenX, action.screenY);
    await act(async () => setup.flush());
    expect(findText(root, "History: 2 · Viewed: 1")).toBeDefined();
    expect(root.findDescendantById(`toast-${record.id}`)).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
  } finally {
    act(() => setup.renderer.destroy());
    await setup.renderer.closed;
  }
}, 10_000);

test("native and delayed auto demo route using terminal focus at delivery time", async () => {
  const setup = await renderDemo();
  const native = spyOn(setup.renderer, "triggerNotification").mockReturnValue(true);
  try {
    setRendererCapabilities(setup.renderer, { notifications: true });
    setup.renderer.emit(CliRenderEvents.FOCUS);
    await press(setup, "Native");
    expect(native).toHaveBeenCalledWith("Native notification", "Native notification");
    expect(setup.notify!.getSnapshot()[0]!.channel).toBe("native");
    await press(setup, "Auto in 3 seconds");
    expect(setup.notify!.getSnapshot()).toHaveLength(1);
    act(() => clock.advance(2_999));
    expect(setup.notify!.getSnapshot()).toHaveLength(1);
    setup.renderer.emit(CliRenderEvents.BLUR);
    act(() => clock.advance(1));
    await act(async () => setup.flush());
    expect(native).toHaveBeenCalledWith("No errors", "Build finished");
    expect(setup.notify!.getSnapshot()[0]).toMatchObject({
      title: "Build finished",
      delivery: "auto",
      channel: "native",
      variant: "success",
    });
    await press(setup, "Auto in 3 seconds");
    act(() => clock.advance(2_999));
    expect(setup.notify!.getSnapshot()).toHaveLength(2);
    setup.renderer.emit(CliRenderEvents.FOCUS);
    act(() => clock.advance(1));
    await act(async () => setup.flush());
    const record = setup.notify!.getSnapshot()[0]!;
    expect(record.channel).toBe("toast");
    expect(native).toHaveBeenCalledTimes(2);
    expect(setup.renderer.root.findDescendantById(`toast-${record.id}`)).toBeDefined();
    expect(findText(setup.renderer.root, "History: 3 · Viewed: 0")).toBeDefined();
  } finally {
    native.mockRestore();
    act(() => setup.renderer.destroy());
    await setup.renderer.closed;
  }
}, 10_000);

test("unmount clears demo history and cancels every delayed creation; a new lifetime starts empty", async () => {
  const defaultHistory = notifications.notify.getSnapshot();
  const setup = await renderDemo();
  try {
    await press(setup, "With action");
    await press(setup, "Auto in 3 seconds");
    await press(setup, "Auto in 3 seconds");
    expect(setup.notify!.getSnapshot()).toHaveLength(1);
  } finally {
    act(() => setup.renderer.destroy());
    await setup.renderer.closed;
  }
  expect(setup.notify!.getSnapshot()).toEqual([]);
  act(() => clock.advance(3_100));
  expect(setup.notify!.getSnapshot()).toEqual([]);
  const remounted = await renderDemo();
  try {
    expect(remounted.notify).not.toBe(setup.notify);
    expect(findText(remounted.renderer.root, "History: 0 · Viewed: 0")).toBeDefined();
    expect(notifications.notify.getSnapshot()).toBe(defaultHistory);
  } finally {
    act(() => remounted.renderer.destroy());
    await remounted.renderer.closed;
  }
}, 10_000);

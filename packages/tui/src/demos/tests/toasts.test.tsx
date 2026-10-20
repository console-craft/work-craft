import { expect, spyOn, test } from "bun:test";

import {
  CliRenderEvents,
  type Renderable,
  RGBA,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { setRendererCapabilities } from "@opentui/core/testing";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/interaction/focus-utils";
import * as notifications from "@/ui/notifications";
import { defaultTheme } from "@/ui/theming/themes/default";

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
    const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
    try {
      await act(async () => setup.flush());
      // Table columns resolve from native layout; capture bounds after their reflow.
      await act(async () => setup.flush());
      const notify = factory.mock.results[0]?.value as notifications.NotificationStore | undefined;
      return { ...setup, notify };
    } catch (error) {
      act(() => setup.renderer.destroy());
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

test("demo variants use isolated history and burst overflow leaves scrolling layout intact", async () => {
  const defaultHistory = notifications.notify.getSnapshot();
  const setup = await renderDemo();
  try {
    const root = setup.renderer.root;
    expect(findText(root, "History: 0 · Viewed: 0")).toBeDefined();
    const area = root.getChildren()[0] as ScrollBoxRenderable;
    const page = root.findDescendantById("components-demo")!;
    const bounds = {
      x: page.screenX,
      width: page.width,
      height: page.height,
      scrollHeight: area.scrollHeight,
    };
    for (const [variant, color] of [
      ["default", "foreground"],
      ["success", "success"],
      ["warning", "warning"],
      ["error", "error"],
      ["info", "info"],
    ] as const) {
      await press(setup, variant);
      const record = setup.notify!.getSnapshot()[0]!;
      expect(record.variant).toBe(variant);
      expect(record.delivery).toBe("toast");
      expect(record.channel).toBe("toast");
      const title = root.findDescendantById(`toast-${record.id}-title`) as TextRenderable;
      expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors[color]))).toBe(true);
    }
    await press(setup, "Clear history");
    expect(setup.notify!.getSnapshot()).toEqual([]);
    await press(setup, "Burst of five");
    const records = setup.notify!.getSnapshot();
    expect(records.map((record) => record.title)).toEqual([
      "Burst 5",
      "Burst 4",
      "Burst 3",
      "Burst 2",
      "Burst 1",
    ]);
    expect(
      records.filter((record) => record.dismissedAt === null).map((record) => record.title),
    ).toEqual(["Burst 5", "Burst 4", "Burst 3"]);
    expect(findText(root, "History: 5 · Viewed: 0")).toBeDefined();
    const newest = root.findDescendantById(`toast-${records[0]!.id}`)!;
    expect(newest.parent!.parent).toBe(root);
    expect(root.getChildren()).toHaveLength(4);
    expect(newest.screenX + newest.width).toBe(99);
    expect(newest.screenY + newest.height).toBe(23);
    expect({
      x: page.screenX,
      width: page.width,
      height: page.height,
      scrollHeight: area.scrollHeight,
    }).toEqual(bounds);
    const position = area.scrollTop;
    await act(async () => setup.mockMouse.scroll(newest.screenX, newest.screenY, "down"));
    expect(area.scrollTop).toBe(position);
    await press(setup, "Clear history");
    expect(findText(root, "History: 0 · Viewed: 0")).toBeDefined();
    expect(root.getChildren()).toHaveLength(1);
    expect(notifications.notify.getSnapshot()).toBe(defaultHistory);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("persistent demo survives expiry and pointer action visibly increments Viewed without stealing focus", async () => {
  const setup = await renderDemo();
  try {
    await press(setup, "Persistent");
    const root = setup.renderer.root;
    const persistent = setup.notify!.getSnapshot()[0]!;
    await act(async () => Bun.sleep(5_100));
    await act(async () => setup.flush());
    expect(persistent.description).toBe("Close with the mouse.");
    expect(setup.notify!.getSnapshot()[0]!.dismissedAt).toBeNull();
    const close = root.findDescendantById(`toast-${persistent.id}-close`)!;
    await act(async () => setup.mockMouse.click(close.screenX, close.screenY));
    await act(async () => setup.flush());
    expect(root.findDescendantById(`toast-${persistent.id}`)).toBeUndefined();
    expect(findText(root, "History: 1 · Viewed: 0")).toBeDefined();
    const button = await press(setup, "With action");
    const record = setup.notify!.getSnapshot()[0]!;
    const action = root.findDescendantById(`toast-${record.id}-action`)!;
    expect(action.focusable).toBe(false);
    await act(async () => setup.mockMouse.click(action.screenX, action.screenY));
    await act(async () => setup.flush());
    expect(findText(root, "History: 2 · Viewed: 1")).toBeDefined();
    expect(root.findDescendantById(`toast-${record.id}`)).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
  } finally {
    act(() => setup.renderer.destroy());
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
    setup.renderer.emit(CliRenderEvents.BLUR);
    await act(async () => Bun.sleep(3_100));
    await act(async () => setup.flush());
    expect(native).toHaveBeenCalledWith("No errors", "Build finished");
    expect(setup.notify!.getSnapshot()[0]).toMatchObject({
      title: "Build finished",
      delivery: "auto",
      channel: "native",
      variant: "success",
    });
    await press(setup, "Auto in 3 seconds");
    setup.renderer.emit(CliRenderEvents.FOCUS);
    await act(async () => Bun.sleep(3_100));
    await act(async () => setup.flush());
    const record = setup.notify!.getSnapshot()[0]!;
    expect(record.channel).toBe("toast");
    expect(native).toHaveBeenCalledTimes(2);
    expect(setup.renderer.root.findDescendantById(`toast-${record.id}`)).toBeDefined();
    expect(findText(setup.renderer.root, "History: 3 · Viewed: 0")).toBeDefined();
  } finally {
    native.mockRestore();
    act(() => setup.renderer.destroy());
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
  }
  expect(setup.notify!.getSnapshot()).toEqual([]);
  await act(async () => Bun.sleep(3_100));
  expect(setup.notify!.getSnapshot()).toEqual([]);
  const remounted = await renderDemo();
  try {
    expect(remounted.notify).not.toBe(setup.notify);
    expect(findText(remounted.renderer.root, "History: 0 · Viewed: 0")).toBeDefined();
    expect(notifications.notify.getSnapshot()).toBe(defaultHistory);
  } finally {
    act(() => remounted.renderer.destroy());
  }
}, 10_000);

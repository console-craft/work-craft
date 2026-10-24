import { expect, spyOn, test } from "bun:test";

import { type BoxRenderable, CliRenderEvents, RGBA, type TextRenderable } from "@opentui/core";
import { setRendererCapabilities } from "@opentui/core/testing";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Toaster, type ToasterPosition, type ToasterProps } from "@/ui/components/toast";
import { Button } from "@/ui/controls/button";
import { FocusManager } from "@/ui/interaction/focus-manager";
import {
  createNotificationStore,
  getNotificationStoreController,
  type NotificationStore,
  notify,
} from "@/ui/notifications";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

async function renderToaster(notify: NotificationStore, position?: ToasterPosition) {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page" width="100%" height="100%">
        <Button id="first">First</Button>
        <Button id="second">Second</Button>
      </Box>
      <Toaster store={notify} position={position} />
    </ThemeProvider>,
    { width: 80, height: 24 },
  );
  try {
    await act(async () => setup.flush());
    return setup;
  } catch (error) {
    act(() => setup.renderer.destroy());
    throw error;
  }
}

test("toast actions preserve focus and stay outside Tab traversal", async () => {
  const notify = createNotificationStore();
  const setup = await renderToaster(notify);
  let actions = 0;
  let rootPresses = 0;
  setup.renderer.root.focusable = true;
  setup.renderer.root.onMouseDown = () => rootPresses++;
  setup.renderer.root.onMouseUp = () => rootPresses++;
  try {
    act(() => setup.renderer.root.findDescendantById("first")!.focus());
    let id = "";
    act(() => {
      id = notify("Saved", {
        delivery: "toast",
        duration: 0,
        action: { label: "View", onPress: () => actions++ },
      });
    });
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("second");
    const toast = setup.renderer.root.findDescendantById(`toast-${id}`)!;
    const action = setup.renderer.root.findDescendantById(`toast-${id}-action`)!;
    expect(toast.focusable).toBe(false);
    expect(action.focusable).toBe(false);
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    act(() => setup.mockInput.pressEnter());
    expect(actions).toBe(0);
    await act(async () => setup.mockMouse.moveTo(action.screenX, action.screenY));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    await act(async () => setup.mockMouse.click(action.screenX, action.screenY));
    await act(async () => setup.flush());
    expect(actions).toBe(1);
    expect(rootPresses).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    expect(setup.renderer.root.findDescendantById(`toast-${id}`)).toBeUndefined();
    expect(notify.getSnapshot()).toHaveLength(1);
    expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
  test(`${position} anchors newest nearest the corner and clamps a wrapping stack`, async () => {
    const notify = createNotificationStore();
    const older = notify("Older", { delivery: "toast", duration: 0 });
    const newer = notify("A long title that wraps on narrow terminals", {
      delivery: "toast",
      duration: 0,
      description: "A long description that also needs to wrap without horizontal overflow.",
      action: { label: "An action label that also wraps", onPress() {} },
    });
    const setup = await renderToaster(notify, position);
    try {
      const newest = setup.renderer.root.findDescendantById(`toast-${newer}`)!;
      const oldest = setup.renderer.root.findDescendantById(`toast-${older}`)!;
      expect(newest.width).toBe(48);
      if (position.endsWith("left")) {
        expect(newest.screenX).toBe(1);
      } else {
        expect(newest.screenX + newest.width).toBe(79);
      }
      if (position.startsWith("top")) {
        expect(newest.screenY).toBe(1);
        expect(oldest.screenY).toBe(newest.screenY + newest.height);
      } else {
        expect(newest.screenY + newest.height).toBe(23);
        expect(newest.screenY).toBe(oldest.screenY + oldest.height);
      }
      act(() => setup.resize(20, 12));
      await act(async () => setup.flush());
      expect(newest.width).toBe(18);
      expect(newest.screenX).toBe(1);
      const title = setup.renderer.root.findDescendantById(`toast-${newer}-title`)!;
      const description = setup.renderer.root.findDescendantById(`toast-${newer}-description`)!;
      expect(title.height).toBeGreaterThan(1);
      expect(description.height).toBeGreaterThan(1);
      if (position.startsWith("top")) {
        expect(newest.screenY).toBe(1);
      } else {
        expect(newest.screenY + newest.height).toBe(11);
      }
      const action = setup.renderer.root.findDescendantById(`toast-${newer}-action`)!;
      expect(action.screenX + action.width).toBeLessThanOrEqual(19);
      for (const node of [title, description, newest, oldest]) {
        expect(node.screenX).toBeGreaterThanOrEqual(0);
        expect(node.screenX + node.width).toBeLessThanOrEqual(20);
      }
      const clip = newest.parent!;
      expect(clip.parent).toBe(setup.renderer.root);
      expect(clip.screenY).toBeGreaterThanOrEqual(0);
      expect(clip.screenY + clip.height).toBeLessThanOrEqual(12);
      expect(clip.overflow).toBe("hidden");
      for (const size of [2, 1]) {
        act(() => setup.resize(size, size));
        await act(async () => setup.flush());
        expect(clip.screenX).toBe(0);
        expect(clip.width).toBe(size);
        expect(clip.screenY).toBe(0);
        expect(clip.height).toBeLessThanOrEqual(size);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const [variant, symbol, color, border] of [
  ["default", "•", "foreground", "foreground"],
  ["success", "✓", "success", "success"],
  ["warning", "⚠", "warning", "warning"],
  ["error", "❌", "error", "error"],
  ["info", "i", "info", "info"],
] as const) {
  test(`${variant} renders semantic colors, icon and non-selectable optional content`, async () => {
    const notify = createNotificationStore();
    const plain = notify("Plain", { variant, delivery: "toast", duration: 0 });
    const detailed = notify("Detailed", {
      variant,
      description: "Body",
      delivery: "toast",
      duration: 0,
      action: { label: "View", onPress() {} },
    });
    const setup = await renderToaster(notify);
    try {
      const root = setup.renderer.root;
      const toast = root.findDescendantById(`toast-${detailed}`) as BoxRenderable;
      const title = root.findDescendantById(`toast-${detailed}-title`) as TextRenderable;
      const icon = root.findDescendantById(`toast-${detailed}-icon`) as TextRenderable;
      const description = root.findDescendantById(
        `toast-${detailed}-description`,
      ) as TextRenderable;
      expect(icon.plainText).toBe(symbol);
      expect(title.plainText).toBe("Detailed");
      expect(description.plainText).toBe("Body");
      expect(icon.fg.equals(RGBA.fromHex(defaultTheme.colors[color]))).toBe(true);
      expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors[color]))).toBe(true);
      expect(toast.borderColor.equals(RGBA.fromHex(defaultTheme.colors[border]))).toBe(true);
      expect(toast.backgroundColor.equals(RGBA.fromHex(defaultTheme.colors.background))).toBe(true);
      for (const text of [title, icon, description]) {
        expect(text.selectable).toBe(false);
      }
      expect(root.findDescendantById(`toast-${plain}-description`)).toBeUndefined();
      expect(root.findDescendantById(`toast-${plain}-action`)).toBeUndefined();
      expect(root.findDescendantById(`toast-${plain}-close`)!.focusable).toBe(false);
      await act(async () => setup.mockMouse.pressDown(title.screenX, title.screenY));
      expect(setup.renderer.getSelection()).toBeNull();
      await act(async () => setup.mockMouse.release(title.screenX, title.screenY));
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const [kind, childFirst] of [
  ["action", false],
  ["action", true],
  ["close", false],
  ["close", true],
] as const) {
  test(`${kind} accepts ${childFirst ? "text-to-padding" : "padding-to-text"} crossings but cancels outside and right-button releases`, async () => {
    const notify = createNotificationStore();
    let actions = 0;
    const id = notify("Persistent", {
      delivery: "toast",
      duration: 0,
      action: { label: "View", onPress: () => actions++ },
    });
    const setup = await renderToaster(notify);
    try {
      const control = setup.renderer.root.findDescendantById(`toast-${id}-${kind}`)!;
      const label = control.getChildren()[0]!;
      const x = control.screenX;
      const y = control.screenY;
      expect(setup.renderer.hitTest(x, y)).toBe(control.num);
      expect(setup.renderer.hitTest(label.screenX, y)).toBe(label.num);
      await act(async () => setup.mockMouse.click(label.screenX, y, 2));
      await act(async () => setup.mockMouse.release(label.screenX, y));
      expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
      await act(async () => setup.mockMouse.pressDown(label.screenX, y));
      await act(async () => setup.mockMouse.moveTo(0, 0));
      await act(async () => setup.mockMouse.release(0, 0));
      expect(actions).toBe(0);
      expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
      await act(async () => setup.mockMouse.moveTo(x, y));
      await act(async () => setup.mockMouse.pressDown(x, y));
      await act(async () => setup.mockMouse.moveTo(label.screenX, y));
      await act(async () => setup.mockMouse.moveTo(0, 0));
      await act(async () => setup.mockMouse.moveTo(label.screenX, y));
      await act(async () => setup.mockMouse.release(label.screenX, y));
      expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
      const startX = childFirst ? label.screenX : x;
      const endX = childFirst ? x : label.screenX;
      await act(async () => setup.mockMouse.moveTo(startX, y));
      await act(async () => setup.mockMouse.pressDown(startX, y));
      await act(async () => setup.mockMouse.moveTo(endX, y));
      await act(async () => setup.mockMouse.release(endX, y));
      await act(async () => setup.flush());
      expect(actions).toBe(kind === "action" ? 1 : 0);
      expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
      expect(setup.renderer.root.findDescendantById(`toast-${id}`)).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("throwing actions report the original handler error and retain the active toast", async () => {
  const notify = createNotificationStore();
  const error = new Error("Application action failed");
  const id = notify("Retry", {
    delivery: "toast",
    duration: 0,
    action: {
      label: "Retry",
      onPress: () => {
        throw error;
      },
    },
  });
  const setup = await renderToaster(notify);
  const errors: unknown[] = [];
  setup.renderer.on(CliRenderEvents.HANDLER_ERROR, (payload) => errors.push(payload.error));
  try {
    const action = setup.renderer.root.findDescendantById(`toast-${id}-action`)!;
    await act(async () => setup.mockMouse.click(action.screenX, action.screenY));
    await act(async () => setup.flush());
    expect(errors).toEqual([error]);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    expect(setup.renderer.root.findDescendantById(`toast-${id}`)).toBeDefined();
    await act(async () => setup.mockMouse.release(action.screenX, action.screenY));
    expect(errors).toHaveLength(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("prop updates keep one connection; store swaps and remount restore listeners without native resend", async () => {
  const firstNotify = createNotificationStore();
  const secondNotify = createNotificationStore();
  let update!: Dispatch<SetStateAction<ToasterProps | null>>;
  function Fixture() {
    const [props, setProps] = useState<ToasterProps | null>(null);
    update = setProps;
    return <ThemeProvider theme={defaultTheme}>{props && <Toaster {...props} />}</ThemeProvider>;
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 24 });
  await act(async () => setup.flush());
  const focusCount = setup.renderer.listenerCount(CliRenderEvents.FOCUS);
  const blurCount = setup.renderer.listenerCount(CliRenderEvents.BLUR);
  const native = spyOn(setup.renderer, "triggerNotification").mockReturnValue(true);
  const connect = spyOn(getNotificationStoreController(firstNotify), "connect");
  try {
    // Only the external terminal send is replaced; delivery and subscriptions stay real.
    setRendererCapabilities(setup.renderer, { notifications: true });
    const nativeId = firstNotify("Native", { delivery: "native" });
    const older = firstNotify("Older", { delivery: "toast", duration: 0 });
    const newer = firstNotify("Newer", { delivery: "toast", duration: 0 });
    act(() => update({ store: firstNotify, maxVisible: 2 }));
    await act(async () => setup.flush());
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith("Native", "Native");
    expect(firstNotify.getSnapshot().find((record) => record.id === nativeId)!.channel).toBe(
      "native",
    );
    expect(setup.renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusCount + 1);
    expect(setup.renderer.listenerCount(CliRenderEvents.BLUR)).toBe(blurCount + 1);
    act(() => update({ store: firstNotify, maxVisible: 1, position: "top-left" }));
    await act(async () => setup.flush());
    expect(connect).toHaveBeenCalledTimes(1);
    expect(setup.renderer.root.findDescendantById(`toast-${older}`)).toBeUndefined();
    expect(
      firstNotify.getSnapshot().find((record) => record.id === older)!.dismissedAt,
    ).not.toBeNull();
    expect(setup.renderer.root.findDescendantById(`toast-${newer}`)!.screenY).toBe(1);
    act(() => update(null));
    await act(async () => setup.flush());
    expect(setup.renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusCount);
    expect(setup.renderer.listenerCount(CliRenderEvents.BLUR)).toBe(blurCount);
    const pending = firstNotify("Pending", { delivery: "toast", duration: 0 });
    expect(firstNotify.getSnapshot()[0]!.channel).toBeNull();
    act(() => update({ store: firstNotify }));
    await act(async () => setup.flush());
    expect(native).toHaveBeenCalledTimes(1);
    expect(setup.renderer.root.findDescendantById(`toast-${pending}`)).toBeDefined();
    expect(setup.renderer.root.findDescendantById(`toast-${newer}`)).toBeDefined();
    act(() => {
      firstNotify("Third", { delivery: "toast", duration: 0 });
      firstNotify("Fourth", { delivery: "toast", duration: 0 });
    });
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById(`toast-${newer}`)).toBeUndefined();
    expect(
      firstNotify
        .getSnapshot()
        .filter((record) => record.channel === "toast" && record.dismissedAt === null),
    ).toHaveLength(3);
    act(() => firstNotify.dismiss(pending));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById(`toast-${newer}`)).toBeUndefined();
    const swapped = secondNotify("Swapped", { delivery: "toast", duration: 0 });
    act(() => update({ store: secondNotify }));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById(`toast-${pending}`)).toBeUndefined();
    expect(setup.renderer.root.findDescendantById(`toast-${swapped}`)).toBeDefined();
    expect(setup.renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusCount + 1);
    act(() => update(null));
    await act(async () => setup.flush());
    expect(setup.renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusCount);
    expect(setup.renderer.listenerCount(CliRenderEvents.BLUR)).toBe(blurCount);
  } finally {
    native.mockRestore();
    connect.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("omitting store uses notify and removing the last toast leaves no overlay", async () => {
  notify.clearAll();
  const id = notify("Default store", { delivery: "toast", duration: 0 });
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Toaster />
    </ThemeProvider>,
    { width: 80, height: 24 },
  );
  try {
    await act(async () => setup.flush());
    const toast = setup.renderer.root.findDescendantById(`toast-${id}`)!;
    expect(toast.screenX + toast.width).toBe(79);
    expect(toast.screenY + toast.height).toBe(23);
    act(() => notify.dismiss(id));
    await act(async () => setup.flush());
    expect(setup.renderer.root.getChildren()).toHaveLength(0);
    expect(setup.renderer.hitTest(78, 22)).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
    notify.clearAll();
  }
});

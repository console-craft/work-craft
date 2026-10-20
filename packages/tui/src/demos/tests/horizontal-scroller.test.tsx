import { expect, test } from "bun:test";

import { parseColor, type ScrollBoxRenderable, type TextRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { catppuccinTheme } from "@/ui/themes/catppuccin";

async function renderDemo() {
  const setup = await testRender(<ComponentsDemo />, {
    width: 100,
    height: 24,
    kittyKeyboard: true,
  });
  const pageArea = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  await settle();
  act(() => {
    pageArea.scrollChildIntoView("horizontal-scroller-demo");
    setup.renderer.root.findDescendantById("components-demo")!.focus();
  });
  await settle();
  return {
    ...setup,
    pageArea,
    settle,
    area: (id: string) =>
      setup.renderer.root.findDescendantById(`${id}:viewport`) as ScrollBoxRenderable,
  };
}

test("components demo shows fitting and manual horizontal scrollers without page leakage", async () => {
  const setup = await renderDemo();
  try {
    const section = setup.renderer.root.findDescendantById("horizontal-scroller-demo");
    expect(section).toBeDefined();
    const fitting = setup.area("horizontal-fit");
    expect(fitting.viewport.width).toBe(40);
    expect(fitting.scrollWidth).toBeLessThanOrEqual(fitting.viewport.width);
    expect(setup.renderer.root.findDescendantById("horizontal-fit:left")?.id).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("horizontal-fit:right")?.id).toBeUndefined();
    const manual = setup.area("horizontal-text");
    const label = setup.renderer.root.findDescendantById("horizontal-text-label") as TextRenderable;
    expect(label.plainText).toBe(
      "研究 workspace — complete labels remain readable with arrows and wheel input",
    );
    expect(manual.scrollWidth).toBeGreaterThan(manual.viewport.width);
    const pageOffset = setup.pageArea.scrollTop;
    await act(async () =>
      setup.mockMouse.scroll(manual.viewport.screenX + 1, manual.viewport.screenY, "down"),
    );
    await setup.settle();
    expect(manual.scrollLeft).toBeGreaterThan(0);
    const beforeClick = manual.scrollLeft;
    const right = setup.renderer.root.findDescendantById("horizontal-text:right")!;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await setup.settle();
    expect(manual.scrollLeft).toBeGreaterThan(beforeClick);
    expect(setup.pageArea.scrollTop).toBe(pageOffset);
    expect(setup.pageArea.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("components-demo");
    expect(manual.height).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("components demo browses and reveals toggles independently of selection", async () => {
  const setup = await renderDemo();
  try {
    const section = setup.renderer.root.findDescendantById("horizontal-scroller-demo");
    expect(section).toBeDefined();
    expect(getFocusableRenderables(section!).map(({ id }) => id)).toEqual([
      "horizontal-reveal-group",
    ]);
    const group = setup.renderer.root.findDescendantById("horizontal-reveal-group")!;
    act(() => group.focus());
    await setup.settle();
    const pageOffset = setup.pageArea.scrollTop;
    act(() => {
      for (let index = 0; index < 5; index++) {
        setup.mockInput.pressKey("l");
      }
    });
    await setup.settle();
    const area = setup.area("horizontal-reveal");
    const candidate = setup.renderer.root.findDescendantById("horizontal-demo-item:Operations")!;
    const selected = setup.renderer.root.findDescendantById(
      "horizontal-demo-selected",
    ) as TextRenderable;
    expect(selected.plainText).toBe("Selected: Inbox");
    expect(candidate.screenX).toBeGreaterThanOrEqual(area.viewport.screenX);
    expect(candidate.screenX + candidate.width).toBeLessThanOrEqual(
      area.viewport.screenX + area.viewport.width,
    );
    expect(area.scrollLeft).toBeGreaterThan(0);
    expect(setup.pageArea.scrollTop).toBe(pageOffset);
    act(() => setup.mockInput.pressEnter());
    await setup.settle();
    expect(selected.plainText).toBe("Selected: Operations");
    act(() => setup.mockInput.pressKey("l"));
    await setup.settle();
    const oversized = setup.renderer.root.findDescendantById(
      "horizontal-demo-item:研究 workspace with a label longer than this viewport",
    )!;
    const longLabel = oversized.getChildren()[0] as TextRenderable;
    expect(longLabel.plainText).toBe("研究 workspace with a label longer than this viewport");
    expect(oversized.width).toBeGreaterThan(area.viewport.width);
    expect(oversized.screenX).toBe(area.viewport.screenX);
    act(() => setup.mockInput.pressKey("t", { ctrl: true }));
    await setup.settle();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("horizontal-reveal-group");
    expect(setup.renderer.root.findDescendantById("horizontal-reveal-group") === group).toBe(true);
    expect(setup.area("horizontal-reveal") === area).toBe(true);
    expect(selected.plainText).toBe("Selected: Operations");
    expect(longLabel.fg.toInts()).toEqual(
      parseColor(catppuccinTheme.colors.focusForeground).toInts(),
    );
    act(() => setup.resize(30, 24));
    await setup.settle();
    for (const id of ["horizontal-fit", "horizontal-text", "horizontal-reveal"]) {
      const root = setup.renderer.root.findDescendantById(id)!;
      expect(root.height).toBe(1);
      expect(root.width).toBeLessThanOrEqual(section!.width);
      expect(root.width).toBeLessThan(40);
    }
    expect(longLabel.plainText).toBe("研究 workspace with a label longer than this viewport");
    act(() => setup.mockInput.pressKey("r", { ctrl: true }));
    await setup.settle();
    expect(setup.renderer.root.findDescendantById("components-demo")!.width).toBe(80);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("horizontal-reveal-group");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

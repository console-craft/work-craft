import { expect, test } from "bun:test";

import { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/test-render";

test("components demo overflows real two-row Tabs without page scroll leakage or abbreviated labels", async () => {
  const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
  async function settle() {
    for (let frame = 0; frame < 4; frame++) {
      await act(async () => setup.flush());
    }
  }
  try {
    await settle();
    const section = setup.renderer.root.findDescendantById("tabs-overflow-demo");
    expect(section).toBeDefined();
    const page = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
    act(() => {
      page.scrollChildIntoView("tabs-overflow-demo");
      setup.renderer.root.findDescendantById("components-demo")!.focus();
    });
    await settle();
    const list = setup.renderer.root.findDescendantById("tabs-overflow-list")!;
    const area = setup.renderer.root.findDescendantById(
      "tabs-overflow-list:scroller:viewport",
    ) as ScrollBoxRenderable;
    expect(list.width).toBe(40);
    expect(area.viewport.height).toBe(2);
    expect(area.scrollWidth).toBeGreaterThan(40);
    const pageOffset = page.scrollTop;
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    await settle();
    expect(area.scrollLeft).toBeGreaterThan(0);
    const right = setup.renderer.root.findDescendantById("tabs-overflow-list:scroller:right")!;
    const before = area.scrollLeft;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await settle();
    expect(area.scrollLeft).toBeGreaterThan(before);
    expect(page.scrollTop).toBe(pageOffset);
    expect(page.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("components-demo");
    act(() => list.focus());
    act(() => setup.mockInput.pressKey("END"));
    await settle();
    const trigger = setup.renderer.root.findDescendantById("tabs-overflow-long")!;
    const label = trigger.getChildren()[0]!.getChildren()[0]!.getChildren()[0] as TextRenderable;
    expect(label.plainText).toBe("研究 workspace with a label longer than this viewport");
    expect(trigger.width).toBeGreaterThan(area.viewport.width);
    expect(trigger.screenX).toBe(area.viewport.screenX);
    act(() => setup.resize(30, 24));
    await settle();
    act(() => page.scrollChildIntoView("tabs-overflow-demo"));
    await settle();
    expect(list.width).toBeLessThan(40);
    expect(label.plainText).toBe("研究 workspace with a label longer than this viewport");
    expect(trigger.screenX).toBe(area.viewport.screenX);
    act(() => area.scrollTo({ x: area.scrollWidth, y: 0 }));
    await settle();
    expect(setup.captureCharFrame()).toContain("viewport");
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import { InputRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { ControlsDemo } from "@/demos/controls";
import { testRender } from "@/test-render";
import { getFocusableRenderables } from "@/ui/focus-utils";

for (const [name, Demo] of [
  ["components", ComponentsDemo],
  ["controls", ControlsDemo],
] as const) {
  test(`${name} demo cycles container widths without resetting focus`, async () => {
    const setup = await testRender(<Demo />, { width: 240, height: 100, kittyKeyboard: true });
    try {
      await act(async () => setup.flush());
      const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
      const page = setup.renderer.root.findDescendantById(`${name}-demo`)!;
      const focused = setup.renderer.currentFocusedRenderable;
      expect(focused).not.toBeNull();
      expect(page.width).toBe(area.viewport.width);

      for (const [size, width] of [
        ["sm", 80],
        ["md", 120],
        ["lg", 160],
        ["full", area.viewport.width],
      ] as const) {
        act(() => setup.mockInput.pressKey("r", { ctrl: true }));
        await act(async () => setup.flush());
        expect(page.width).toBe(width);
        expect(setup.captureCharFrame()).toContain(`Width: ${size} · Ctrl+r to resize`);
        expect(setup.renderer.currentFocusedRenderable).toBe(focused);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("resize shortcut preserves input text and only handles Ctrl+r", async () => {
  const setup = await testRender(<ControlsDemo />, {
    width: 240,
    height: 100,
    kittyKeyboard: true,
  });
  try {
    await act(async () => setup.flush());
    const page = setup.renderer.root.findDescendantById("controls-demo")!;
    const input = getFocusableRenderables(page).find(
      (node): node is InputRenderable => node instanceof InputRenderable,
    )!;
    act(() => {
      input.focus();
      setup.mockInput.pressKey("r");
    });
    await act(async () => setup.flush());
    expect(input.value).toBe("r");
    const width = page.width;

    for (const modifiers of [
      { ctrl: true, shift: true },
      { ctrl: true, meta: true },
      { ctrl: true, super: true },
      { ctrl: true, hyper: true },
    ]) {
      act(() => setup.mockInput.pressKey("r", modifiers));
      await act(async () => setup.flush());
      expect(page.width).toBe(width);
    }

    const value = input.value;
    act(() => setup.mockInput.pressKey("r", { ctrl: true }));
    await act(async () => setup.flush());
    expect(page.width).toBe(80);
    expect(input.value).toBe(value);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

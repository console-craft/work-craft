import { expect, test } from "bun:test";

import { type BoxRenderable, InputRenderable, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { ControlsDemo } from "@/demos/controls";
import { getFocusableRenderables } from "@/ui/focus-utils";

for (const [name, Demo] of [
  ["components", ComponentsDemo],
  ["controls", ControlsDemo],
] as const) {
  test(`${name} demo cycles all themes without resetting focus`, async () => {
    const setup = await testRender(<Demo />, { width: 160, height: 100, kittyKeyboard: true });
    try {
      await act(async () => setup.flush());
      expect(setup.captureCharFrame()).toContain("Theme: default");
      expect(setup.captureCharFrame()).toContain("Ctrl+t to switch");
      const focused = setup.renderer.currentFocusedRenderable;
      expect(focused).not.toBeNull();
      const scope = setup.renderer.root.findDescendantById(`${name}-demo`) as BoxRenderable;
      expect(scope.backgroundColor.equals(RGBA.fromHex("#33302e"))).toBe(true);

      for (const [theme, background] of [
        ["catppuccin", "#1e1e2e"],
        ["dracula", "#282a36"],
        ["nord", "#2e3440"],
        ["tokyo-night", "#1a1b26"],
        ["default", "#33302e"],
      ] as const) {
        act(() => setup.mockInput.pressKey("t", { ctrl: true }));
        await act(async () => setup.flush());
        expect(setup.captureCharFrame()).toContain(`Theme: ${theme}`);
        expect(scope.backgroundColor.equals(RGBA.fromHex(background))).toBe(true);
        expect(setup.renderer.currentFocusedRenderable).toBe(focused);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("demo shortcut preserves input text and only handles Ctrl+t", async () => {
  const setup = await testRender(<ControlsDemo />, {
    width: 160,
    height: 100,
    kittyKeyboard: true,
  });
  try {
    await act(async () => setup.flush());
    const scope = setup.renderer.root.findDescendantById("controls-demo")!;
    const input = getFocusableRenderables(scope).find(
      (node): node is InputRenderable => node instanceof InputRenderable,
    )!;
    act(() => {
      input.focus();
      setup.mockInput.pressKey("t");
    });
    await act(async () => setup.flush());
    expect(input.value).toBe("t");

    for (const modifiers of [
      { ctrl: true, shift: true },
      { ctrl: true, meta: true },
      { ctrl: true, super: true },
      { ctrl: true, hyper: true },
    ]) {
      act(() => setup.mockInput.pressKey("t", modifiers));
      await act(async () => setup.flush());
      expect(setup.captureCharFrame()).toContain("Theme: default");
    }

    const value = input.value;
    act(() => setup.mockInput.pressKey("t", { ctrl: true }));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("Theme: catppuccin");
    expect(input.value).toBe(value);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

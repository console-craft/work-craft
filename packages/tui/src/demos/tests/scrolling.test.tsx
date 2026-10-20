import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { ControlsDemo } from "@/demos/controls";
import { DemoPage } from "@/demos/demo-page";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

for (const [name, Demo] of [
  ["components", ComponentsDemo],
  ["controls", ControlsDemo],
] as const) {
  test(`${name} demo uses one centered content column and keeps Tab targets visible`, async () => {
    const setup = await testRender(<Demo />, { width: 240, height: 24 });
    try {
      await act(async () => setup.flush());
      const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
      const scope = setup.renderer.root.findDescendantById(`${name}-demo`) as BoxRenderable;
      expect(area.height).toBe(24);
      expect(scope.width).toBe(area.viewport.width);
      expect(scope.height).toBeGreaterThan(area.viewport.height);
      expect(
        Math.abs(
          scope.screenX + scope.width / 2 - (area.viewport.screenX + area.viewport.width / 2),
        ),
      ).toBeLessThanOrEqual(1);
      const targets = getFocusableRenderables(scope);
      for (let index = 1; index < targets.length; index++) {
        act(() => setup.mockInput.pressTab());
        await act(async () => setup.flush());
        // Focus reveal runs after FRAME; render the translated descendants on the next frame.
        await act(async () => setup.flush());
        const target = targets[index]!;
        expect(setup.renderer.currentFocusedRenderable).toBe(target);
        expect(target.screenY).toBeGreaterThanOrEqual(area.viewport.screenY);
        expect(target.screenY + target.height).toBeLessThanOrEqual(
          area.viewport.screenY + area.viewport.height,
        );
      }
      expect(area.scrollTop).toBeGreaterThan(0);
      act(() => setup.mockInput.pressTab());
      await act(async () => setup.flush());
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable).toBe(targets[0]!);
      expect(targets[0]!.screenY).toBeGreaterThanOrEqual(area.viewport.screenY);
      expect(targets[0]!.screenY + targets[0]!.height).toBeLessThanOrEqual(
        area.viewport.screenY + area.viewport.height,
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  });

  test(`${name} demo scrolls from page background and from unhandled control keys`, async () => {
    const setup = await testRender(<Demo />, { width: 240, height: 24, kittyKeyboard: true });
    try {
      await act(async () => setup.flush());
      const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
      const page = setup.renderer.root.findDescendantById(`${name}-demo`)!;
      await act(async () => setup.mockMouse.click(area.viewport.screenX, area.viewport.screenY));
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(page.id);
      for (const key of ["ARROW_DOWN", "j"]) {
        const before = area.scrollTop;
        act(() => setup.mockInput.pressKey(key));
        await act(async () => setup.flush());
        expect(area.scrollTop).toBeGreaterThan(before);
      }
      act(() => setup.mockInput.pressKey("g"));
      await act(async () => setup.flush());
      expect(area.scrollTop).toBe(0);
      act(() => setup.mockInput.pressKey("d", { ctrl: true }));
      await act(async () => setup.flush());
      expect(area.scrollTop).toBeGreaterThan(0);
      act(() => setup.mockInput.pressKey("u", { ctrl: true }));
      await act(async () => setup.flush());
      expect(area.scrollTop).toBe(0);
      act(() => setup.mockInput.pressTab());
      await act(async () => setup.flush());
      const first = getFocusableRenderables(page)[0]!;
      expect(setup.renderer.currentFocusedRenderable).toBe(first);
      const before = area.scrollTop;
      act(() => setup.mockInput.pressKey("j"));
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable).toBe(first);
      expect(area.scrollTop).toBeGreaterThan(before);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });

  test(`${name} demo preserves the selected content width in a narrow viewport`, async () => {
    const setup = await testRender(<Demo />, { width: 60, height: 24, kittyKeyboard: true });
    try {
      await act(async () => setup.flush());
      const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
      const page = setup.renderer.root.findDescendantById(`${name}-demo`)!;
      act(() => setup.mockInput.pressKey("r", { ctrl: true }));
      await act(async () => setup.flush());
      expect(page.width).toBe(80);
      expect(area.horizontalScrollBar.visible).toBe(true);
      await act(async () => setup.mockMouse.click(area.viewport.screenX, area.viewport.screenY));
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressKey("l"));
      await act(async () => setup.flush());
      expect(area.scrollLeft).toBeGreaterThan(0);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("focused native controls consume their keys before page scroll fallback", async () => {
  const setup = await testRender(<ControlsDemo />, { width: 240, height: 24, kittyKeyboard: true });
  try {
    await act(async () => setup.flush());
    const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
    const page = setup.renderer.root.findDescendantById("controls-demo")!;
    const targets = getFocusableRenderables(page);
    const select = targets.find(
      (node): node is SelectRenderable => node instanceof SelectRenderable,
    )!;
    act(() => select.focus());
    await act(async () => setup.flush());
    const before = area.scrollTop;
    act(() => setup.mockInput.pressKey("j"));
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(2);
    expect(area.scrollTop).toBe(before);
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(2);
    expect(area.scrollTop).toBe(before);
    const input = targets.find((node): node is InputRenderable => node instanceof InputRenderable)!;
    act(() => input.focus());
    await act(async () => setup.flush());
    const inputPosition = area.scrollTop;
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey("k"));
    await act(async () => setup.flush());
    expect(input.value).toBe("jk");
    expect(area.scrollTop).toBe(inputPosition);
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(inputPosition);
    const textarea = targets.find(
      (node): node is TextareaRenderable =>
        node instanceof TextareaRenderable && !(node instanceof InputRenderable),
    )!;
    act(() => textarea.focus());
    await act(async () => setup.flush());
    const textareaPosition = area.scrollTop;
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey("k"));
    await act(async () => setup.flush());
    expect(textarea.plainText).toBe("jk");
    expect(area.scrollTop).toBe(textareaPosition);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("accordion navigation wins over the containing page's j/k shortcuts", async () => {
  const setup = await testRender(<ComponentsDemo />, { width: 240, height: 24 });
  try {
    await act(async () => setup.flush());
    const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
    const page = setup.renderer.root.findDescendantById("components-demo")!;
    const targets = getFocusableRenderables(page);
    const header = (label: string) =>
      targets.find((node) =>
        node
          .getChildren()
          .some((child) => child instanceof TextRenderable && child.plainText === label),
      )!;
    const general = header("General");
    const appearance = header("Appearance");
    act(() => general.focus());
    await act(async () => setup.flush());
    act(() => area.scrollTo(general.y - area.content.y));
    await act(async () => setup.flush());
    const before = area.scrollTop;
    act(() => setup.mockInput.pressKey("j"));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(appearance.id);
    expect(area.scrollTop).toBe(before);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("full-width demo page fills the viewport even with small content", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <DemoPage id="small-content">
        <Text>Small content</Text>
      </DemoPage>
    </ThemeProvider>,
    { width: 240, height: 24 },
  );
  try {
    await act(async () => setup.flush());
    const page = setup.renderer.root.findDescendantById("small-content")!;
    const area = setup.renderer.root.getChildren()[0] as ScrollBoxRenderable;
    expect(page.width).toBe(area.viewport.width);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("card tabs fill the width with equal triggers and keep logs inside the card", async () => {
  const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const card = setup.renderer.root.findDescendantById("card-tabs-demo")!;
    const list = getFocusableRenderables(card)[0]!;
    expect(list.width).toBe(card.width);
    expect(list.width).toBe(60);
    const scroller = list.getChildren()[0]!;
    const strip = setup.renderer.root.findDescendantById(
      `${scroller.id}:viewport`,
    ) as ScrollBoxRenderable;
    const triggers = strip.content.getChildren()[0]!.getChildren();
    expect(triggers.map((trigger) => trigger.width)).toEqual([20, 20, 20]);
    expect(triggers[0]!.screenX).toBe(card.screenX);
    expect(triggers[2]!.screenX + triggers[2]!.width).toBe(card.screenX + card.width);
    expect(strip.scrollLeft).toBe(0);
    expect(strip.viewport.width).toBe(60);
    act(() => list.focus());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    await act(async () => setup.flush());
    const logs = getFocusableRenderables(card).find(
      (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
    )!;
    expect(logs.height).toBe(18);
    expect(logs.screenY + logs.height).toBeLessThanOrEqual(card.screenY + card.height);
    expect(logs.scrollHeight).toBeGreaterThan(logs.height);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable).toBe(logs);
    act(() => setup.mockInput.pressKey("j"));
    await act(async () => setup.flush());
    expect(logs.scrollTop).toBeGreaterThan(0);
    act(() => logs.scrollTo(logs.scrollHeight));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("Log 29");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("table demos reflow naturally and put the height constraint on the scroll viewport", async () => {
  const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const table = setup.renderer.root.findDescendantById("table-wrap-demo")!;
    const initialHeight = table.height;
    act(() => setup.resize(50, 24));
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(table.height).toBeGreaterThan(initialHeight);
    expect(table.width).toBeLessThanOrEqual(50);
    const area = setup.renderer.root.findDescendantById("table-scroll-demo") as ScrollBoxRenderable;
    const content = setup.renderer.root.findDescendantById("table-scroll-content")!;
    expect(area.height).toBe(8);
    expect(content.height).toBeGreaterThan(area.height);
    expect(area.scrollHeight).toBeGreaterThan(area.height);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import { parseColor, type TextRenderable } from "@opentui/core";
import { act } from "react";

import { CategoryRail } from "@/navigation/category-rail";
import { snapshotFixture } from "@/test-fixtures";
import { testRender } from "@/test-render";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { icons } from "@/ui/icons/nerd";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

async function renderRail() {
  const activated: string[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Box>
        <CategoryRail
          categories={snapshotFixture().categories}
          active="inbox"
          focused
          onActivate={(kind) => activated.push(kind)}
        />
        <Box id="other" focusable height={1} />
      </Box>
    </ThemeProvider>,
    { width: 5, height: 20, kittyKeyboard: true },
  );
  await act(async () => setup.flush());
  return { ...setup, activated };
}

test("category toggles keep six padded icons and a single five-cell focus region", async () => {
  const setup = await renderRail();
  try {
    const rail = setup.renderer.root.findDescendantById("region:category")!;
    expect(rail.width).toBe(5);
    expect(getFocusableRenderables(setup.renderer.root).map(({ id }) => id)).toEqual([
      "region:category",
      "other",
    ]);
    const glyphs = [
      icons.inbox,
      icons.calendar,
      icons.lightbulb,
      icons.code,
      icons.discussion,
      icons.tools,
    ];
    const kinds = ["inbox", "today", "design", "implementation", "collaboration", "operations"];
    for (const [index, kind] of kinds.entries()) {
      const row = rail.findDescendantById(`category:${kind}`)!;
      expect(row.height).toBe(3);
      expect(row.focusable).toBe(false);
      const label = row.getChildren()[0] as TextRenderable;
      expect(label.plainText).toBe(glyphs[index]);
      expect(label.screenY).toBe(row.screenY + 1);
      expect(label.screenY + label.height).toBeLessThanOrEqual(20);
    }
    const selected = rail.findDescendantById("category:inbox")!;
    expect((selected.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category toggles browse without activation, wrap, and reset on refocus", async () => {
  const setup = await renderRail();
  try {
    act(() => setup.mockInput.pressKey("k"));
    await act(async () => setup.flush());
    expect(setup.activated).toEqual([]);
    act(() => setup.mockInput.pressEnter());
    expect(setup.activated).toEqual(["operations"]);
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey(" "));
    expect(setup.activated).toEqual(["operations", "inbox"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category buffered navigation and repeated activation use eligible kinds", async () => {
  const setup = await renderRail();
  try {
    act(() => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
    });
    expect(setup.activated).toEqual(["design"]);
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    expect(setup.activated).toEqual(["design", "inbox", "inbox"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category icons activate on primary release rather than press", async () => {
  const setup = await renderRail();
  try {
    const row = setup.renderer.root.findDescendantById("category:implementation")!;
    const icon = row.getChildren()[0] as TextRenderable;
    await act(async () => setup.mockMouse.pressDown(icon.screenX, icon.screenY));
    expect(setup.activated).toEqual([]);
    await act(async () => setup.mockMouse.release(icon.screenX, icon.screenY));
    expect(setup.activated).toEqual(["implementation"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import { type BoxRenderable, type InputRenderable, RGBA, TextRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/interaction/focus-utils";
import { getActiveModalFocusScope } from "@/ui/interaction/modal-focus";
import { defaultTheme } from "@/ui/theming/themes/default";

test("destructive demo initially focuses Cancel", async () => {
  const setup = await testRender(<ComponentsDemo />, {
    width: 100,
    height: 24,
    kittyKeyboard: true,
  });
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("destructive-dialog-trigger")!;
    expect(trigger).toBeDefined();
    act(() => {
      trigger.focus();
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("destructive-dialog-cancel");
    const title = setup.renderer.root.findDescendantById(
      "destructive-dialog-title",
    ) as TextRenderable;
    const next = setup.renderer.root.findDescendantById(
      "destructive-dialog-continue",
    ) as BoxRenderable;
    expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors.error))).toBe(true);
    expect(next.backgroundColor.equals(RGBA.fromHex(defaultTheme.colors.error))).toBe(true);
    expect((next.getChildren()[0] as TextRenderable).plainText).toBe("Delete");
    expect(setup.captureCharFrame()).toContain("Cancel");

    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("destructive-dialog-content")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const label of ["Open file", "Open file (up)"]) {
  test(`${label} demo keeps its CommandInput within the dialog content bounds`, async () => {
    const setup = await testRender(<ComponentsDemo />, {
      width: 100,
      height: 32,
      kittyKeyboard: true,
    });
    try {
      await act(async () => setup.flush());
      const trigger = getFocusableRenderables(setup.renderer.root).find((node) =>
        node
          .getChildren()
          .some((child) => child instanceof TextRenderable && child.plainText === label),
      );
      expect(trigger).toBeDefined();
      act(() => {
        trigger!.focus();
        setup.mockInput.pressEnter();
      });
      await act(async () => setup.flush());
      const dialog = getActiveModalFocusScope()!.root;
      const input = setup.renderer.root.findDescendantById("open-file") as InputRenderable;
      const command = input.parent!;
      const bounds = {
        dialog: { x: dialog.screenX, width: dialog.width },
        command: { x: command.screenX, width: command.width },
        input: { x: input.screenX, width: input.width },
      };
      expect(bounds).toEqual({
        dialog: bounds.dialog,
        command: { x: dialog.screenX + 2, width: dialog.width - 4 },
        input: { x: dialog.screenX + 2, width: dialog.width - 4 },
      });
      await act(async () => setup.mockInput.typeText("x".repeat(100)));
      await act(async () => setup.flush());
      expect(input.screenX + input.width).toBeLessThanOrEqual(dialog.screenX + dialog.width - 2);
      for (const width of [83, 180]) {
        await act(async () => setup.resize(width, 32));
        await act(async () => setup.flush());
        expect(input.width).toBe(command.width);
        expect(input.screenX + input.width).toBe(dialog.screenX + dialog.width - 2);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

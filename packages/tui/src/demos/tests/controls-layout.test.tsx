import { expect, test } from "bun:test";

import { TextareaRenderable } from "@opentui/core";
import { act } from "react";

import { ControlsDemo } from "@/demos/controls";
import { testRender } from "@/tests/support/render";
import { getFocusableRenderables } from "@/ui/interaction/focus-utils";

for (const [name, index, text] of [
  ["input", 0, "a"],
  ["number input", 1, "1"],
  ["textarea", 2, "a"],
] as const) {
  test(`controls demo keeps ${name} and sibling widths stable while editing`, async () => {
    const setup = await testRender(<ControlsDemo />, { width: 120, height: 100 });
    try {
      await act(async () => setup.flush());
      const page = setup.renderer.root.findDescendantById("controls-demo")!;
      const editors = getFocusableRenderables(page).filter(
        (node): node is TextareaRenderable => node instanceof TextareaRenderable,
      );
      const editor = editors[index]!;
      const siblings = editor.parent!.getChildren();
      const layout = () => siblings.map((node) => ({ x: node.screenX, width: node.width }));
      act(() => editor.focus());
      await act(async () => setup.flush());
      const before = layout();

      for (const value of [text, text.repeat(150)]) {
        await act(async () => setup.mockInput.typeText(value));
        await act(async () => setup.flush());
        expect(editor.plainText).toContain(value);
        expect(layout()).toEqual(before);
      }

      act(() => setup.mockInput.pressKey("w", { ctrl: true }));
      await act(async () => setup.flush());
      expect(editor.plainText).toBe("");
      expect(layout()).toEqual(before);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

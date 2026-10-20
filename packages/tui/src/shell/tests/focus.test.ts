import { expect, test } from "bun:test";

import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { focusShellTarget, focusTargetFor, nativeFocusId } from "@/shell/focus.ts";

test("shell ID bridge focuses eligible native endpoints and recognizes their descendants", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const category = new BoxRenderable(renderer, { id: "region:category", focusable: true });
  const child = new BoxRenderable(renderer, { id: "category:inbox" });
  const terminal = new BoxRenderable(renderer, { id: "terminal:pane-2", focusable: true });
  const action = new BoxRenderable(renderer, { id: "reactivate:pane-2", focusable: true });
  const dialog = new BoxRenderable(renderer, { id: "dialog-overlay", focusable: true });
  renderer.root.add(category);
  category.add(child);
  renderer.root.add(terminal);
  renderer.root.add(action);
  renderer.root.add(dialog);
  try {
    expect(nativeFocusId({ region: "category" })).toBe("region:category");
    expect(nativeFocusId({ region: "workbench", paneId: "pane-2" })).toBe("terminal:pane-2");
    expect(nativeFocusId({ region: "workbench", paneId: "pane-2", control: "reactivate" })).toBe(
      "reactivate:pane-2",
    );
    expect(
      focusShellTarget(renderer, { region: "workbench", paneId: "pane-2", control: "reactivate" }),
    ).toBe(true);
    expect(renderer.currentFocusedRenderable).toBe(action);
    expect(focusTargetFor(action)).toEqual({
      region: "workbench",
      paneId: "pane-2",
      control: "reactivate",
    });
    expect(focusShellTarget(renderer, { region: "category" })).toBe(true);
    expect(renderer.currentFocusedRenderable).toBe(category);
    expect(focusTargetFor(child)).toEqual({ region: "category" });
    expect(focusShellTarget(renderer, { region: "workbench", paneId: "pane-2" })).toBe(true);
    expect(focusTargetFor(renderer.currentFocusedRenderable)).toEqual({
      region: "workbench",
      paneId: "pane-2",
    });
    dialog.focus();
    expect(focusTargetFor(renderer.currentFocusedRenderable)).toBeNull();
    expect(focusTargetFor(null)).toBeNull();
    category.visible = false;
    expect(focusShellTarget(renderer, { region: "category" })).toBe(false);
    expect(focusShellTarget(renderer, { region: "navigator" })).toBe(false);
    terminal.focusable = false;
    expect(focusShellTarget(renderer, { region: "workbench", paneId: "pane-2" })).toBe(false);
    expect(renderer.currentFocusedRenderable).toBe(dialog);
  } finally {
    renderer.destroy();
  }
});

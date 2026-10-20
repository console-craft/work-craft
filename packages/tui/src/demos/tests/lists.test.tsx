import { expect, test } from "bun:test";

import type { TextRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";

test("List demo keeps selection while previewing and filtering, then commits on Enter", async () => {
  const setup = await testRender(<ComponentsDemo />, {
    width: 100,
    height: 35,
    kittyKeyboard: true,
  });
  try {
    await act(async () => setup.flush());
    const list = setup.renderer.root.findDescendantById("list-entities");
    expect(list).toBeDefined();
    const text = (id: string) =>
      (setup.renderer.root.findDescendantById(id) as TextRenderable).plainText;
    act(() => list!.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("j"));
    await act(async () => setup.flush());
    expect(text("list-selected")).toBe("Selected: Architecture");
    expect(text("list-preview")).toBe("Preview: Focus manager");
    act(() => setup.renderer.root.findDescendantById("list-filter")!.focus());
    await act(async () => setup.mockInput.typeText("Scrolling"));
    await act(async () => setup.flush());
    expect(text("list-selected")).toBe("Selected: Architecture");
    expect(text("list-preview")).toBe("Preview: Scrolling");
    act(() => {
      list!.focus();
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(text("list-selected")).toBe("Selected: Scrolling");
    expect(text("list-open-count")).toBe("Opened 1 time(s)");
    const toggle = setup.renderer.root.findDescendantById("list-toggle-disabled");
    expect(toggle).toBeDefined();
    act(() => {
      toggle!.focus();
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(list!.focusable).toBe(false);
    act(() => list!.focus());
    expect(setup.renderer.currentFocusedRenderable).not.toBe(list);
    expect(text("list-preview")).toBe("Preview: Scrolling");
    expect(text("list-selected")).toBe("Selected: Scrolling");
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(list!.focusable).toBe(true);
    expect(text("list-open-count")).toBe("Opened 1 time(s)");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

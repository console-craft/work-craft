import { expect, test } from "bun:test";

import { InputRenderable, type Renderable, TextRenderable } from "@opentui/core";
import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";

test("component demo keeps section order, target IDs and field drafts across theme actions", async () => {
  const setup = await testRender(<ComponentsDemo />, {
    width: 160,
    height: 100,
    kittyKeyboard: true,
  });
  try {
    await act(async () => setup.flush());
    const nodes: Renderable[] = [];
    function visit(node: Renderable): void {
      nodes.push(node);
      node.getChildren().forEach(visit);
    }
    visit(setup.renderer.root);
    const headings = [
      "CARDS",
      "BADGES",
      "ALERTS",
      "SPINNERS",
      "PROGRESS",
      "COLLAPSIBLE",
      "ACCORDIONS",
      "TABS",
      "FIELD",
      "EMPTY STATE",
      "DIALOGS",
      "MENUS",
      "COMMANDS",
      "TOASTS",
      "TABLES",
      "LISTS",
      "HORIZONTAL SCROLLER",
    ];
    expect(
      nodes
        .filter(
          (node): node is TextRenderable =>
            node instanceof TextRenderable && headings.includes(node.plainText),
        )
        .map((node) => node.plainText),
    ).toEqual(headings);
    for (const id of [
      "components-demo",
      "card-tabs-demo",
      "tabs-overflow-demo",
      "list-entities",
      "horizontal-scroller-demo",
      "table-wrap-demo",
    ]) {
      expect(nodes.filter((node) => node.id === id)).toHaveLength(1);
    }
    const email = nodes.find(
      (node): node is InputRenderable =>
        node instanceof InputRenderable && node.placeholder === "you@example.com",
    )!;
    act(() => {
      email.focus();
      setup.mockInput.typeText("draft@example.com");
    });
    act(() => setup.mockInput.pressKey("t", { ctrl: true }));
    await act(async () => setup.flush());
    expect(email.value).toBe("draft@example.com");
    expect(setup.renderer.currentFocusedRenderable).toBe(email);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

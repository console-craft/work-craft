import { expect, test } from "bun:test";
import type { LayoutNode } from "@work-craft/server";
import { projectLayout, tabSelectionCommand, terminalPaneKey } from "./surface-view.tsx";

function splitFixture(): LayoutNode {
  return {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: "a" },
    second: { type: "pane", paneId: "b" },
  };
}

test("projects a recursive split without changing pane identity", () => {
  const projected = projectLayout(splitFixture());
  expect(projected).toEqual({
    direction: "row",
    ratio: 0.5,
    children: [{ paneId: "a" }, { paneId: "b" }],
  });
});

test("terminal renderer identity includes the daemon epoch and replay cursor", () => {
  expect([
    terminalPaneKey("pane-1", { epoch: "epoch-a", historyCursor: 3 }),
    terminalPaneKey("pane-1", { epoch: "epoch-b", historyCursor: 3 }),
    terminalPaneKey("pane-1", { epoch: "epoch-b", historyCursor: 9 }),
  ]).toEqual(["pane-1:epoch-a:3", "pane-1:epoch-b:3", "pane-1:epoch-b:9"]);
});

test("bracket controls select the current tab when it is the only tab", () => {
  expect(tabSelectionCommand("[", "surface-1", [{ id: "tab-1" }], "tab-1")).toEqual({
    type: "surface.selectTab",
    surfaceId: "surface-1",
    tabId: "tab-1",
  });
  expect(tabSelectionCommand("]", "surface-1", [{ id: "tab-1" }], "tab-1")).toEqual({
    type: "surface.selectTab",
    surfaceId: "surface-1",
    tabId: "tab-1",
  });
});

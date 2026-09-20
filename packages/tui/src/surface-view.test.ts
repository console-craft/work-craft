import { expect, test } from "bun:test";
import type { LayoutNode } from "@work-craft/server/client";
import { adjacentTab, paneIds, projectLayout, terminalPaneKey } from "./surface-view.tsx";

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

test("tab adjacency stops at both edges", () => {
  const tabs = [{ id: "a" }, { id: "b" }];
  expect(adjacentTab(tabs, "a", -1)).toBeUndefined();
  expect(adjacentTab(tabs, "a", 1)?.id).toBe("b");
  expect(adjacentTab(tabs, "b", 1)).toBeUndefined();
});

test("pane IDs preserve recursive visual order", () => {
  expect(paneIds(projectLayout(splitFixture()))).toEqual(["a", "b"]);
});

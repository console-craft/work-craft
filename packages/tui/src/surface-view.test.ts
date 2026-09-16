import { expect, test } from "bun:test";
import type { LayoutNode } from "@work-craft/server";
import { projectLayout } from "./surface-view.tsx";

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

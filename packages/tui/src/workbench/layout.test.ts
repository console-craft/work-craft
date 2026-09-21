import { describe, expect, test } from "bun:test";

import type { LayoutNode } from "@work-craft/server/client";

import { paneIds, projectLayout } from "@/workbench/layout.ts";

const layout: LayoutNode = {
  type: "split",
  direction: "vertical",
  ratio: 0.4,
  first: { type: "pane", paneId: "pane-a" },
  second: {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "pane", paneId: "pane-b" },
    second: { type: "pane", paneId: "pane-c" },
  },
};

describe("workbench layout", () => {
  test("projects a recursive split without changing pane identity", () => {
    expect(projectLayout(layout)).toEqual({
      direction: "row",
      ratio: 0.4,
      children: [
        { paneId: "pane-a" },
        {
          direction: "column",
          ratio: 0.5,
          children: [{ paneId: "pane-b" }, { paneId: "pane-c" }],
        },
      ],
    });
  });

  test("pane IDs preserve recursive visual order", () => {
    expect(paneIds(layout)).toEqual(["pane-a", "pane-b", "pane-c"]);
    expect(paneIds(null)).toEqual([]);
  });
});

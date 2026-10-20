import { describe, expect, test } from "bun:test";

import type { LayoutNode } from "@work-craft/server/client";

import {
  hasRecoveryViewport,
  hasTerminalViewport,
  paneIds,
  projectPaneLayout,
  reactivateRect,
  terminalRect,
} from "@/workbench/layout.ts";

test("terminal and recovery eligibility use their distinct minimum interiors", () => {
  expect(hasTerminalViewport({ width: 20, height: 5 })).toBe(true);
  expect(hasTerminalViewport({ width: 19, height: 5 })).toBe(false);
  expect(hasTerminalViewport({ width: 20, height: 4 })).toBe(false);
  expect(hasRecoveryViewport({ width: 20, height: 4 })).toBe(true);
  expect(hasRecoveryViewport({ width: 19, height: 4 })).toBe(false);
  expect(hasRecoveryViewport({ width: 20, height: 3 })).toBe(false);
  expect(reactivateRect({ x: 2, y: 3, width: 60, height: 12 })).toEqual({
    x: 48,
    y: 13,
    width: 12,
    height: 1,
  });
});

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
  test("projects nested panes and divider cells in stable tree order", () => {
    expect(projectPaneLayout(layout, { x: 2, y: 3, width: 60, height: 20 })).toEqual({
      panes: [
        { paneId: "pane-a", rect: { x: 2, y: 3, width: 24, height: 20 } },
        { paneId: "pane-b", rect: { x: 27, y: 3, width: 35, height: 10 } },
        { paneId: "pane-c", rect: { x: 27, y: 14, width: 35, height: 9 } },
      ],
      dividers: [
        { id: "split", orientation: "vertical", rect: { x: 26, y: 3, width: 1, height: 20 } },
        {
          id: "split.second",
          orientation: "horizontal",
          rect: { x: 27, y: 13, width: 35, height: 1 },
        },
      ],
    });
  });

  test("vertical width 60 preserves 30/29 rounding and one divider", () => {
    expect(
      projectPaneLayout(
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "pane", paneId: "a" },
          second: { type: "pane", paneId: "b" },
        },
        { x: 40, y: 5, width: 60, height: 20 },
      ),
    ).toEqual({
      panes: [
        { paneId: "a", rect: { x: 40, y: 5, width: 30, height: 20 } },
        { paneId: "b", rect: { x: 71, y: 5, width: 29, height: 20 } },
      ],
      dividers: [
        { id: "split", orientation: "vertical", rect: { x: 70, y: 5, width: 1, height: 20 } },
      ],
    });
  });

  test("horizontal height 20 preserves 8/11 rounding and one divider", () => {
    expect(
      projectPaneLayout(
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.4,
          first: { type: "pane", paneId: "top" },
          second: { type: "pane", paneId: "bottom" },
        },
        { x: 40, y: 5, width: 60, height: 20 },
      ),
    ).toEqual({
      panes: [
        { paneId: "top", rect: { x: 40, y: 5, width: 60, height: 8 } },
        { paneId: "bottom", rect: { x: 40, y: 14, width: 60, height: 11 } },
      ],
      dividers: [
        { id: "split", orientation: "horizontal", rect: { x: 40, y: 13, width: 60, height: 1 } },
      ],
    });
  });

  test("tiny and zero bounds keep all leaves without negative rectangles", () => {
    expect(projectPaneLayout(layout, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
      panes: [
        { paneId: "pane-a", rect: { x: 0, y: 0, width: 0, height: 1 } },
        { paneId: "pane-b", rect: { x: 1, y: 0, width: 0, height: 0 } },
        { paneId: "pane-c", rect: { x: 1, y: 1, width: 0, height: 0 } },
      ],
      dividers: [
        { id: "split", orientation: "vertical", rect: { x: 0, y: 0, width: 1, height: 1 } },
        {
          id: "split.second",
          orientation: "horizontal",
          rect: { x: 1, y: 0, width: 0, height: 1 },
        },
      ],
    });
    const zero = projectPaneLayout(layout, { x: 0, y: 0, width: -1, height: 0 });
    expect(zero.panes.map(({ paneId }) => paneId)).toEqual(["pane-a", "pane-b", "pane-c"]);
    for (const { rect } of [...zero.panes, ...zero.dividers]) {
      expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    }
    expect(projectPaneLayout(null, { x: 0, y: 0, width: 60, height: 20 })).toEqual({
      panes: [],
      dividers: [],
    });
  });

  test("pane IDs preserve recursive visual order", () => {
    expect(paneIds(layout)).toEqual(["pane-a", "pane-b", "pane-c"]);
    expect(paneIds(null)).toEqual([]);
  });
});
test("terminal geometry reserves the top border and optional three-row footer", () => {
  expect(terminalRect({ x: 2, y: 4, width: 20, height: 8 }, true)).toEqual({
    x: 2,
    y: 5,
    width: 20,
    height: 4,
  });
  expect(terminalRect({ x: 2, y: 4, width: 20, height: 2 }, true)).toEqual({
    x: 2,
    y: 5,
    width: 20,
    height: 0,
  });
  expect(terminalRect({ x: 2, y: 4, width: 20, height: 8 }, false)).toEqual({
    x: 2,
    y: 5,
    width: 20,
    height: 7,
  });
  expect(terminalRect({ x: 2, y: 4, width: 20, height: 0 }, true)).toEqual({
    x: 2,
    y: 4,
    width: 20,
    height: 0,
  });
});

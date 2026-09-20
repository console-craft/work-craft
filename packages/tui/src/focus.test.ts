import { expect, test } from "bun:test";
import {
  focusAfterNavigatorHide,
  moveFocus,
  projectPaneFocusNodes,
  type FocusNode,
} from "./focus.ts";

const nodes: FocusNode[] = [
  { target: { region: "category" }, rect: { x: 0, y: 3, width: 5, height: 20 } },
  { target: { region: "navigator" }, rect: { x: 5, y: 3, width: 32, height: 20 } },
  {
    target: { region: "workbench", paneId: "left" },
    rect: { x: 37, y: 6, width: 30, height: 17 },
  },
  {
    target: { region: "workbench", paneId: "right" },
    rect: { x: 67, y: 6, width: 30, height: 17 },
  },
];

test("focus moves spatially across shell regions without wrapping", () => {
  expect(moveFocus({ region: "navigator" }, "left", nodes)).toEqual({ region: "category" });
  expect(moveFocus({ region: "navigator" }, "right", nodes)).toEqual({
    region: "workbench",
    paneId: "left",
  });
  expect(moveFocus({ region: "category" }, "left", nodes)).toEqual({ region: "category" });
});

test("recursive pane projection preserves vertical split geometry", () => {
  const projected = projectPaneFocusNodes(
    {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: "a" },
      second: { type: "pane", paneId: "b" },
    },
    { x: 40, y: 5, width: 60, height: 20 },
  );
  expect(projected).toEqual([
    { target: { region: "workbench", paneId: "a" }, rect: { x: 40, y: 5, width: 30, height: 20 } },
    { target: { region: "workbench", paneId: "b" }, rect: { x: 70, y: 5, width: 30, height: 20 } },
  ]);
});

test("recursive pane projection preserves horizontal split geometry", () => {
  const projected = projectPaneFocusNodes(
    {
      type: "split",
      direction: "horizontal",
      ratio: 0.4,
      first: { type: "pane", paneId: "top" },
      second: { type: "pane", paneId: "bottom" },
    },
    { x: 40, y: 5, width: 60, height: 20 },
  );
  expect(projected).toEqual([
    { target: { region: "workbench", paneId: "top" }, rect: { x: 40, y: 5, width: 60, height: 8 } },
    {
      target: { region: "workbench", paneId: "bottom" },
      rect: { x: 40, y: 13, width: 60, height: 12 },
    },
  ]);
});

test("vertical focus crosses from panes through tabs to the header", () => {
  const verticalNodes: FocusNode[] = [
    { target: { region: "workspace" }, rect: { x: 0, y: 0, width: 80, height: 2 } },
    { target: { region: "session" }, rect: { x: 80, y: 0, width: 20, height: 2 } },
    { target: { region: "tabs" }, rect: { x: 40, y: 2, width: 40, height: 3 } },
    {
      target: { region: "workbench", paneId: "top" },
      rect: { x: 40, y: 5, width: 40, height: 10 },
    },
    {
      target: { region: "workbench", paneId: "bottom" },
      rect: { x: 40, y: 15, width: 40, height: 10 },
    },
  ];

  expect(moveFocus({ region: "workbench", paneId: "top" }, "up", verticalNodes)).toEqual({
    region: "tabs",
  });
  expect(moveFocus({ region: "tabs" }, "up", verticalNodes)).toEqual({ region: "workspace" });
  expect(moveFocus({ region: "workbench", paneId: "top" }, "down", verticalNodes)).toEqual({
    region: "workbench",
    paneId: "bottom",
  });
});

test("focus prefers an overlapping candidate before a diagonally closer one", () => {
  const candidates: FocusNode[] = [
    { target: { region: "navigator" }, rect: { x: 10, y: 10, width: 10, height: 10 } },
    { target: { region: "category" }, rect: { x: 21, y: 0, width: 4, height: 4 } },
    { target: { region: "tabs" }, rect: { x: 24, y: 12, width: 5, height: 4 } },
  ];

  expect(moveFocus({ region: "navigator" }, "right", candidates)).toEqual({ region: "tabs" });
});

test("focus stops when only diagonal candidates remain at an outer edge", () => {
  const outerEdge: FocusNode[] = [
    {
      target: { region: "workbench", paneId: "right" },
      rect: { x: 60, y: 2, width: 40, height: 30 },
    },
    { target: { region: "session" }, rect: { x: 80, y: 0, width: 20, height: 1 } },
  ];
  expect(moveFocus({ region: "workbench", paneId: "right" }, "right", outerEdge)).toEqual({
    region: "workbench",
    paneId: "right",
  });
});

test("hiding a focused navigator prefers the last workbench pane", () => {
  expect(focusAfterNavigatorHide({ region: "navigator" }, "pane-2", true)).toEqual({
    region: "workbench",
    paneId: "pane-2",
  });
  expect(focusAfterNavigatorHide({ region: "navigator" }, null, false)).toEqual({
    region: "category",
  });
  expect(focusAfterNavigatorHide({ region: "tabs" }, "pane-2", true)).toEqual({
    region: "tabs",
  });
});

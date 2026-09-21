import { expect, test } from "bun:test";

import {
  calculateShellLayout,
  ellipsize,
  resizeNavigatorWidth,
  resolveNavigatorMode,
  visibleNavigatorWindow,
  workspaceViewport,
} from "@/shell/layout.ts";

const baseLayoutInput = {
  terminalWidth: 120,
  terminalHeight: 40,
  navigatorPreference: "expanded" as const,
  preferredNavigatorWidth: 32,
  activeSessionName: "Work",
  workspaces: [{ id: "workspace-1", label: "Main" }],
  activeWorkspaceId: "workspace-1",
  workspaceCursorId: "workspace-1",
  paneLayout: null,
};

test("navigator compacts below 120 columns in auto mode", () => {
  expect(
    resolveNavigatorMode({
      terminalWidth: 120,
      preference: "auto",
    }),
  ).toBe("expanded");
  expect(
    resolveNavigatorMode({
      terminalWidth: 119,
      preference: "auto",
    }),
  ).toBe("compact");
  expect(
    resolveNavigatorMode({
      terminalWidth: 119,
      preference: "expanded",
    }),
  ).toBe("expanded");
  expect(
    resolveNavigatorMode({
      terminalWidth: 120,
      preference: "hidden",
    }),
  ).toBe("hidden");
});

test("navigator width changes one column and stays within renderable bounds", () => {
  expect(resizeNavigatorWidth(32, -1, 120)).toBe(31);
  expect(resizeNavigatorWidth(16, -1, 120)).toBe(16);
  expect(resizeNavigatorWidth(114, 1, 120)).toBe(114);
});

test("visible navigator window keeps the cursor in view", () => {
  expect(visibleNavigatorWindow(20, 4, 12, 5)).toEqual({ start: 8, end: 13 });
});

test("workspace viewport keeps both active and cursor tabs when they fit", () => {
  const result = workspaceViewport(
    [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ],
    "b",
    "c",
    17,
  );
  expect(result.ids).toEqual(["b", "c"]);
  expect(result.hasPrevious).toBe(true);
  expect(result.hasNext).toBe(true);
});

test("labels use trailing ellipsis", () => {
  expect(ellipsize("configure analytics", 10)).toBe("configur…");
});

test("navigator stops above the status bar", () => {
  const layout = calculateShellLayout(baseLayoutInput);
  const navigator = layout.focusNodes.find(({ target }) => target.region === "navigator");
  expect(navigator?.rect).toEqual({ x: 5, y: 1, width: 32, height: 37 });
});

test("navigator is hidden when fewer than two body rows are available", () => {
  const layout = calculateShellLayout({ ...baseLayoutInput, terminalHeight: 4 });
  expect(layout.navigatorVisible).toBe(false);
  expect(layout.navigatorWidth).toBe(0);
  expect(layout.focusNodes.some(({ target }) => target.region === "navigator")).toBe(false);
});

test("narrow shells compact automatically", () => {
  const layout = calculateShellLayout({
    ...baseLayoutInput,
    terminalWidth: 119,
    navigatorPreference: "auto",
  });
  expect(layout.navigatorMode).toBe("compact");
  expect(layout.navigatorWidth).toBe(7);
  expect(layout.workbenchWidth).toBe(107);
});

test("minimum workbench size applies to the bordered interior", () => {
  expect(
    calculateShellLayout({
      ...baseLayoutInput,
      terminalWidth: 66,
      navigatorPreference: "hidden",
    }).undersized,
  ).toBe(true);
  expect(
    calculateShellLayout({
      ...baseLayoutInput,
      terminalWidth: 67,
      navigatorPreference: "hidden",
      terminalHeight: 10,
    }).undersized,
  ).toBe(false);
  expect(
    calculateShellLayout({
      ...baseLayoutInput,
      terminalWidth: 67,
      navigatorPreference: "hidden",
      terminalHeight: 9,
    }).undersized,
  ).toBe(true);
});

test("focus nodes include header, category, navigator, tabs, and pane geometry", () => {
  const layout = calculateShellLayout({
    ...baseLayoutInput,
    paneLayout: {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: "pane-1" },
      second: { type: "pane", paneId: "pane-2" },
    },
  });
  expect(layout.focusNodes).toEqual([
    { target: { region: "workspace" }, rect: { x: 0, y: 0, width: 102, height: 1 } },
    { target: { region: "session" }, rect: { x: 102, y: 0, width: 18, height: 1 } },
    { target: { region: "category" }, rect: { x: 0, y: 1, width: 5, height: 38 } },
    { target: { region: "tabs" }, rect: { x: 37, y: 1, width: 83, height: 1 } },
    { target: { region: "navigator" }, rect: { x: 5, y: 1, width: 32, height: 37 } },
    {
      target: { region: "workbench", paneId: "pane-1" },
      rect: { x: 37, y: 2, width: 41, height: 37 },
    },
    {
      target: { region: "workbench", paneId: "pane-2" },
      rect: { x: 79, y: 2, width: 41, height: 37 },
    },
  ]);
});

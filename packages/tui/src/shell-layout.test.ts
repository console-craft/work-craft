import { expect, test } from "bun:test";
import {
  DEFAULT_NAVIGATOR_WIDTH,
  ellipsize,
  projectInitials,
  resizeNavigatorWidth,
  resolveNavigatorMode,
  visibleNavigatorWindow,
  workspaceViewport,
} from "./shell-layout.ts";

test("navigator compacts only when auto width would starve the preferred workbench", () => {
  expect(
    resolveNavigatorMode({
      terminalWidth: 120,
      expandedWidth: DEFAULT_NAVIGATOR_WIDTH,
      preference: "auto",
    }),
  ).toBe("expanded");
  expect(
    resolveNavigatorMode({
      terminalWidth: 70,
      expandedWidth: DEFAULT_NAVIGATOR_WIDTH,
      preference: "auto",
    }),
  ).toBe("compact");
  expect(
    resolveNavigatorMode({
      terminalWidth: 70,
      expandedWidth: DEFAULT_NAVIGATOR_WIDTH,
      preference: "expanded",
    }),
  ).toBe("expanded");
  expect(
    resolveNavigatorMode({
      terminalWidth: 120,
      expandedWidth: DEFAULT_NAVIGATOR_WIDTH,
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

test("labels use stable initials and trailing ellipsis", () => {
  expect(projectInitials("Marketing Site")).toBe("MS");
  expect(ellipsize("configure analytics", 10)).toBe("configur…");
});

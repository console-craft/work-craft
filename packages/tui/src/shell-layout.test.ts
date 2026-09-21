import { expect, test } from "bun:test";
import {
  ellipsize,
  resizeNavigatorWidth,
  resolveNavigatorMode,
  visibleNavigatorWindow,
  workspaceViewport,
} from "./shell-layout.ts";

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

import { expect, test } from "bun:test";

import type { LayoutNode } from "../../api/protocol.ts";
import { equalizeLayout, splitLayout } from "../layout.ts";

test("replaces one leaf with a stable recursive split", () => {
  const root = { type: "pane" as const, paneId: "a" };

  expect(splitLayout(root, "a", "b", "vertical")).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: "a" },
    second: { type: "pane", paneId: "b" },
  });
  expect(root).toEqual({ type: "pane", paneId: "a" });
});

for (const direction of ["vertical", "horizontal"] as const) {
  test(`three repeated ${direction} splits receive equal logical shares`, () => {
    const original = splitLayout({ type: "pane", paneId: "a" }, "a", "b", direction);
    const originalJson = JSON.stringify(original);
    const root = splitLayout(original, "b", "c", direction);
    if (root.type !== "split" || root.second.type !== "split") {
      throw new Error("Expected three panes in the existing split topology");
    }

    expect(root.ratio).toBeCloseTo(1 / 3);
    expect(root.second.ratio).toBe(0.5);
    expect(JSON.stringify(original)).toBe(originalJson);
    expectValidRatios(root);
  });

  test(`four repeated ${direction} splits receive equal logical shares`, () => {
    const two = splitLayout({ type: "pane", paneId: "a" }, "a", "b", direction);
    const root = splitLayout(two, "b", "c", direction);
    const rootJson = JSON.stringify(root);
    const four = splitLayout(root, "c", "d", direction);
    expect(four).toEqual({
      type: "split",
      direction,
      ratio: 1 / 4,
      first: { type: "pane", paneId: "a" },
      second: {
        type: "split",
        direction,
        ratio: 1 / 3,
        first: { type: "pane", paneId: "b" },
        second: {
          type: "split",
          direction,
          ratio: 0.5,
          first: { type: "pane", paneId: "c" },
          second: { type: "pane", paneId: "d" },
        },
      },
    });
    expect(JSON.stringify(root)).toBe(rootJson);
    expectValidRatios(four);
  });

  test(`perpendicular splitting preserves the ${direction} shares`, () => {
    const original = splitLayout({ type: "pane", paneId: "a" }, "a", "b", direction);
    const originalJson = JSON.stringify(original);
    const perpendicular = direction === "vertical" ? "horizontal" : "vertical";
    const mixed = splitLayout(original, "b", "c", perpendicular);
    if (mixed.type !== "split" || mixed.second.type !== "split") {
      throw new Error("Expected a nested mixed-axis split");
    }

    expect(mixed.ratio).toBe(0.5);
    expect(mixed.second.ratio).toBe(0.5);
    expect(mixed.direction).toBe(direction);
    expect(mixed.second.direction).toBe(perpendicular);
    expect(JSON.stringify(original)).toBe(originalJson);
    expectValidRatios(mixed);
  });

  test(`splitting rebalances the entire ${direction} tree without changing its topology`, () => {
    const perpendicular = direction === "vertical" ? "horizontal" : "vertical";
    const original: LayoutNode = {
      type: "split",
      direction,
      ratio: 0.8,
      first: {
        type: "split",
        direction,
        ratio: 0.7,
        first: { type: "pane", paneId: "a" },
        second: { type: "pane", paneId: "b" },
      },
      second: { type: "pane", paneId: "c" },
    };
    const originalJson = JSON.stringify(original);

    const mixed = splitLayout(original, "c", "d", perpendicular);

    expect(mixed).toEqual({
      type: "split",
      direction,
      ratio: 2 / 3,
      first: {
        type: "split",
        direction,
        ratio: 0.5,
        first: { type: "pane", paneId: "a" },
        second: { type: "pane", paneId: "b" },
      },
      second: {
        type: "split",
        direction: perpendicular,
        ratio: 0.5,
        first: { type: "pane", paneId: "c" },
        second: { type: "pane", paneId: "d" },
      },
    });
    expect(JSON.stringify(original)).toBe(originalJson);
    expectValidRatios(mixed);
  });

  test(`equalization uses the maximum perpendicular ${direction} span, not total leaves`, () => {
    const perpendicular = direction === "vertical" ? "horizontal" : "vertical";
    const original = {
      type: "split",
      direction,
      ratio: 0.9,
      first: { type: "pane", paneId: "a" },
      second: {
        type: "split",
        direction: perpendicular,
        ratio: 0.8,
        first: {
          type: "split",
          direction,
          ratio: 0.7,
          first: { type: "pane", paneId: "b" },
          second: { type: "pane", paneId: "c" },
        },
        second: { type: "pane", paneId: "d" },
      },
    } satisfies LayoutNode;
    const originalJson = JSON.stringify(original);

    const balanced = equalizeLayout(original);

    expect(balanced).toEqual({
      ...original,
      ratio: 1 / 3,
      second: {
        ...original.second,
        ratio: 0.5,
        first: { ...original.second.first, ratio: 0.5 },
      },
    });
    expect(JSON.stringify(original)).toBe(originalJson);
    expect(equalizeLayout(balanced)).toEqual(balanced);
    expectValidRatios(balanced);
  });
}

test("equalizing a single pane preserves its identity", () => {
  const pane: LayoutNode = { type: "pane", paneId: "a" };

  expect(equalizeLayout(pane)).toBe(pane);
});

test("rejects a missing split target", () => {
  expect(() => splitLayout({ type: "pane", paneId: "a" }, "missing", "b", "vertical")).toThrow(
    "exactly once",
  );
});

test("rejects a duplicate split target", () => {
  expect(() =>
    splitLayout(
      {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "pane", paneId: "a" },
        second: { type: "pane", paneId: "a" },
      },
      "a",
      "b",
      "vertical",
    ),
  ).toThrow("exactly once");
});

function expectValidRatios(node: LayoutNode): void {
  if (node.type === "split") {
    expect(node.ratio).toBeGreaterThan(0);
    expect(node.ratio).toBeLessThan(1);
    expectValidRatios(node.first);
    expectValidRatios(node.second);
  }
}

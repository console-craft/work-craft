import { expect, test } from "bun:test";

import { BoxRenderable, type Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { cyclicIndex, pageIndex, renderedOrder } from "@/ui/interaction/collection";

test("collection order follows the rendered tree after keyed reorder, leaving visibility to callers", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const first = new BoxRenderable(renderer, { id: "first", visible: false });
  const second = new BoxRenderable(renderer, { id: "second" });
  renderer.root.add(first);
  renderer.root.add(second);
  const entries = new Map<Renderable, string>([
    [second, "second"],
    [first, "first"],
    [renderer.root, "root"],
  ]);
  try {
    expect(renderedOrder(renderer.root, entries)).toEqual(["root", "first", "second"]);
    renderer.root.remove(first);
    renderer.root.add(first);
    expect(renderedOrder(renderer.root, entries)).toEqual(["root", "second", "first"]);
    expect(renderedOrder(null, entries)).toEqual([]);
  } finally {
    renderer.destroy();
  }
});

test("cyclic candidates handle empty collections, missing cursors and edge wrapping", () => {
  expect(cyclicIndex(0, 0, 1)).toBeUndefined();
  expect(cyclicIndex(3, -1, -1)).toBe(2);
  expect(cyclicIndex(3, -1, 1)).toBe(0);
  expect(cyclicIndex(3, 2, 1)).toBe(0);
  expect(cyclicIndex(3, 0, -1)).toBe(2);
});

test("page candidates stop at the requested distance or the collection edge", () => {
  expect(pageIndex([], -1, 1, 5)).toBeUndefined();
  expect(pageIndex([0, 3, 10], 0, 1, 5)).toBe(2);
  expect(pageIndex([0, 3, 10], 2, -1, 5)).toBe(1);
  expect(pageIndex([0, 3, 10], 1, 1, 0)).toBe(2);
  expect(pageIndex([0, 3, 10], 1, -1, 50)).toBe(0);
  expect(pageIndex([0, 3, 10], 1, 1, 50)).toBe(2);
  expect(pageIndex([0, 3, 10], -1, -1, 5)).toBe(2);
  expect(pageIndex([0, 3, 10], -1, 1, 5)).toBe(0);
  expect(pageIndex([0, 3, 10], 0, -1, 5)).toBe(0);
});

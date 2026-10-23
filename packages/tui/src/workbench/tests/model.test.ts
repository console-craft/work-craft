import { expect, test } from "bun:test";

import { snapshotFixture } from "@/tests/support/fixtures";
import { selectedTab, surfaceForItem, tabsForSurface } from "@/workbench/model";

test("surface projection is exact and ordered tabs never mutate snapshot order", () => {
  const snapshot = snapshotFixture({
    surfaces: [{ id: "surface", itemId: "item-1" }],
    tabs: [
      { id: "b", surfaceId: "surface", position: 0, title: "B", layout: null },
      { id: "other", surfaceId: "other", position: -1, title: "Other", layout: null },
      { id: "a", surfaceId: "surface", position: 0, title: "A", layout: null },
    ],
  });
  Object.freeze(snapshot.tabs);
  expect(surfaceForItem(snapshot, "item-1")).toBe(snapshot.surfaces[0]);
  expect(surfaceForItem(snapshot, "missing")).toBeUndefined();
  expect(surfaceForItem(snapshot, undefined)).toBeUndefined();
  const tabs = tabsForSurface(snapshot, "surface");
  expect(tabs.map(({ id }) => id)).toEqual(["a", "b"]);
  expect(snapshot.tabs.map(({ id }) => id)).toEqual(["b", "other", "a"]);
  expect(tabsForSurface(snapshot, undefined)).toEqual([]);
  expect(selectedTab(tabs, "missing")).toBeUndefined();
  expect(selectedTab(tabs, null)).toBeUndefined();
  expect(selectedTab(tabs, "b")).toBe(snapshot.tabs[0]);
});

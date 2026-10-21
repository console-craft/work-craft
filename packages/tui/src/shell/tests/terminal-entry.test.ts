import { expect, test } from "bun:test";

import {
  canProjectTabEntry,
  entryPaneCandidates,
  entryRevisionReady,
} from "@/shell/terminal-entry";
import { snapshotFixture } from "@/tests/support/fixtures";

test("entry readiness needs the response revision in the same epoch", () => {
  const entry = { epoch: "e", revision: 5 };
  expect(entryRevisionReady(entry, { epoch: "e", revision: 4 })).toBe(false);
  expect(entryRevisionReady(entry, { epoch: "e", revision: 5 })).toBe(true);
  expect(entryRevisionReady(entry, { epoch: "e", revision: 6 })).toBe(true);
  expect(entryRevisionReady(entry, { epoch: "other", revision: 8 })).toBe(false);
  expect(entryRevisionReady({ ...entry, revision: null }, { epoch: "e", revision: 5 })).toBe(false);
  expect(entryRevisionReady(entry, null)).toBe(false);
});

test("exact command candidates never enter an unrelated running sibling", () => {
  for (const kind of ["restart", "split"] as const) {
    expect(entryPaneCandidates({ kind, paneId: "exact" }, ["sibling", "exact"], "sibling")).toEqual(
      ["exact"],
    );
    expect(entryPaneCandidates({ kind, paneId: "missing" }, ["sibling"], "sibling")).toEqual([]);
  }
  expect(
    entryPaneCandidates(
      { kind: "tab", paneId: "new", creation: { sourceTabId: "old", existingTabIds: ["old"] } },
      ["sibling", "new"],
      "sibling",
    ),
  ).toEqual(["new"]);
  expect(entryPaneCandidates({ kind: "item" }, ["a", "b"], "b")).toEqual(["b"]);
  expect(entryPaneCandidates({ kind: "item" }, ["a", "b"], "stopped")).toEqual([]);
  expect(entryPaneCandidates({ kind: "item" }, [], undefined)).toEqual([]);
});

test("ordinary entry never changes shared pane selection to bypass a stopped or clipped selected pane", () => {
  expect(entryPaneCandidates({ kind: "tab" }, ["running-sibling"], "selected-stopped")).toEqual([]);
  expect(entryPaneCandidates({ kind: "item" }, ["selected", "sibling"], "selected")).toEqual([
    "selected",
  ]);
});

test("snapshot-first creation can project a new selection without binding response IDs", () => {
  const entry = {
    sessionId: "session-work",
    itemId: "item-1",
    tabId: undefined,
    revision: null,
    creation: { sourceTabId: "old", existingTabIds: ["old"] },
  };
  const snapshot = snapshotFixture({
    navigation: [{ ...snapshotFixture().navigation[0]!, itemId: "item-1", tabId: "old" }],
    surfaces: [{ id: "s", itemId: "item-1" }],
  });
  expect(canProjectTabEntry(entry, snapshot)).toBe(false);
  snapshot.navigation[0]!.tabId = "unrelated-new";
  expect(canProjectTabEntry(entry, snapshot)).toBe(true);
  expect(entry.tabId).toBeUndefined();
  expect(
    canProjectTabEntry({ ...entry, tabId: "returned", revision: snapshot.revision }, snapshot),
  ).toBe(false);
  snapshot.navigation[0]!.tabId = "returned";
  expect(
    canProjectTabEntry({ ...entry, tabId: "returned", revision: snapshot.revision }, snapshot),
  ).toBe(true);
  expect(canProjectTabEntry(entry, null)).toBe(false);
});

import { expect, test } from "bun:test";

import {
  categoriesForWorkspace,
  navigatorEntries,
  rootIdForEntry,
  workspacesForSession,
} from "@/navigation/model.ts";
import { snapshotFixture } from "@/tests/support/fixtures.ts";

test("projects and visible items are projected only for one workspace category", () => {
  const entries = navigatorEntries(
    snapshotFixture(),
    "workspace-shared",
    "implementation",
    new Set(["root-1"]),
  );

  expect(entries.map(({ kind, id, depth }) => [kind, id, depth])).toEqual([
    ["root", "root-1", 0],
    ["item", "item-1", 1],
  ]);
  expect(rootIdForEntry(entries[1]!)).toBe("root-1");
});

test("collapsed projects omit item rows without changing project identity", () => {
  const entries = navigatorEntries(
    snapshotFixture(),
    "workspace-shared",
    "implementation",
    new Set(),
  );

  expect(entries.map(({ key }) => key)).toEqual(["root:root-1"]);
});

test("workspace and category regions keep server ordering", () => {
  const snapshot = snapshotFixture();
  expect(workspacesForSession(snapshot, "session-work").map(({ id }) => id)).toEqual([
    "workspace-shared",
    "workspace-work",
  ]);
  expect(categoriesForWorkspace(snapshot, "workspace-shared").map(({ kind }) => kind)).toEqual([
    "inbox",
    "today",
    "design",
    "implementation",
    "collaboration",
    "operations",
  ]);
});

test("matching child retains only its contextual ancestor and searches collapsed raw paths", () => {
  const snapshot = snapshotFixture();
  snapshot.items.push({ ...snapshot.items[1]!, id: "sibling", title: "Other" });
  const entries = navigatorEntries(
    snapshot,
    "workspace-shared",
    "implementation",
    new Set(),
    "FEATURE",
    "/work",
  );
  expect(entries.map((entry) => [entry.id, entry.matches])).toEqual([
    ["root-1", false],
    ["item-1", true],
    ["sibling", true],
  ]);
  expect(
    navigatorEntries(
      snapshot,
      "workspace-shared",
      "implementation",
      new Set(),
      "~/Ship",
      "/work",
    ).map((entry) => entry.id),
  ).toEqual(["root-1", "item-1", "sibling"]);
  expect(
    navigatorEntries(
      snapshot,
      "workspace-shared",
      "implementation",
      new Set(["root-1"]),
      "Work Craft",
      "/work",
    ).map((entry) => entry.id),
  ).toEqual(["root-1"]);
  snapshot.items[0]!.archived = true;
  expect(
    navigatorEntries(snapshot, "workspace-shared", "implementation", new Set(), "feature", "/work"),
  ).toEqual([]);
});

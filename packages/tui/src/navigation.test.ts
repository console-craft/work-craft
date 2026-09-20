import { expect, test } from "bun:test";
import {
  categoriesForWorkspace,
  navigatorEntries,
  projectIdForEntry,
  workspacesForSession,
} from "./navigation.ts";
import { snapshotFixture } from "./test-fixtures.ts";

test("projects and visible items are projected only for one workspace category", () => {
  const entries = navigatorEntries(
    snapshotFixture(),
    "workspace-shared",
    "implementation",
    new Set(["project-1"]),
  );

  expect(entries.map(({ kind, id, depth }) => [kind, id, depth])).toEqual([
    ["project", "project-1", 0],
    ["item", "item-1", 1],
  ]);
  expect(projectIdForEntry(entries[1]!)).toBe("project-1");
});

test("collapsed projects omit item rows without changing project identity", () => {
  const entries = navigatorEntries(
    snapshotFixture(),
    "workspace-shared",
    "implementation",
    new Set(),
  );

  expect(entries.map(({ key }) => key)).toEqual(["project:project-1"]);
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

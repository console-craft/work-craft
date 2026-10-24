import { expect, test } from "bun:test";

import { isCreationNavigationCurrent } from "@/shell/context";
import { snapshotFixture } from "@/tests/support/fixtures";

test("first-item normalization belongs to its create, but a remote navigation round trip does not", () => {
  const before = {
    ...snapshotFixture().navigation[0]!,
    generation: 1,
    category: "implementation" as const,
  };
  const normalized = { ...before, generation: 2, itemId: "new-root" };
  expect(isCreationNavigationCurrent(before, normalized, "new-child", "new-root")).toBe(true);
  expect(
    isCreationNavigationCurrent(before, { ...normalized, generation: 4 }, "new-child", "new-root"),
  ).toBe(false);
  expect(
    isCreationNavigationCurrent(
      before,
      { ...normalized, category: "today" },
      "new-child",
      "new-root",
    ),
  ).toBe(false);
  expect(
    isCreationNavigationCurrent(
      before,
      { ...normalized, itemId: "unrelated" },
      "new-child",
      "new-root",
    ),
  ).toBe(false);
});

test("first-workspace normalization cannot excuse unrelated targets or navigation round trips", () => {
  const before = {
    ...snapshotFixture().navigation[0]!,
    generation: 1,
    workspaceId: null,
    category: null,
    itemId: null,
    tabId: null,
    paneId: null,
  };
  const normalized = {
    ...before,
    generation: 2,
    workspaceId: "created",
    category: "inbox" as const,
  };
  expect(isCreationNavigationCurrent(before, normalized, "created", null, "workspace")).toBe(true);
  for (const after of [
    { ...normalized, workspaceId: "other" },
    { ...normalized, generation: 4 },
    { ...normalized, category: "design" as const },
    { ...normalized, itemId: "other" },
    { ...normalized, sessionId: "other" },
  ]) {
    expect(isCreationNavigationCurrent(before, after, "created", null, "workspace")).toBe(false);
  }
});

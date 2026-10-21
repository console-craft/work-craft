import { expect, test } from "bun:test";

import {
  completionContextKey,
  isCreationNavigationCurrent,
  navigationContextKey,
} from "@/shell/context";
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

test("context keys preserve null selection identities and tuple boundaries", () => {
  const state = {
    sessionId: "a,b",
    generation: 1,
    workspaceId: null,
    category: null,
    itemId: null,
    tabId: null,
    paneId: null,
  };
  expect(navigationContextKey(null, null)).toBe("[null,null,null]");
  expect(navigationContextKey("epoch", state)).toBe('["epoch","a,b",1]');
  expect(navigationContextKey("epoch", { ...state, generation: 2 })).not.toBe(
    navigationContextKey("epoch", state),
  );
  expect(completionContextKey("navigation", null, null)).toBe('["navigation",null,null]');
  expect(completionContextKey("navigation", "surface", "tab")).toBe(
    '["navigation","surface","tab"]',
  );
});

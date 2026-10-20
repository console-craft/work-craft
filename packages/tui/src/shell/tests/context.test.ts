import { expect, test } from "bun:test";

import { completionContextKey, navigationContextKey } from "@/shell/context";

test("context keys preserve null selection identities and tuple boundaries", () => {
  const state = {
    activeSessionId: null,
    activeWorkspaceId: null,
    activeCategory: "inbox" as const,
  };
  expect(navigationContextKey(null, state, null)).toBe('[null,null,null,"inbox",null]');
  expect(navigationContextKey("epoch", state, "item:a,b")).toBe(
    '["epoch",null,null,"inbox","item:a,b"]',
  );
  expect(completionContextKey("navigation", null, null)).toBe('["navigation",null,null]');
  expect(completionContextKey("navigation", "surface", "tab")).toBe(
    '["navigation","surface","tab"]',
  );
});

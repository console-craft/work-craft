import { expect, test } from "bun:test";

import type { WorkItem } from "../api/protocol.ts";
import {
  initialNavigation,
  type NavigationCatalog,
  normalizeNavigation,
  selectNavigation,
  stepNavigation,
} from "./navigation.ts";
import { CATEGORIES } from "./snapshot.ts";

function item(id: string, position: number, parentId: string | null = null): WorkItem {
  return {
    id,
    workspaceId: "w",
    category: "inbox",
    parentId,
    title: id,
    position,
    archived: false,
    kind: "generic",
    data: {},
  };
}

function catalog(): NavigationCatalog {
  return {
    sessions: [
      { id: "s", name: "First", position: 0 },
      { id: "other", name: "Other", position: 1 },
    ],
    workspaces: [{ id: "w", name: "Work" }],
    sessionWorkspaces: [
      { sessionId: "s", workspaceId: "w", position: 0 },
      { sessionId: "other", workspaceId: "w", position: 0 },
    ],
    categories: CATEGORIES.map((category) => ({ ...category, workspaceId: "w" })),
    items: [item("b", 1), item("child", 0, "a"), item("a", 0)],
    surfaces: [{ id: "surface", itemId: "a" }],
    tabs: [1, 2, 3, 4].map((n) => ({
      id: `tab-${n}`,
      surfaceId: "surface",
      title: `Tab ${n}`,
      position: n - 1,
      layout: { type: "pane" as const, paneId: `pane-${n}` },
    })),
    panes: [1, 2, 3, 4].map((n) => ({ id: `pane-${n}`, surfaceId: "surface" })),
  };
}

test("empty session initialization never creates an execution surface", () => {
  const data = catalog();
  data.sessionWorkspaces = [];
  const state = initialNavigation(data, "s");
  expect(state.cursor).toEqual({
    sessionId: "s",
    generation: 0,
    workspaceId: null,
    category: null,
    itemId: null,
    tabId: null,
    paneId: null,
  });
  expect(state.memory).toEqual({ surfaceTabs: {}, tabPanes: {} });
});

test("initial selection uses catalog preorder and valid tab/pane memories", () => {
  const data = catalog();
  const state = initialNavigation(data, "s", {
    surfaceTabs: { surface: "tab-3" },
    tabPanes: { "tab-3": "pane-3" },
  });
  expect(state.cursor).toEqual({
    sessionId: "s",
    generation: 0,
    workspaceId: "w",
    category: "inbox",
    itemId: "a",
    tabId: "tab-3",
    paneId: "pane-3",
  });
  expect(stepNavigation(data, state, "item", 1).cursor.itemId).toBe("child");
});

test("returning to a surface restores its own tab and pane without affecting another session", () => {
  const data = catalog();
  const first = initialNavigation(data, "s");
  const other = initialNavigation(data, "other");
  const selected = selectNavigation(data, first, { kind: "pane", paneId: "pane-3" });
  const away = selectNavigation(data, selected, { kind: "item", itemId: "b" });
  const returned = selectNavigation(data, away, { kind: "item", itemId: "a" });
  expect(returned.cursor).toMatchObject({ tabId: "tab-3", paneId: "pane-3", generation: 3 });
  expect(other.cursor).toMatchObject({ tabId: "tab-1", paneId: "pane-1", generation: 0 });
  expect(first.memory.surfaceTabs.surface).toBe("tab-1");
  expect(selectNavigation(data, returned, { kind: "pane", paneId: "pane-3" })).toBe(returned);
});

test("relative steps advance current state and clamp without adding generations", () => {
  const data = catalog();
  let state = initialNavigation(data, "s");
  state = { ...state, cursor: { ...state.cursor, generation: 4 } };
  for (const id of ["tab-2", "tab-3", "tab-4"]) {
    state = stepNavigation(data, state, "tab", 1);
    expect(state.cursor.tabId).toBe(id);
  }
  expect(state.cursor.generation).toBe(7);
  expect(stepNavigation(data, state, "tab", 1)).toBe(state);
  const away = selectNavigation(data, state, { kind: "tab", tabId: "tab-1" });
  expect(selectNavigation(data, away, { kind: "tab", tabId: "tab-4" }).cursor.generation).toBe(9);
});

test("category/workspace switches choose context without inventing surfaces", () => {
  const data = catalog();
  const state = selectNavigation(data, initialNavigation(data, "s"), {
    kind: "category",
    category: "design",
  });
  expect(state.cursor).toMatchObject({
    workspaceId: "w",
    category: "design",
    itemId: null,
    tabId: null,
    paneId: null,
  });
  expect(data.surfaces).toHaveLength(1);
  expect(selectNavigation(data, state, { kind: "workspace", workspaceId: "w" })).toBe(state);
});

test("invalid membership, archived ancestry and missing targets reject unchanged", () => {
  const data = catalog();
  const state = initialNavigation(data, "s");
  expect(() =>
    selectNavigation(data, state, { kind: "workspace", workspaceId: "missing" }),
  ).toThrow(/workspace/);
  expect(() => selectNavigation(data, state, { kind: "pane", paneId: "missing" })).toThrow(/pane/);
  data.items.find(({ id }) => id === "a")!.archived = true;
  expect(() => selectNavigation(data, state, { kind: "item", itemId: "child" })).toThrow(
    /archived|eligible/,
  );
  expect(state.cursor.generation).toBe(0);
});

for (const removed of ["tab-2", "tab-4"] as const) {
  test(`normalization picks the next then previous surviving tab after removing ${removed}`, () => {
    const before = catalog();
    const state = selectNavigation(before, initialNavigation(before, "s"), {
      kind: "tab",
      tabId: removed,
    });
    const after = { ...before, tabs: before.tabs.filter(({ id }) => id !== removed) };
    const repaired = normalizeNavigation(before, after, state);
    expect(repaired.cursor.tabId).toBe("tab-3");
    expect(repaired.cursor.generation).toBe(2);
    expect(repaired.memory.surfaceTabs.surface).toBe("tab-3");
  });
}

test("archival repairs roots and children without deleting surfaces or pane records", () => {
  const before = catalog();
  const state = selectNavigation(before, initialNavigation(before, "s"), {
    kind: "item",
    itemId: "child",
  });
  const after = {
    ...before,
    items: before.items.map((entry) => (entry.id === "a" ? { ...entry, archived: true } : entry)),
  };
  expect(normalizeNavigation(before, after, state).cursor).toMatchObject({
    itemId: "b",
    tabId: null,
    paneId: null,
  });
  expect(after.surfaces).toEqual(before.surfaces);
  expect(after.panes).toEqual(before.panes);
});

test("membership fallback follows old order, then clears the entire chain", () => {
  const before = catalog();
  before.workspaces.push({ id: "next", name: "Next" });
  before.categories.push(...CATEGORIES.map((category) => ({ ...category, workspaceId: "next" })));
  before.sessionWorkspaces.push({ sessionId: "s", workspaceId: "next", position: 1 });
  const state = initialNavigation(before, "s");
  const after = {
    ...before,
    sessionWorkspaces: before.sessionWorkspaces.filter(({ workspaceId }) => workspaceId !== "w"),
  };
  const repaired = normalizeNavigation(before, after, state);
  expect(repaired.cursor).toMatchObject({
    workspaceId: "next",
    category: "inbox",
    itemId: null,
    tabId: null,
    paneId: null,
  });
  expect(
    normalizeNavigation(after, { ...after, sessionWorkspaces: [] }, repaired).cursor,
  ).toMatchObject({ workspaceId: null, category: null, itemId: null, tabId: null, paneId: null });
});

test("normalization fills a newly nonempty context and leaves coherent state untouched", () => {
  const after = catalog();
  const before = { ...after, items: [], surfaces: [], tabs: [], panes: [] };
  const initial = initialNavigation(before, "s");
  const filled = normalizeNavigation(before, after, initial);
  expect(filled.cursor).toMatchObject({
    itemId: "a",
    tabId: "tab-1",
    paneId: "pane-1",
    generation: 1,
  });
  expect(normalizeNavigation(after, after, filled)).toBe(filled);
});

test("pane fallback uses old depth-first neighbors and clears an empty tab", () => {
  const before = catalog();
  before.tabs[0]!.layout = {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: "pane-1" },
    second: { type: "pane", paneId: "pane-2" },
  };
  before.tabs = before.tabs.slice(0, 1);
  const state = initialNavigation(before, "s");
  const after = { ...before, panes: before.panes.filter(({ id }) => id !== "pane-1") };
  const repaired = normalizeNavigation(before, after, state);
  expect(repaired.cursor).toMatchObject({ tabId: "tab-1", paneId: "pane-2", generation: 1 });
  const emptied = { ...after, panes: [] };
  expect(normalizeNavigation(after, emptied, repaired).cursor).toMatchObject({
    tabId: "tab-1",
    paneId: null,
    generation: 2,
  });
});

test("membership position ties use IDs while unavailable and stopped selections stay valid", () => {
  const data = catalog();
  data.workspaces.push({ id: "a-workspace", name: "Other" });
  data.sessionWorkspaces.push({ sessionId: "s", workspaceId: "a-workspace", position: 0 });
  expect(initialNavigation(data, "s").cursor.workspaceId).toBe("a-workspace");
  const before = catalog();
  const state = initialNavigation(before, "s");
  const after = catalog();
  Object.assign(after.panes[0]!, { processStatus: "exited" });
  after.items[2] = {
    ...after.items[2]!,
    title: "missing",
    kind: "directory",
    category: "implementation",
    data: {
      path: "/missing",
      branch: null,
      availability: "unavailable",
      isGitCheckout: false,
      gitCommonDir: null,
    },
  };
  after.items = after.items.filter(({ id }) => id !== "child");
  const selected = selectNavigation(after, state, { kind: "pane", paneId: "pane-1" });
  expect(selected.cursor).toMatchObject({
    category: "implementation",
    itemId: "a",
    paneId: "pane-1",
  });
  expect(normalizeNavigation(after, after, selected)).toBe(selected);
});

test("a pane referenced by multiple tabs is not an unambiguous navigation target", () => {
  const data = catalog();
  const state = initialNavigation(data, "s");
  data.tabs[1]!.layout = { type: "pane", paneId: "pane-1" };
  expect(() => selectNavigation(data, state, { kind: "pane", paneId: "pane-1" })).toThrow(
    /exactly one|ambiguous/,
  );
});

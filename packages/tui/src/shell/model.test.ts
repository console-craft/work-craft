import { expect, test } from "bun:test";

import {
  deriveShellModel,
  genericRootIdForShellContext,
  resolveShellFocus,
} from "@/shell/model.ts";
import { createInitialShellState, reconcileShellState } from "@/shell/state.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

test("filtering or archiving an active item does not erase its surface", () => {
  const snapshot = snapshotFixture({
    surfaces: [{ id: "surface", itemId: "item-1", activeTabId: null }],
  });
  const state = {
    ...createInitialShellState(),
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation" as const,
    activeNavigatorKey: "item:item-1",
    navigatorQuery: "no matches",
  };
  expect(deriveShellModel({ snapshot, state }).surface?.id).toBe("surface");
  snapshot.items[0]!.archived = true;
  expect(deriveShellModel({ snapshot, state }).surface?.id).toBe("surface");
});

const baseSnapshot = snapshotFixture({
  sessions: [{ id: "session-1", name: "Main", position: 0 }],
  workspaces: [{ id: "workspace-1", name: "Main" }],
  sessionWorkspaces: [{ sessionId: "session-1", workspaceId: "workspace-1", position: 0 }],
});

test("projects fixed categories when the active workspace has no category rows", () => {
  const model = deriveShellModel({
    snapshot: { ...baseSnapshot, categories: [] },
    state: createInitialShellState(),
  });
  expect(model.categories.map(({ kind }) => kind)).toEqual([
    "inbox",
    "today",
    "design",
    "implementation",
    "collaboration",
    "operations",
  ]);
});

test("undersized workbench focus falls back to tabs", () => {
  expect(
    resolveShellFocus({
      focus: { region: "workbench", paneId: "pane-1" },
      rememberedPaneId: "pane-1",
      paneIds: ["pane-1"],
      runningPaneIds: ["pane-1"],
      undersized: true,
    }),
  ).toEqual({ focus: { region: "tabs" }, focusedPaneId: "pane-1" });
});

test("stopped focused pane moves to tabs without losing its selected restart target", () => {
  expect(
    resolveShellFocus({
      focus: { region: "workbench", paneId: "pane-2" },
      rememberedPaneId: "pane-1",
      paneIds: ["pane-1", "pane-2"],
      runningPaneIds: ["pane-1"],
      undersized: false,
    }),
  ).toEqual({ focus: { region: "tabs" }, focusedPaneId: "pane-2" });
});

test("stale workbench focus falls back to tabs and the first current pane", () => {
  expect(
    resolveShellFocus({
      focus: { region: "workbench", paneId: "pane-old" },
      rememberedPaneId: "pane-old",
      paneIds: ["pane-1", "pane-2"],
      runningPaneIds: ["pane-1", "pane-2"],
      undersized: false,
    }),
  ).toEqual({ focus: { region: "tabs" }, focusedPaneId: "pane-1" });
});

test("remembered valid pane remains selected outside the workbench", () => {
  expect(
    resolveShellFocus({
      focus: { region: "category" },
      rememberedPaneId: "pane-2",
      paneIds: ["pane-1", "pane-2"],
      runningPaneIds: ["pane-1", "pane-2"],
      undersized: false,
    }),
  ).toEqual({ focus: { region: "category" }, focusedPaneId: "pane-2" });
});

test("projects sorted session, workspace, and tab indices", () => {
  const snapshot = snapshotFixture({
    sessions: [
      { id: "session-b", name: "Second", position: 1 },
      { id: "session-a", name: "First", position: 0 },
    ],
    workspaces: [
      { id: "workspace-b", name: "Second" },
      { id: "workspace-a", name: "First" },
    ],
    sessionWorkspaces: [
      { sessionId: "session-a", workspaceId: "workspace-b", position: 1 },
      { sessionId: "session-a", workspaceId: "workspace-a", position: 0 },
    ],
    categories: [
      { workspaceId: "workspace-a", kind: "implementation", title: "Build", position: 0 },
    ],
    items: snapshotFixture().items.map((item) => ({ ...item, workspaceId: "workspace-a" })),
    surfaces: [{ id: "surface-1", itemId: "item-1", activeTabId: "tab-b" }],
    tabs: [
      { id: "tab-b", surfaceId: "surface-1", title: "Second", position: 1, layout: null },
      { id: "tab-a", surfaceId: "surface-1", title: "First", position: 0, layout: null },
    ],
  });
  const state = {
    ...createInitialShellState(),
    activeSessionId: "session-a",
    activeWorkspaceId: "workspace-a",
    activeCategory: "implementation" as const,
    activeNavigatorKey: "item:item-1",
    tabCursorId: "tab-a",
    expandedRootIds: new Set(["root-1"]),
  };

  const model = deriveShellModel({ snapshot, state });

  expect(model.sessions.map(({ id }) => id)).toEqual(["session-a", "session-b"]);
  expect(model.workspaces.map(({ id }) => id)).toEqual(["workspace-a", "workspace-b"]);
  expect(model.tabs.map(({ id }) => id)).toEqual(["tab-a", "tab-b"]);
  expect({
    tabActiveIndex: model.tabActiveIndex,
    tabCursorIndex: model.tabCursorIndex,
  }).toEqual({
    tabActiveIndex: 1,
    tabCursorIndex: 0,
  });
});

test("item creation outside the navigator requires an active item", () => {
  const snapshot = snapshotFixture({
    items: snapshotFixture().items.map((item) => ({
      ...item,
      category: "design",
      kind: "generic",
      data: {},
    })),
  });
  const projectState = {
    ...reconcileShellState(createInitialShellState(), snapshot),
    focus: { region: "category" as const },
    activeWorkspaceId: "workspace-shared",
    activeCategory: "design" as const,
    activeNavigatorKey: null,
    expandedRootIds: new Set(["root-1"]),
  };
  expect(genericRootIdForShellContext(projectState, snapshot)).toBeUndefined();

  const itemState = { ...projectState, activeNavigatorKey: "item:item-1" };
  expect(genericRootIdForShellContext(itemState, snapshot)).toBe("root-1");

  const cursorState = {
    ...projectState,
    focus: { region: "navigator" as const },
    navigatorCursorKey: "root:root-1",
  };
  expect(genericRootIdForShellContext(cursorState, snapshot)).toBe("root-1");
});
test("an eligible exited action remains focused independently of terminal eligibility", () => {
  for (const eligible of [true, false]) {
    expect(
      resolveShellFocus({
        focus: { region: "workbench", paneId: "p", control: "reactivate" },
        rememberedPaneId: null,
        paneIds: ["p"],
        runningPaneIds: [],
        reactivatePaneIds: eligible ? ["p"] : [],
        undersized: false,
      }),
    ).toEqual({
      focus: eligible
        ? { region: "workbench", paneId: "p", control: "reactivate" }
        : { region: "tabs" },
      focusedPaneId: "p",
    });
  }
});

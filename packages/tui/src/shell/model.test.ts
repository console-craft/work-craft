import { expect, test } from "bun:test";
import { snapshotFixture } from "../test-fixtures.ts";
import { createInitialShellState, reconcileShellState } from "./state.ts";
import { deriveShellModel, projectIdForShellContext, resolveShellFocus } from "./model.ts";

const baseSnapshot = snapshotFixture({
  sessions: [{ id: "session-1", name: "Main", position: 0 }],
  workspaces: [{ id: "workspace-1", name: "Main" }],
  sessionWorkspaces: [{ sessionId: "session-1", workspaceId: "workspace-1", position: 0 }],
});

test("projects fixed categories when the active workspace has no category rows", () => {
  const model = deriveShellModel({
    snapshot: { ...baseSnapshot, categories: [] },
    state: createInitialShellState(),
    sessionCursorId: null,
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
      lastWorkbenchPaneId: "pane-1",
      paneIds: ["pane-1"],
      undersized: true,
    }),
  ).toEqual({ focus: { region: "tabs" }, focusedPaneId: "pane-1" });
});

test("stale workbench focus falls back to tabs and the first current pane", () => {
  expect(
    resolveShellFocus({
      focus: { region: "workbench", paneId: "pane-old" },
      lastWorkbenchPaneId: "pane-old",
      paneIds: ["pane-1", "pane-2"],
      undersized: false,
    }),
  ).toEqual({ focus: { region: "tabs" }, focusedPaneId: "pane-1" });
});

test("remembered valid pane remains selected outside the workbench", () => {
  expect(
    resolveShellFocus({
      focus: { region: "category" },
      lastWorkbenchPaneId: "pane-2",
      paneIds: ["pane-1", "pane-2"],
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
    projects: [
      {
        id: "project-1",
        workspaceId: "workspace-a",
        category: "implementation",
        name: "Work Craft",
        position: 0,
      },
    ],
    items: [
      {
        id: "item-1",
        projectId: "project-1",
        kind: "surface",
        title: "Extract model",
        position: 0,
        data: {},
        provenanceItemId: null,
      },
    ],
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
    workspaceCursorId: "workspace-b",
    tabCursorId: "tab-a",
    expandedProjectIds: new Set(["project-1"]),
  };

  const model = deriveShellModel({ snapshot, state, sessionCursorId: "session-b" });

  expect(model.sessions.map(({ id }) => id)).toEqual(["session-a", "session-b"]);
  expect(model.workspaces.map(({ id }) => id)).toEqual(["workspace-a", "workspace-b"]);
  expect(model.tabs.map(({ id }) => id)).toEqual(["tab-a", "tab-b"]);
  expect({
    sessionCursor: model.sessionCursor,
    sessionCursorIndex: model.sessionCursorIndex,
    workspaceCursorIndex: model.workspaceCursorIndex,
    tabActiveIndex: model.tabActiveIndex,
    tabCursorIndex: model.tabCursorIndex,
  }).toEqual({
    sessionCursor: "session-b",
    sessionCursorIndex: 1,
    workspaceCursorIndex: 1,
    tabActiveIndex: 1,
    tabCursorIndex: 0,
  });
});

test("item creation outside the navigator requires an active item", () => {
  const snapshot = snapshotFixture();
  const projectState = {
    ...reconcileShellState(createInitialShellState(), snapshot),
    focus: { region: "category" as const },
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation" as const,
    activeNavigatorKey: "project:project-1",
    expandedProjectIds: new Set(["project-1"]),
  };
  expect(projectIdForShellContext(projectState, snapshot)).toBeUndefined();

  const itemState = { ...projectState, activeNavigatorKey: "item:item-1" };
  expect(projectIdForShellContext(itemState, snapshot)).toBe("project-1");

  const cursorState = {
    ...projectState,
    focus: { region: "navigator" as const },
    navigatorCursorKey: "project:project-1",
  };
  expect(projectIdForShellContext(cursorState, snapshot)).toBe("project-1");
});

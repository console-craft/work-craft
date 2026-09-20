import { expect, test } from "bun:test";
import {
  createInitialShellState,
  projectIdForShellContext,
  reconcileShellState,
  reduceShellState,
} from "./shell-state.ts";
import { snapshotFixture } from "./test-fixtures.ts";

test("one session is selected automatically without opening the chooser", () => {
  const state = reconcileShellState(
    createInitialShellState(),
    snapshotFixture({
      sessions: [{ id: "session-1", name: "Main", position: 0 }],
    }),
  );
  expect(state.activeSessionId).toBe("session-1");
  expect(state.dialog).toBeNull();
});

test("deleting the active session opens the chooser and cancels creation", () => {
  const current = {
    ...createInitialShellState(),
    activeSessionId: "missing",
    dialog: {
      kind: "create" as const,
      createKind: "workspace" as const,
      returnFocus: { region: "workspace" as const },
    },
  };
  const state = reconcileShellState(current, snapshotFixture({ sessions: [] }));
  expect(state.activeSessionId).toBeNull();
  expect(state.dialog?.kind).toBe("sessions");
});

test("showing a resized navigator restores automatic mode and its width", () => {
  const resized = reduceShellState(
    { ...createInitialShellState(), navigatorWidth: 37 },
    { type: "navigator.resize", direction: 1, terminalWidth: 160 },
  );
  const hidden = reduceShellState(resized, {
    type: "navigator.toggle",
    hasWorkbench: false,
  });
  const shown = reduceShellState(hidden, { type: "navigator.toggle", hasWorkbench: false });
  expect(shown.navigatorPreference).toBe("auto");
  expect(shown.navigatorWidth).toBe(38);
});

test("resizing preserves automatic navigator behavior and remembers the width", () => {
  const resized = reduceShellState(
    { ...createInitialShellState(), navigatorWidth: 37 },
    { type: "navigator.resize", direction: 1, terminalWidth: 160 },
  );
  expect(resized.navigatorPreference).toBe("auto");
  expect(resized.navigatorWidth).toBe(38);
});

test("reconciliation preserves stable IDs when server ordering changes", () => {
  const initial = reconcileShellState(createInitialShellState(), snapshotFixture());
  const selected = {
    ...initial,
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-work",
    workspaceCursorId: "workspace-work",
  };
  const reordered = snapshotFixture({
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "workspace-work", position: 0 },
      { sessionId: "session-work", workspaceId: "workspace-shared", position: 1 },
    ],
  });

  const state = reconcileShellState(selected, reordered);

  expect(state.activeWorkspaceId).toBe("workspace-work");
  expect(state.workspaceCursorId).toBe("workspace-work");
});

test("focusing a pane records it for composite-region restoration", () => {
  const state = reduceShellState(createInitialShellState(), {
    type: "focus.set",
    focus: { region: "workbench", paneId: "pane-2" },
  });
  expect(state.focus).toEqual({ region: "workbench", paneId: "pane-2" });
  expect(state.lastWorkbenchPaneId).toBe("pane-2");
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

import { expect, test } from "bun:test";

import { createInitialShellState, reconcileShellState, reduceShellState } from "@/shell/state.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

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

test("reconciliation persists tab focus when the focused pane leaves the active tab", () => {
  const snapshot = snapshotFixture({
    surfaces: [{ id: "surface-1", itemId: "item-1", activeTabId: "tab-2" }],
    tabs: [
      {
        id: "tab-2",
        surfaceId: "surface-1",
        title: "Second",
        position: 0,
        layout: { type: "pane", paneId: "pane-2" },
      },
    ],
  });
  const current = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation" as const,
    activeNavigatorKey: "item:item-1",
    navigatorCursorKey: "item:item-1",
    expandedProjectIds: new Set(["project-1"]),
    focus: { region: "workbench" as const, paneId: "pane-1" },
    lastWorkbenchPaneId: "pane-1",
  };

  const state = reconcileShellState(current, snapshot);

  expect(state.focus).toEqual({ region: "tabs" });
  expect(state.lastWorkbenchPaneId).toBe("pane-1");
});

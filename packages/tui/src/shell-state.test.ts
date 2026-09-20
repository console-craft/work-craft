import { expect, test } from "bun:test";
import { createInitialShellState, reconcileShellState, reduceShellState } from "./shell-state.ts";
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

test("showing a hidden navigator restores expanded mode and width", () => {
  const hidden = reduceShellState(
    { ...createInitialShellState(), navigatorPreference: "hidden", navigatorWidth: 37 },
    { type: "navigator.toggle", hasWorkbench: false },
  );
  expect(hidden.navigatorPreference).toBe("expanded");
  expect(hidden.navigatorWidth).toBe(37);
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

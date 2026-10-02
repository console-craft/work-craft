import { expect, test } from "bun:test";

import { createInitialShellState, reconcileShellState, reduceShellState } from "@/shell/state.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

test("focus synchronization is idempotent only when target and pane memory agree", () => {
  const initial = createInitialShellState();
  expect(reduceShellState(initial, { type: "focus.set", focus: { region: "category" } })).toBe(
    initial,
  );
  const pane = { ...initial, focus: { region: "workbench" as const, paneId: "pane-2" } };
  const remembered = reduceShellState(pane, { type: "focus.set", focus: pane.focus });
  expect(remembered.lastWorkbenchPaneId).toBe("pane-2");
  expect(remembered).not.toBe(pane);
  expect(
    reduceShellState(remembered, {
      type: "focus.set",
      focus: { region: "workbench", paneId: "pane-2" },
    }),
  ).toBe(remembered);
  expect(
    reduceShellState(remembered, {
      type: "focus.set",
      focus: { region: "workbench", paneId: "pane-1" },
    }).lastWorkbenchPaneId,
  ).toBe("pane-1");
});

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

test("pending split focus survives earlier revisions but expires on catch-up, restart, or user focus", () => {
  const snapshot = snapshotFixture({
    revision: 2,
    surfaces: [{ id: "surface-1", itemId: "item-1", activeTabId: "tab-1" }],
    tabs: [
      {
        id: "tab-1",
        surfaceId: "surface-1",
        title: "Shell",
        position: 0,
        layout: { type: "pane", paneId: "pane-1" },
      },
    ],
  });
  const requested = reduceShellState(
    {
      ...createInitialShellState(),
      activeSessionId: "session-work",
      activeWorkspaceId: "workspace-shared",
      activeCategory: "implementation",
      activeNavigatorKey: "item:item-1",
      expandedProjectIds: new Set(["project-1"]),
    },
    {
      type: "focus.set",
      focus: { region: "workbench", paneId: "pane-2" },
      pendingWorkbenchFocus: { epoch: snapshot.epoch, revision: 3 },
    },
  );
  const earlier = reconcileShellState(requested, snapshot);
  expect(earlier.focus).toEqual({ region: "workbench", paneId: "pane-2" });
  const completed = {
    ...snapshot,
    revision: 3,
    tabs: [{ ...snapshot.tabs[0]!, layout: { type: "pane" as const, paneId: "pane-2" } }],
  };
  expect(reconcileShellState(earlier, completed).focus).toEqual({
    region: "workbench",
    paneId: "pane-2",
  });
  expect(reconcileShellState(earlier, completed).pendingWorkbenchFocus).toBeNull();
  const missing = reconcileShellState(earlier, { ...snapshot, revision: 3 });
  expect(missing.focus).toEqual({ region: "tabs" });
  expect(missing.pendingWorkbenchFocus).toBeNull();
  expect(reconcileShellState(earlier, { ...snapshot, epoch: "new-epoch" }).focus).toEqual({
    region: "tabs",
  });
  const cancelled = reduceShellState(earlier, { type: "focus.set", focus: { region: "tabs" } });
  expect(cancelled.pendingWorkbenchFocus).toBeNull();
  expect(reconcileShellState(cancelled, completed).focus).toEqual({ region: "tabs" });
});

test("a newly opened item survives lagging snapshots without overriding subsequent navigation", () => {
  const snapshot = snapshotFixture({ revision: 2, items: [] });
  const requested = reduceShellState(
    {
      ...createInitialShellState(),
      activeSessionId: "session-work",
      activeWorkspaceId: "workspace-shared",
      activeCategory: "implementation",
      expandedProjectIds: new Set(["project-1"]),
    },
    {
      type: "navigator.activate",
      key: "item:new-item",
      pending: { epoch: snapshot.epoch, revision: 3 },
    },
  );
  const earlier = reconcileShellState(requested, snapshot);
  expect(earlier.activeNavigatorKey).toBe("item:new-item");
  const ready = {
    ...snapshot,
    revision: 3,
    items: [{ ...snapshotFixture().items[0]!, id: "new-item" }],
  };
  expect(reconcileShellState(earlier, ready).activeNavigatorKey).toBe("item:new-item");
  expect(reconcileShellState(earlier, ready).pendingNavigatorActivation).toBeNull();
  expect(reconcileShellState(earlier, { ...snapshot, revision: 3 }).activeNavigatorKey).toBe(
    "project:project-1",
  );
  expect(reconcileShellState(earlier, { ...snapshot, epoch: "restart" }).activeNavigatorKey).toBe(
    "project:project-1",
  );
  const changed = reduceShellState(earlier, {
    type: "navigator.activate",
    key: "project:project-1",
  });
  expect(reconcileShellState(changed, ready).activeNavigatorKey).toBe("project:project-1");
  expect(
    reduceShellState(earlier, { type: "category.activate", category: "inbox" })
      .pendingNavigatorActivation,
  ).toBeNull();
});

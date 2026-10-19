import { expect, test } from "bun:test";

import { statusPresentation } from "@/shell/errors.ts";
import { createInitialShellState, reconcileShellState, reduceShellState } from "@/shell/state.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

test("ordinary input cannot renew an observed process failure expiry", () => {
  const failure = {
    sourceKey: "pane:p:process",
    sourceLabel: "Shell",
    operation: "Process",
    epoch: "e",
    contextKey: "",
    requestId: 1,
    message: "Missing shell",
    expiresAt: 8000,
    origin: "background" as const,
  };
  const before = reduceShellState(createInitialShellState(), {
    type: "sources.observe",
    epoch: "e",
    failures: [failure],
    now: 0,
  });
  const after = reduceShellState(before, {
    type: "sources.observe",
    epoch: "e",
    failures: [{ ...failure, requestId: 2, expiresAt: 12000 }],
    now: 4000,
  });
  expect(after.operationalError?.expiresAt).toBe(before.operationalError?.expiresAt);
  expect(
    statusPresentation({
      leaderActive: false,
      invalidMessage: null,
      invalidMessageUntil: null,
      operationalError: after.operationalError,
      now: 8001,
    }).mode,
  ).toBe("HINTS");
});

for (const removed of ["pane", "layout", "tab", "item", "archive", "parent archive"] as const) {
  test(`pane entry source retains its owner and is pruned on ${removed}`, () => {
    const snapshot = snapshotFixture({
      surfaces: [{ id: "s", itemId: "item-1", activeTabId: "t" }],
      tabs: [
        {
          id: "t",
          surfaceId: "s",
          title: "Tab",
          position: 0,
          layout: { type: "pane", paneId: "p" },
        },
      ],
      panes: [
        {
          id: "p",
          surfaceId: "s",
          kind: "terminal",
          title: "Shell",
          cwd: "/tmp",
          restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
          processStatus: "exited",
          errorText: null,
          startedAt: null,
          exitedAt: null,
        },
      ],
    });
    const error = {
      sourceKey: "pane:p:entry",
      sourceLabel: "Shell",
      operation: "Terminal entry",
      epoch: snapshot.epoch,
      contextKey: "",
      requestId: 4,
      message: "No running terminal",
      expiresAt: 8000,
      origin: "direct" as const,
    };
    const current = reduceShellState(createInitialShellState(), {
      type: "source.report",
      error,
      now: 0,
    });
    const retained = reconcileShellState(current, snapshot);
    expect(retained.operationalError).toBe(error);
    expect(
      reduceShellState(retained, {
        type: "source.clear",
        sourceKey: "pane:other:entry",
        requestId: 5,
      }).operationalError,
    ).toBe(error);
    if (removed === "pane") {
      snapshot.panes = [];
    } else if (removed === "layout") {
      snapshot.tabs[0]!.layout = null;
    } else if (removed === "tab") {
      snapshot.tabs = [];
    } else if (removed === "item") {
      snapshot.items = snapshot.items.filter((item) => item.id !== "item-1");
    } else {
      snapshot.items.find(
        (item) => item.id === (removed === "archive" ? "item-1" : "root-1"),
      )!.archived = true;
    }
    const pruned = reconcileShellState(retained, snapshot);
    expect(pruned.operationalError).toBeNull();
    expect(pruned.sourceFailures[error.sourceKey]).toBeUndefined();
  });
}

test("session transitions save and restore the destination workspace navigation scope", () => {
  const snapshot = snapshotFixture({
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "workspace-work", position: 0 },
      { sessionId: "session-personal", workspaceId: "workspace-personal", position: 0 },
    ],
    categories: [
      { workspaceId: "workspace-work", kind: "design", title: "Design", position: 0 },
      { workspaceId: "workspace-personal", kind: "design", title: "Design", position: 0 },
    ],
    items: [],
  });
  let state = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-work",
    activeCategory: "design" as const,
    navigatorQuery: "Work filter",
    navigatorCursorKey: "work-cursor",
    expandedRootIds: new Set(["work-root"]),
  } as ReturnType<typeof createInitialShellState>;
  state = reduceShellState(state, { type: "session.activate", id: "session-personal" });
  state = reconcileShellState(state, snapshot);
  expect(state.activeWorkspaceId).toBe("workspace-personal");
  expect(state.navigatorQuery).toBe("");
  expect(state.expandedRootIds.size).toBe(0);
  state = reduceShellState(state, { type: "navigator.query", query: "Personal filter" });
  state = reduceShellState(state, { type: "session.activate", id: "session-work" });
  state = reconcileShellState(state, snapshot);
  expect(state.activeWorkspaceId).toBe("workspace-work");
  expect(state.navigatorQuery).toBe("Work filter");
  expect(state.expandedRootIds.has("work-root")).toBe(true);
  state = reduceShellState(state, { type: "session.activate", id: "session-personal" });
  state = reconcileShellState(state, snapshot);
  expect(state.navigatorQuery).toBe("Personal filter");
});

test("snapshot-driven workspace repair changes navigation scope without leaking the old query", () => {
  const snapshot = snapshotFixture();
  const state = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "removed-workspace",
    navigatorQuery: "old workspace",
    expandedRootIds: new Set(["old-root"]),
  };
  const next = reconcileShellState(state, snapshot);
  expect(next.activeWorkspaceId).toBe("workspace-shared");
  expect(next.navigatorQuery).toBe("");
  expect(next.expandedRootIds.size).toBe(0);
});

for (const change of ["archive item", "archive parent", "remove item"] as const) {
  test(`source ownership prunes a direct item failure on ${change} without reviving it on restore`, () => {
    const snapshot = snapshotFixture();
    const error = {
      sourceKey: "item-1:surface.ensure",
      sourceLabel: "Child",
      operation: "Open",
      epoch: snapshot.epoch,
      contextKey: "current",
      requestId: 4,
      message: "Missing directory",
      expiresAt: 8000,
      origin: "direct" as const,
    };
    const current = reduceShellState(createInitialShellState(), {
      type: "source.report",
      error,
      now: 0,
    });
    expect(current.sourceFailures[error.sourceKey]).toBe(4);
    const changed = snapshotFixture({ items: snapshot.items.map((item) => ({ ...item })) });
    if (change === "remove item") {
      changed.items = changed.items.filter((item) => item.id !== "item-1");
    } else {
      changed.items.find(
        (item) => item.id === (change === "archive parent" ? "root-1" : "item-1"),
      )!.archived = true;
    }
    const reconciled = reconcileShellState(current, changed);
    expect(reconciled.operationalError).toBeNull();
    expect(reconciled.sourceFailures[error.sourceKey]).toBeUndefined();
    const restored = reconcileShellState(reconciled, snapshot);
    expect(restored.operationalError).toBeNull();
    expect(restored.sourceFailures[error.sourceKey]).toBeUndefined();
    const unrelated = { ...error, sourceKey: "daemon:reload", sourceLabel: "Daemon" };
    expect(
      reconcileShellState(
        reduceShellState(current, { type: "source.report", error: unrelated, now: 1 }),
        changed,
      ).operationalError,
    ).toBe(unrelated);
  });
}

test("native pane memory belongs to its tab rather than the last visited surface", () => {
  let state = createInitialShellState();
  state = reduceShellState(state, {
    type: "focus.set",
    focus: { region: "workbench", paneId: "p1" },
    tabId: "t1",
  });
  state = reduceShellState(state, {
    type: "focus.set",
    focus: { region: "workbench", paneId: "p2" },
    tabId: "t2",
  });
  expect(state.lastPaneByTab).toEqual({ t1: "p1", t2: "p2" });
});

for (const removed of ["tab", "surface", "item", "archive", "parent archive"] as const) {
  test(`tab entry source lives only while its visible owner exists (${removed})`, () => {
    const snapshot = snapshotFixture({
      surfaces: [{ id: "s", itemId: "item-1", activeTabId: "t" }],
      tabs: [{ id: "t", surfaceId: "s", title: "Tab", position: 0, layout: null }],
    });
    const error = {
      sourceKey: "tab:t:entry",
      sourceLabel: "Tab",
      operation: "Terminal entry",
      epoch: snapshot.epoch,
      contextKey: "current",
      requestId: 4,
      message: "No terminal",
      expiresAt: 8000,
      origin: "direct" as const,
    };
    let state = reduceShellState(createInitialShellState(), {
      type: "source.report",
      error,
      now: 0,
    });
    state = reconcileShellState(state, snapshot);
    expect(state.sourceFailures[error.sourceKey]).toBe(4);
    expect(state.operationalError).toBe(error);
    expect(
      reduceShellState(state, { type: "source.clear", sourceKey: "tab:other:entry", requestId: 5 })
        .operationalError,
    ).toBe(error);
    expect(
      reduceShellState(state, { type: "source.clear", sourceKey: error.sourceKey, requestId: 3 })
        .operationalError,
    ).toBe(error);
    expect(
      reduceShellState(state, { type: "source.clear", sourceKey: error.sourceKey, requestId: 5 })
        .operationalError,
    ).toBeNull();
    if (removed === "tab") {
      snapshot.tabs = [];
    }
    if (removed === "surface") {
      snapshot.surfaces = [];
    }
    if (removed === "item") {
      snapshot.items = snapshot.items.filter((item) => item.id !== "item-1");
    }
    if (removed === "archive") {
      snapshot.items[1]!.archived = true;
    }
    if (removed === "parent archive") {
      snapshot.items[0]!.archived = true;
    }
    state = reconcileShellState(state, snapshot);
    expect(state.sourceFailures[error.sourceKey]).toBeUndefined();
    expect(state.operationalError).toBeNull();
  });
}

test("width transitions auto-hide only once and guard recovery never reopens navigation", () => {
  let state = createInitialShellState(120);
  state = reduceShellState(state, { type: "presentation.resize", width: 119 });
  expect(state.navigatorOpen).toBe(false);
  state = reduceShellState(state, { type: "navigator.reveal" });
  state = reduceShellState(state, { type: "presentation.resize", width: 80 });
  expect(state.navigatorOpen).toBe(true);
  state = reduceShellState(state, { type: "presentation.resize", width: 120 });
  expect(state.navigatorOpen).toBe(true);
  state = reduceShellState(state, { type: "presentation.resize", width: 79 });
  state = reduceShellState(state, { type: "presentation.resize", width: 120 });
  expect(state.navigatorOpen).toBe(false);
  expect(createInitialShellState(80).navigatorOpen).toBe(false);
});

test("query expansion and cursor are isolated per workspace category", () => {
  let state: ReturnType<typeof createInitialShellState> = {
    ...createInitialShellState(),
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation",
  };
  state = reduceShellState(state, { type: "navigator.query", query: "branch" });
  state = reduceShellState(state, { type: "root.toggle", rootId: "root-1" });
  state = reduceShellState(state, { type: "navigator.cursor", key: "item:item-1" });
  state = reduceShellState(state, { type: "category.activate", category: "design" });
  expect(state.navigatorQuery).toBe("");
  expect(state.expandedRootIds.size).toBe(0);
  state = reduceShellState(state, { type: "category.activate", category: "implementation" });
  expect(state.navigatorQuery).toBe("branch");
  expect(state.expandedRootIds.has("root-1")).toBe(true);
  expect(state.navigatorCursorKey).toBe("item:item-1");
});

test("session attachment and reselection focus workspaces without refresh stealing focus", () => {
  expect(createInitialShellState().focus).toEqual({ region: "workspace" });
  const snapshot = snapshotFixture({
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
  });
  const attached = reconcileShellState(
    { ...createInitialShellState(), focus: { region: "category" } },
    snapshot,
  );
  expect(attached.focus).toEqual({ region: "workspace" });
  const browsing = { ...attached, focus: { region: "category" as const } };
  expect(reconcileShellState(browsing, { ...snapshot, revision: 5 }).focus).toEqual({
    region: "category",
  });
  expect(
    reduceShellState(browsing, { type: "session.activate", id: "session-work" }).focus,
  ).toEqual({ region: "workspace" });
});

test("focus synchronization is idempotent only when target and pane memory agree", () => {
  const initial = createInitialShellState();
  expect(reduceShellState(initial, { type: "focus.set", focus: { region: "workspace" } })).toBe(
    initial,
  );
  const pane = {
    ...initial,
    tabCursorId: "tab-1",
    focus: { region: "workbench" as const, paneId: "pane-2" },
  };
  const remembered = reduceShellState(pane, { type: "focus.set", focus: pane.focus });
  expect(remembered.lastPaneByTab["tab-1"]).toBe("pane-2");
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
    }).lastPaneByTab["tab-1"],
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
  expect(shown.navigatorOpen).toBe(true);
  expect(shown.navigatorWidth).toBe(38);
});

test("resizing preserves automatic navigator behavior and remembers the width", () => {
  const resized = reduceShellState(
    { ...createInitialShellState(), navigatorWidth: 37 },
    { type: "navigator.resize", direction: 1, terminalWidth: 160 },
  );
  expect(resized.navigatorOpen).toBe(true);
  expect(resized.navigatorWidth).toBe(38);
});

test("reconciliation preserves stable IDs when server ordering changes", () => {
  const initial = reconcileShellState(createInitialShellState(), snapshotFixture());
  const selected = {
    ...initial,
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-work",
  };
  const reordered = snapshotFixture({
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "workspace-work", position: 0 },
      { sessionId: "session-work", workspaceId: "workspace-shared", position: 1 },
    ],
  });

  const state = reconcileShellState(selected, reordered);

  expect(state.activeWorkspaceId).toBe("workspace-work");
});

test("a creation snapshot repairs browsing without selecting an item behind its form", () => {
  const state = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation" as const,
    focus: { region: "navigator" as const },
    dialog: {
      kind: "create" as const,
      createKind: "directory" as const,
      returnFocus: { region: "navigator" as const },
    },
  };
  const reconciled = reconcileShellState(state, snapshotFixture());
  expect(reconciled.activeNavigatorKey).toBeNull();
  expect(reconciled.navigatorCursorKey).toBe("root:root-1");
  const cancelled = reduceShellState(reconciled, { type: "dialog.close" });
  expect(cancelled.dialog).toBeNull();
  expect(cancelled.activeNavigatorKey).toBeNull();
  expect(cancelled.navigatorCursorKey).toBe("root:root-1");
});

test("focusing a pane records it for composite-region restoration", () => {
  const state = reduceShellState(createInitialShellState(), {
    type: "focus.set",
    focus: { region: "workbench", paneId: "pane-2" },
    tabId: "tab-1",
  });
  expect(state.focus).toEqual({ region: "workbench", paneId: "pane-2" });
  expect(state.lastPaneByTab["tab-1"]).toBe("pane-2");
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
    expandedRootIds: new Set(["root-1"]),
    focus: { region: "workbench" as const, paneId: "pane-1" },
    lastPaneByTab: { "tab-1": "pane-1" },
  };

  const state = reconcileShellState(current, snapshot);

  expect(state.focus).toEqual({ region: "tabs" });
  expect(state.lastPaneByTab["tab-1"]).toBeUndefined();
});

test("unavailable endpoints fall back to tabs and later snapshots cannot manufacture entry", () => {
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
      expandedRootIds: new Set(["root-1"]),
    },
    {
      type: "focus.set",
      focus: { region: "workbench", paneId: "pane-2" },
    },
  );
  const earlier = reconcileShellState(requested, snapshot);
  expect(earlier.focus).toEqual({ region: "tabs" });
  const completed = {
    ...snapshot,
    revision: 3,
    tabs: [{ ...snapshot.tabs[0]!, layout: { type: "pane" as const, paneId: "pane-2" } }],
    panes: [
      {
        id: "pane-2",
        surfaceId: "surface-1",
        kind: "terminal" as const,
        title: "Shell",
        cwd: "/tmp",
        restorePolicy: { type: "shell" as const, executable: "/bin/sh", args: [] },
        processStatus: "running" as const,
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  };
  expect(reconcileShellState(earlier, completed).focus).toEqual({ region: "tabs" });
  const missing = reconcileShellState(earlier, { ...snapshot, revision: 3 });
  expect(missing.focus).toEqual({ region: "tabs" });
  expect(reconcileShellState(earlier, { ...snapshot, epoch: "new-epoch" }).focus).toEqual({
    region: "tabs",
  });
  const cancelled = reduceShellState(earlier, { type: "focus.set", focus: { region: "tabs" } });
  expect(reconcileShellState(cancelled, completed).focus).toEqual({ region: "tabs" });
});

test("a newly opened item survives lagging snapshots without overriding subsequent navigation", () => {
  const snapshot = snapshotFixture({
    revision: 2,
    items: snapshotFixture().items.filter((item) => item.parentId === null),
  });
  const requested = reduceShellState(
    {
      ...createInitialShellState(),
      activeSessionId: "session-work",
      activeWorkspaceId: "workspace-shared",
      activeCategory: "implementation",
      expandedRootIds: new Set(["root-1"]),
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
    items: [...snapshot.items, { ...snapshotFixture().items[1]!, id: "new-item" }],
  };
  expect(reconcileShellState(earlier, ready).activeNavigatorKey).toBe("item:new-item");
  expect(reconcileShellState(earlier, ready).pendingNavigatorActivation).toBeNull();
  expect(reconcileShellState(earlier, { ...snapshot, revision: 3 }).activeNavigatorKey).toBe(
    "root:root-1",
  );
  expect(reconcileShellState(earlier, { ...snapshot, epoch: "restart" }).activeNavigatorKey).toBe(
    "root:root-1",
  );
  const changed = reduceShellState(earlier, {
    type: "navigator.activate",
    key: "root:root-1",
  });
  expect(reconcileShellState(changed, ready).activeNavigatorKey).toBe("root:root-1");
  expect(
    reduceShellState(earlier, { type: "category.activate", category: "inbox" })
      .pendingNavigatorActivation,
  ).toBeNull();
});
test("snapshot reconciliation retains an exited action, not a dead terminal, and repairs the action when it recovers", () => {
  const snapshot = snapshotFixture({
    surfaces: [{ id: "s", itemId: "item-1", activeTabId: "t" }],
    tabs: [
      {
        id: "t",
        surfaceId: "s",
        title: "Shell",
        position: 0,
        layout: { type: "pane", paneId: "p" },
      },
    ],
    panes: [
      {
        id: "p",
        surfaceId: "s",
        kind: "terminal",
        title: "Shell",
        cwd: "/tmp",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "exited",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  });
  const initial = reconcileShellState(createInitialShellState(), snapshot);
  const selected = {
    ...initial,
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation" as const,
    activeNavigatorKey: "item:item-1",
    focus: { region: "workbench" as const, paneId: "p", control: "reactivate" as const },
  };
  expect(reconcileShellState(selected, snapshot).focus).toEqual({
    region: "workbench",
    paneId: "p",
    control: "reactivate",
  });
  expect(
    reconcileShellState({ ...selected, focus: { region: "workbench", paneId: "p" } }, snapshot)
      .focus,
  ).toEqual({ region: "tabs" });
  expect(
    reconcileShellState(selected, {
      ...snapshot,
      panes: [{ ...snapshot.panes[0]!, processStatus: "running" }],
    }).focus,
  ).toEqual({ region: "tabs" });
});

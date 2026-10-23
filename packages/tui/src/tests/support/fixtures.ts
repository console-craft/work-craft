import type {
  ClientAttachment,
  CommandResponse,
  ControlSnapshot,
  InputStamp,
  Snapshot,
  StreamConnection,
} from "@work-craft/server/client";

import type { TerminalBuffer } from "@/client/terminal-buffer";

export function attachmentFixture(sessionId: string | null = "session-work"): ClientAttachment {
  return { connectionId: "test-connection", generation: 1, sessionId };
}

export function createScopeFixture(
  snapshot: Omit<Snapshot, "terminalHistories">,
  parentId: string | null = null,
) {
  return {
    epoch: snapshot.epoch,
    navigation: snapshot.navigation[0] ? { ...snapshot.navigation[0] } : null,
    parentId,
  };
}

export function streamFixture(overrides: Partial<StreamConnection> = {}): StreamConnection {
  return {
    close() {},
    sendInput() {},
    requestMaterial: async () => {
      throw new Error("Fixture has no material source");
    },
    sendSemantic: async () => {
      throw new Error("Fixture has no semantic sink");
    },
    reportViewport() {},
    activity() {},
    attach: async (sessionId) => attachmentFixture(sessionId),
    command: async (): Promise<CommandResponse> => ({
      ok: true,
      revision: 4,
      result: { id: "id" },
    }),
    ...overrides,
  };
}

export function inputStampFixture(
  snapshot: Omit<Snapshot, "terminalHistories">,
  attachment = attachmentFixture(),
): InputStamp {
  const navigation = snapshot.navigation.find(
    ({ sessionId }) => sessionId === attachment.sessionId,
  );
  return {
    epoch: snapshot.epoch,
    attachmentGeneration: attachment.generation,
    navigationGeneration: navigation?.generation ?? 0,
    geometrySequence:
      snapshot.geometry.tabs.find(({ tabId }) => tabId === navigation?.tabId)?.generation ?? 0,
  };
}

export function terminalBufferFixture(overrides: Partial<TerminalBuffer> = {}): TerminalBuffer {
  return {
    epoch: "epoch-a",
    runtimeGeneration: 0,
    resetGeneration: 0,
    history: new Uint8Array(),
    historyStartCursor: 0,
    historyPrefixBytes: 0,
    historyCursor: 0,
    initialSize: { cols: 80, rows: 24 },
    initialGridSequence: 0,
    resizes: [],
    chunks: [],
    ...overrides,
  };
}

/** Fixtures keep full CLI snapshots separate from the TUI's history-free metadata. */
export function controlSnapshotFixture(snapshot: Snapshot | ControlSnapshot): ControlSnapshot {
  if (!("terminalHistories" in snapshot)) {
    return snapshot;
  }
  const { terminalHistories, ...metadata } = snapshot;
  return {
    ...metadata,
    terminalStates: [
      ...new Set([
        ...snapshot.panes.map(({ id }) => id),
        ...terminalHistories.map(({ paneId }) => paneId),
      ]),
    ].map((paneId) => ({ paneId, runtimeGeneration: 0 })),
  };
}

/** Complete metadata for hand-built pane catalogs; individual replay tests supply their own history. */
export function terminalSnapshotFixture(snapshot: Snapshot): Snapshot {
  const addedGeometry =
    snapshot.panes.some(({ id }) => !snapshot.geometry.panes.some(({ paneId }) => paneId === id)) ||
    snapshot.tabs.some(({ id }) => !snapshot.geometry.tabs.some(({ tabId }) => tabId === id));
  const panes = snapshot.panes.map(
    ({ id }) =>
      snapshot.geometry.panes.find(({ paneId }) => paneId === id) ?? {
        paneId: id,
        size: { cols: 80, rows: 24 },
      },
  );
  return {
    ...snapshot,
    geometry: {
      ...snapshot.geometry,
      sequence: snapshot.geometry.sequence + Number(addedGeometry),
      tabs: snapshot.tabs.map(
        ({ id }) =>
          snapshot.geometry.tabs.find(({ tabId }) => tabId === id) ?? {
            tabId: id,
            generation: 0,
            ownerConnectionId: null,
            canvas: null,
          },
      ),
      panes,
    },
    terminalHistories: snapshot.panes.map(
      ({ id }) =>
        snapshot.terminalHistories.find(({ paneId }) => paneId === id) ?? {
          paneId: id,
          cursor: 0,
          data: "",
          truncated: false,
          startCursor: 0,
          prefixBytes: 0,
          initialSize: panes.find(({ paneId }) => paneId === id)!.size,
          initialGridSequence: 0,
          resizes: [],
        },
    ),
  };
}

export function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: "epoch-a",
    revision: 4,
    navigation: ["session-work", "session-personal"].map((sessionId) => ({
      sessionId,
      generation: 0,
      workspaceId: "workspace-shared",
      category: "inbox",
      itemId: null,
      tabId: null,
      paneId: null,
    })),
    geometry: { sequence: 0, tabs: [], panes: [] },
    sessions: [
      { id: "session-work", name: "Work", position: 0 },
      { id: "session-personal", name: "Personal", position: 1 },
    ],
    workspaces: [
      { id: "workspace-shared", name: "Shared" },
      { id: "workspace-work", name: "Work Only" },
      { id: "workspace-personal", name: "Personal Only" },
    ],
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "workspace-work", position: 1 },
      { sessionId: "session-work", workspaceId: "workspace-shared", position: 0 },
      { sessionId: "session-personal", workspaceId: "workspace-personal", position: 1 },
      { sessionId: "session-personal", workspaceId: "workspace-shared", position: 0 },
    ],
    categories: [
      { workspaceId: "workspace-shared", kind: "inbox", title: "Inbox", position: 0 },
      { workspaceId: "workspace-shared", kind: "today", title: "Today", position: 1 },
      { workspaceId: "workspace-shared", kind: "design", title: "Design", position: 2 },
      {
        workspaceId: "workspace-shared",
        kind: "implementation",
        title: "Implementation",
        position: 3,
      },
      {
        workspaceId: "workspace-shared",
        kind: "collaboration",
        title: "Collaboration",
        position: 4,
      },
      {
        workspaceId: "workspace-shared",
        kind: "operations",
        title: "Operations",
        position: 5,
      },
    ],
    items: [
      {
        id: "root-1",
        workspaceId: "workspace-shared",
        category: "implementation",
        parentId: null,
        kind: "directory",
        title: "Work Craft",
        archived: false,
        data: {
          path: "/work/Work Craft",
          branch: "trunk",
          availability: "available",
          isGitCheckout: true,
          gitCommonDir: "/work/Work Craft/.git",
        },
        position: 0,
      },
      {
        id: "item-1",
        workspaceId: "workspace-shared",
        category: "implementation",
        parentId: "root-1",
        kind: "worktree",
        title: "Ship navigator",
        position: 0,
        archived: false,
        data: { path: "/work/Ship navigator", branch: "feature", availability: "available" },
      },
    ],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
    ...overrides,
  };
}

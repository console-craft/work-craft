import { expect, test } from "bun:test";
import type { Snapshot, StreamHandlers, WorkCraftClient } from "@work-craft/server/client";
import { buildNavigation } from "./navigation.ts";
import { createWorkCraftStore } from "./use-work-craft.ts";

function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: "epoch-a",
    revision: 4,
    sessions: [{ id: "session-1", name: "Main", position: 0 }],
    workspaces: [{ id: "workspace-1", name: "Work" }],
    sessionWorkspaces: [{ sessionId: "session-1", workspaceId: "workspace-1", position: 0 }],
    categories: [
      { workspaceId: "workspace-1", kind: "inbox", title: "Inbox", position: 0 },
      { workspaceId: "workspace-1", kind: "today", title: "Today", position: 1 },
      { workspaceId: "workspace-1", kind: "design", title: "Design", position: 2 },
      {
        workspaceId: "workspace-1",
        kind: "implementation",
        title: "Implementation",
        position: 3,
      },
      {
        workspaceId: "workspace-1",
        kind: "collaboration",
        title: "Collaboration",
        position: 4,
      },
      { workspaceId: "workspace-1", kind: "operations", title: "Operations", position: 5 },
    ],
    projects: [
      {
        id: "project-1",
        workspaceId: "workspace-1",
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
        title: "Ship navigator",
        position: 0,
        data: {},
        provenanceItemId: null,
      },
    ],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
    ...overrides,
  };
}

function fakeClient(replacement: Snapshot): WorkCraftClient & { refreshCount(): number } {
  let refreshes = 0;
  return {
    ensureDaemon: async () => {},
    health: async () => ({ epoch: replacement.epoch, revision: replacement.revision, pid: 1 }),
    snapshot: async () => {
      refreshes += 1;
      return replacement;
    },
    command: async () => ({ ok: true, revision: replacement.revision, result: { id: "id" } }),
    stream: async () => {
      throw new Error("not used");
    },
    streamOnce: async () => ({ type: "snapshot", snapshot: replacement }),
    refreshCount: () => refreshes,
  };
}

test("projects and items appear under each fixed workspace category", () => {
  const tree = buildNavigation(snapshotFixture());
  const categories = tree[0]?.children?.[0]?.children;

  expect(categories?.map((node) => node.label)).toEqual([
    "Inbox",
    "Today",
    "Design",
    "Implementation",
    "Collaboration",
    "Operations",
  ]);
  expect(categories?.[3]?.children?.[0]).toEqual({
    key: "project:project-1",
    kind: "project",
    id: "project-1",
    label: "Work Craft",
    children: [{ key: "item:item-1", kind: "item", id: "item-1", label: "Ship navigator" }],
  });
});

test("a revision gap requests a replacement snapshot", async () => {
  const client = fakeClient(snapshotFixture({ revision: 4 }));
  const store = createWorkCraftStore(client);
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });

  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) });

  expect(store.snapshot()?.revision).toBe(4);
  expect(client.refreshCount()).toBe(1);
});

test("a gap refresh ignores an equal same-epoch snapshot", async () => {
  const original = snapshotFixture({ revision: 4 });
  const store = createWorkCraftStore(fakeClient(snapshotFixture({ revision: 4 })));
  await store.apply({ type: "snapshot", snapshot: original });
  let updates = 0;
  const unsubscribe = store.subscribe(() => {
    updates += 1;
  });

  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) });

  expect(store.snapshot()).toBe(original);
  expect(updates).toBe(0);
  unsubscribe();
});

test("snapshots apply only in order unless the daemon epoch changes", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 5 }) });
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({ epoch: "epoch-b", revision: 1 }),
  });

  expect(store.snapshot()?.epoch).toBe("epoch-b");
  expect(store.snapshot()?.revision).toBe(1);
});

test("a failed refresh does not prevent later snapshots", async () => {
  const client = fakeClient(snapshotFixture({ revision: 5 }));
  const replacement = client.snapshot;
  client.snapshot = async () => {
    client.snapshot = replacement;
    throw new Error("refresh failed");
  };
  const store = createWorkCraftStore(client);
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });

  await expect(
    store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) }),
  ).rejects.toThrow("refresh failed");
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 5 }) });

  expect(store.snapshot()?.revision).toBe(5);
});

test("a failed stream gap refresh closes the connection and starts reconnecting", async () => {
  const client = fakeClient(snapshotFixture({ revision: 4 }));
  const initialSnapshot = client.snapshot;
  let snapshots = 0;
  client.snapshot = async () => {
    snapshots += 1;
    if (snapshots === 1) {
      return initialSnapshot();
    }
    throw new Error("refresh failed");
  };
  let handlers: StreamHandlers | undefined;
  let closes = 0;
  client.stream = async (nextHandlers) => {
    handlers = nextHandlers;
    return {
      close() {
        closes += 1;
        nextHandlers.onClose?.();
      },
      sendInput() {},
      resize() {},
    };
  };
  const store = createWorkCraftStore(client);
  await store.start();
  try {
    handlers?.onMessage({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) });
    await Bun.sleep(0);

    expect(closes).toBe(1);
    expect(store.getState().status).toBe("disconnected");
  } finally {
    store.stop();
  }
});

test("current-epoch terminal output remains available after a renderer remount", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 3,
          data: Buffer.from("old").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });

  await store.apply({
    type: "terminal.output",
    epoch: "stale-epoch",
    paneId: "pane-1",
    cursor: 8,
    data: Buffer.from("stale").toString("base64"),
  });
  await store.apply({
    type: "terminal.output",
    epoch: "epoch-a",
    paneId: "pane-1",
    cursor: 6,
    data: Buffer.from("new").toString("base64"),
  });
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      revision: 5,
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 6,
          data: Buffer.from("oldnew").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });

  const terminal = store.getState().terminals.get("pane-1");
  expect(new TextDecoder().decode(terminal?.history)).toBe("old");
  expect(
    terminal?.chunks.map(({ cursor, data }) => [cursor, new TextDecoder().decode(data)]),
  ).toEqual([[6, "new"]]);
});

test("current-session terminal output is bounded to one MiB per pane", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({ type: "snapshot", snapshot: snapshotFixture() });
  const bytes = new Uint8Array(1_048_577).fill(2);
  bytes[0] = 1;

  await store.apply({
    type: "terminal.output",
    epoch: "epoch-a",
    paneId: "pane-1",
    cursor: 1_048_577,
    data: Buffer.from(bytes).toString("base64"),
  });

  const chunks = store.getState().terminals.get("pane-1")?.chunks ?? [];
  expect(chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0)).toBe(1_048_576);
  expect(chunks[0]?.data[0]).toBe(2);
});

test("a same-revision reconnect snapshot appends output missed while disconnected", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 3,
          data: Buffer.from("old").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });

  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 9,
          data: Buffer.from("oldmissed").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });

  const terminal = store.getState().terminals.get("pane-1");
  expect(new TextDecoder().decode(terminal?.history)).toBe("old");
  expect(
    terminal?.chunks.map(({ cursor, data }) => [cursor, new TextDecoder().decode(data)]),
  ).toEqual([[9, "missed"]]);
});

test("a reconnect snapshot requests a clean replay when its retained suffix starts too late", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 1,
          data: Buffer.from("a").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });
  const retained = new Uint8Array(1_048_576).fill(2);

  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 1_048_578,
          data: Buffer.from(retained).toString("base64"),
          truncated: true,
        },
      ],
    }),
  });

  const terminal = store.getState().terminals.get("pane-1");
  expect(terminal?.historyCursor).toBe(1_048_578);
  expect(terminal?.history).toEqual(retained);
  expect(terminal?.chunks).toEqual([]);
});

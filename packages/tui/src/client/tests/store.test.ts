import { expect, test } from "bun:test";

import type { Snapshot, StreamHandlers, WorkCraftClient } from "@work-craft/server/client";

import { createWorkCraftStore } from "@/client/store.ts";
import { terminalReplaySteps } from "@/client/terminal-replay";
import { inputStampFixture, snapshotFixture, streamFixture } from "@/tests/support/fixtures.ts";

const historyMetadata = {
  startCursor: 0,
  prefixBytes: 0,
  initialSize: null,
  initialGridSequence: null,
  resizes: [],
};

for (const lifecycle of ["reload", "stop and start"] as const) {
  test(`a delayed stream gap refresh cannot replace a newer epoch after ${lifecycle}`, async () => {
    const old = snapshotFixture({ epoch: "old", revision: 4 });
    const fresh = snapshotFixture({ epoch: "fresh", revision: 1 });
    const entered = deferred<void>();
    const refresh = deferred<Snapshot>();
    const handlers: StreamHandlers[] = [];
    let snapshots = 0;
    const client = fakeClient(old);
    client.snapshot = async () => {
      if (++snapshots === 1) {
        return old;
      }
      if (snapshots === 2) {
        entered.resolve();
        return refresh.promise;
      }
      return fresh;
    };
    client.stream = async (next) => {
      handlers.push(next);
      return streamFixture();
    };
    const store = createWorkCraftStore(client);
    try {
      await store.start();
      handlers[0]!.onMessage({ type: "snapshot", snapshot: { ...old, revision: 6 } });
      await entered.promise;
      if (lifecycle === "reload") {
        await store.reload();
      } else {
        store.stop();
        await store.start();
      }
      refresh.resolve({ ...old, revision: 6 });
      await store.apply({
        type: "terminal.output",
        geometrySequence: 0,
        epoch: "never",
        paneId: "p",
        cursor: 1,
        data: "",
      });
      expect(store.snapshot()).toBe(fresh);
      expect(store.getState().status).toBe("connected");
      expect(handlers).toHaveLength(2);
    } finally {
      refresh.resolve(old);
      store.stop();
    }
  });
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("a delayed output resync cannot overwrite a newly reconnected daemon snapshot", async () => {
  const initial = snapshotFixture({ epoch: "old" });
  const fresh = snapshotFixture({ epoch: "fresh", revision: 1 });
  const pending = deferred<Snapshot>();
  const client = fakeClient(initial);
  let reads = 0;
  client.snapshot = async () => (++reads === 1 ? initial : reads === 2 ? pending.promise : fresh);
  client.stream = async () => streamFixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    const resync = store.getState().resync();
    await store.reload();
    pending.resolve({ ...initial, revision: 100 });
    await resync;
    expect(store.snapshot()).toBe(fresh);
    expect(store.getState().status).toBe("connected");
  } finally {
    pending.resolve(initial);
    store.stop();
  }
});

test("delayed resync retains later live output and same-cursor resize markers", async () => {
  const initial = snapshotFixture({
    terminalHistories: [
      {
        paneId: "pane-1",
        cursor: 0,
        data: "",
        truncated: false,
        ...historyMetadata,
        initialGridSequence: 0,
      },
    ],
  });
  const pending = deferred<Snapshot>();
  const entered = deferred<void>();
  const client = fakeClient(initial);
  client.stream = async () => streamFixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    const output = (cursor: number, geometrySequence = 0) =>
      store.apply({
        type: "terminal.output",
        epoch: initial.epoch,
        paneId: "pane-1",
        cursor,
        data: Buffer.alloc(1_200_000, 120).toString("base64"),
        geometrySequence,
      });
    await output(1_200_000);
    await output(2_400_000);
    client.snapshot = async () => {
      entered.resolve();
      return pending.promise;
    };
    const resync = store.getState().resync();
    await entered.promise;
    const marker = { cursor: 2_400_000, sequence: 1, cols: 100, rows: 30 };
    await store.apply({
      type: "terminal.geometry",
      epoch: initial.epoch,
      geometry: { sequence: 1, tabs: [], panes: [{ paneId: "pane-1", size: marker }] },
      resizes: [{ paneId: "pane-1", marker }],
    });
    await output(3_600_000, 1);
    pending.resolve({
      ...initial,
      terminalHistories: [
        {
          paneId: "pane-1",
          cursor: 2_400_000,
          ...historyMetadata,
          startCursor: 1_500_000,
          prefixBytes: 2,
          initialGridSequence: 0,
          initialSize: { cols: 80, rows: 24 },
          truncated: true,
          data: Buffer.from("\x1bc" + "x".repeat(900_000)).toString("base64"),
        },
      ],
    });
    await resync;
    const current = store.getState().terminals.get("pane-1")!;
    expect(current.chunks.at(-1)?.cursor).toBe(3_600_000);
    const replay = terminalReplaySteps(current, { cursor: 2_400_000, gridSequence: 0 });
    expect(replay.needsSnapshot).toBe(false);
    expect(replay.steps.map(({ type }) => type)).toEqual(["resize", "bytes"]);
    expect(replay.steps.at(-1)).toMatchObject({ type: "bytes", cursor: 3_600_000, origin: "live" });
  } finally {
    pending.resolve(initial);
    store.stop();
  }
});

test("a delayed output resync cannot detach a session created and attached after its snapshot", async () => {
  const initial = snapshotFixture();
  const fresh = structuredClone(initial);
  fresh.revision += 1;
  fresh.sessions.push({ id: "session-new", name: "New", position: 2 });
  const pending = deferred<Snapshot>();
  const client = fakeClient(initial);
  client.stream = async () => streamFixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    await store.getState().attach("session-work");
    client.snapshot = async () => pending.promise;
    const resync = store.getState().resync();
    await store.apply({ type: "snapshot", snapshot: fresh });
    await store.getState().attach("session-new");
    const attachment = store.getState().attachment;
    expect(attachment?.sessionId).toBe("session-new");
    pending.resolve(initial);
    await resync;
    expect(store.snapshot()).toEqual(fresh);
    expect(store.getState().attachment).toBe(attachment);
    expect(store.getState().status).toBe("connected");
  } finally {
    pending.resolve(initial);
    store.stop();
  }
});

test("failed output resync falls back to reconnecting instead of leaving terminal replay stuck", async () => {
  const initial = snapshotFixture();
  const fresh = { ...initial, revision: initial.revision + 1 };
  const client = fakeClient(initial);
  let reads = 0;
  client.snapshot = async () => {
    if (++reads === 2) {
      throw new Error("Snapshot unavailable");
    }
    return reads === 1 ? initial : fresh;
  };
  client.stream = async () => streamFixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    await store.getState().attach("session-work");
    const stream = store.getState().stream;
    await store.getState().resync();
    expect(store.snapshot()).toBe(fresh);
    expect(store.getState().status).toBe("connected");
    expect(store.getState().stream).not.toBe(stream);
    expect(store.getState().attachment?.sessionId).toBe("session-work");
  } finally {
    store.stop();
  }
});

for (const change of [
  "exited",
  "failed",
  "interrupted",
  "epoch",
  "disconnect",
  "active tab",
  "removed",
  "item archived",
  "parent archived",
  "owner removed",
] as const) {
  test(`captured state rejects input after authoritative ${change} before React commits`, async () => {
    const snapshot = snapshotFixture({
      navigation: [
        {
          sessionId: "session-work",
          generation: 1,
          workspaceId: "workspace-shared",
          category: "implementation",
          itemId: "item-1",
          tabId: "tab-1",
          paneId: "pane-1",
        },
      ],
      geometry: {
        sequence: 0,
        tabs: [{ tabId: "tab-1", generation: 0, ownerConnectionId: null, canvas: null }],
        panes: [{ paneId: "pane-1", size: { cols: 80, rows: 24 } }],
      },
      surfaces: [{ id: "surface-1", itemId: "item-1" }],
      tabs: [
        {
          id: "tab-1",
          surfaceId: "surface-1",
          title: "Shell",
          position: 0,
          layout: { type: "pane", paneId: "pane-1" },
        },
      ],
      panes: [
        {
          id: "pane-1",
          surfaceId: "surface-1",
          kind: "terminal",
          title: "Shell",
          cwd: "/tmp",
          restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
          processStatus: "running",
          errorText: null,
          startedAt: null,
          exitedAt: null,
        },
      ],
    });
    const client = fakeClient(snapshot);
    client.stream = async () => streamFixture();
    const store = createWorkCraftStore(client);
    await store.start();
    await store.getState().attach("session-work");
    const stamp = inputStampFixture(snapshot);
    const capturedState = store.getState();
    expect(typeof capturedState.canSendInput).toBe("function");
    expect(capturedState.canSendInput("pane-1", stamp)).toBe(true);
    expect(capturedState.canSendInput("missing", stamp)).toBe(false);
    expect(capturedState.canSendInput("pane-1", { ...stamp, epoch: "old-epoch" })).toBe(false);
    const next = structuredClone(snapshot);
    next.revision += 1;
    if (change === "disconnect") {
      store.stop();
    } else {
      if (change === "epoch") {
        next.epoch = "epoch-b";
      } else if (change === "active tab") {
        next.navigation[0]!.tabId = "tab-2";
      } else if (change === "removed") {
        next.tabs[0]!.layout = null;
      } else if (change === "item archived" || change === "parent archived") {
        next.items.find(
          (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
        )!.archived = true;
      } else if (change === "owner removed") {
        next.items = next.items.filter((item) => item.id !== "item-1");
      } else {
        next.panes[0]!.processStatus = change;
      }
      await store.apply({ type: "snapshot", snapshot: next });
    }
    expect(capturedState.canSendInput).toBe(store.getState().canSendInput);
    expect(capturedState.canSendInput("pane-1", stamp)).toBe(false);
    store.stop();
  });
}

test("force reload closes the old stream and retains coherent state while connecting", async () => {
  const snapshot = snapshotFixture();
  let closes = 0;
  let streamCalls = 0;
  const client = fakeClient(snapshot);
  client.stream = async () => {
    streamCalls += 1;
    return streamFixture({
      close: () => {
        closes += 1;
      },
    });
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();

  const reload = store.reload();
  expect(store.getState().status).toBe("connecting");
  expect(store.getState().snapshot).toBe(snapshot);
  await reload;

  expect(closes).toBe(1);
  expect(streamCalls).toBe(2);
  expect(store.getState().status).toBe("connected");
});

test("automatic reconnect is yellow until recovery is exhausted", async () => {
  const client = fakeClient(snapshotFixture());
  let closeHandler: (() => void) | undefined;
  client.stream = async (handlers) => {
    closeHandler = handlers.onClose;
    return streamFixture();
  };
  const store = createWorkCraftStore(client, {
    retryDelays: [0],
    sleep: async () => {},
  });
  await store.start();
  closeHandler?.();
  expect(store.getState().status).toBe("connecting");
  await Bun.sleep(0);
  store.stop();
});

test("only the newest concurrent reload installs a stream", async () => {
  const snapshot = snapshotFixture();
  const firstSnapshot = deferred<Snapshot>();
  const secondSnapshot = deferred<Snapshot>();
  let snapshots = 0;
  let streams = 0;
  const client = fakeClient(snapshot);
  client.snapshot = async () => {
    snapshots += 1;
    if (snapshots === 1) {
      return snapshot;
    }
    return snapshots === 2 ? firstSnapshot.promise : secondSnapshot.promise;
  };
  client.stream = async () => {
    streams += 1;
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();

  const first = store.reload();
  const second = store.reload();
  firstSnapshot.resolve(snapshot);
  secondSnapshot.resolve(snapshot);
  await Promise.all([first, second]);

  expect(streams).toBe(2);
  expect(store.getState().status).toBe("connected");
});

test("stop during reload prevents a replacement stream", async () => {
  const snapshot = snapshotFixture();
  const nextSnapshot = deferred<Snapshot>();
  let snapshots = 0;
  let streams = 0;
  const client = fakeClient(snapshot);
  client.snapshot = async () => (++snapshots === 1 ? snapshot : nextSnapshot.promise);
  client.stream = async () => {
    streams += 1;
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();

  const reload = store.reload();
  store.stop();
  nextSnapshot.resolve(snapshot);
  await reload;

  expect(streams).toBe(1);
  expect(store.getState().status).toBe("disconnected");
});

test("an old stream close callback cannot start a competing reconnect", async () => {
  const client = fakeClient(snapshotFixture());
  const closeHandlers: (() => void)[] = [];
  let streams = 0;
  client.stream = async (handlers) => {
    streams += 1;
    closeHandlers.push(() => handlers.onClose?.());
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();
  await store.reload();

  closeHandlers[0]?.();
  await Bun.sleep(0);

  expect(streams).toBe(2);
  expect(store.getState().status).toBe("connected");
});

test("obsolete recovery failure cannot disconnect a successful reload", async () => {
  const client = fakeClient(snapshotFixture());
  const recovery = deferred<void>();
  const closeHandlers: (() => void)[] = [];
  let recoveries = 0;
  client.ensureDaemon = async () => {
    recoveries += 1;
    if (recoveries > 1) {
      await recovery.promise;
    }
  };
  client.stream = async (handlers) => {
    closeHandlers.push(() => handlers.onClose?.());
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();

  closeHandlers[0]?.();
  await Bun.sleep(0);
  await store.reload();
  expect(store.getState().status).toBe("connected");

  recovery.reject(new Error("obsolete recovery failed"));
  await Bun.sleep(0);

  expect(store.getState().status).toBe("connected");
});

test("an old stream message cannot replace state after reload", async () => {
  const oldSnapshot = snapshotFixture({ epoch: "old" });
  const currentSnapshot = snapshotFixture({ epoch: "current", revision: 1 });
  const handlers: StreamHandlers[] = [];
  let snapshots = 0;
  const client = fakeClient(oldSnapshot);
  client.snapshot = async () => (++snapshots === 1 ? oldSnapshot : currentSnapshot);
  client.stream = async (nextHandlers) => {
    handlers.push(nextHandlers);
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [] });
  await store.start();
  await store.reload();

  handlers[0]!.onMessage({ type: "snapshot", snapshot: oldSnapshot });
  await Bun.sleep(0);

  expect(store.snapshot()).toBe(currentSnapshot);
});

test("exhausted recovery becomes disconnected and rejects mutations", async () => {
  const client = fakeClient(snapshotFixture());
  client.stream = async () => {
    throw new Error("offline");
  };
  client.ensureDaemon = async () => {
    throw new Error("offline");
  };
  const store = createWorkCraftStore(client, {
    retryDelays: [0],
    sleep: async () => {},
  });

  await store.start();

  expect(store.getState().status).toBe("disconnected");
  await expect(
    store.getState().command({ type: "session.create", name: "Offline" }),
  ).rejects.toThrow("Cannot mutate while disconnected");
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
    return streamFixture({
      close() {
        closes += 1;
        nextHandlers.onClose?.();
      },
    });
  };
  const store = createWorkCraftStore(client, { retryDelays: [], sleep: async () => {} });
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
          ...historyMetadata,
          data: Buffer.from("old").toString("base64"),
          truncated: false,
        },
      ],
    }),
  });

  await store.apply({
    type: "terminal.output",
    epoch: "stale-epoch",
    geometrySequence: 0,
    paneId: "pane-1",
    cursor: 8,
    data: Buffer.from("stale").toString("base64"),
  });
  await store.apply({
    type: "terminal.output",
    epoch: "epoch-a",
    geometrySequence: 0,
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
          ...historyMetadata,
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

test("current-session terminal output is bounded to two MiB per pane", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({
      terminalHistories: [
        { paneId: "pane-1", cursor: 0, data: "", truncated: false, ...historyMetadata },
      ],
    }),
  });
  const bytes = new Uint8Array(2_097_153).fill(2);
  bytes[0] = 1;

  await store.apply({
    type: "terminal.output",
    epoch: "epoch-a",
    geometrySequence: 0,
    paneId: "pane-1",
    cursor: 2_097_153,
    data: Buffer.from(bytes).toString("base64"),
  });

  const chunks = store.getState().terminals.get("pane-1")?.chunks ?? [];
  expect(chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0)).toBe(2_097_152);
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
          ...historyMetadata,
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
          ...historyMetadata,
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
          ...historyMetadata,
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
          ...historyMetadata,
          startCursor: 2,
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
for (const change of [
  "running",
  "starting",
  "failed",
  "interrupted",
  "epoch",
  "disconnect",
  "active tab",
  "layout",
  "pane",
  "surface",
  "tab owner",
  "item",
  "parent",
  "item archived",
  "parent archived",
  "parent workspace",
  "parent category",
  "parent nesting",
] as const) {
  test(`captured exited-action eligibility rejects authoritative ${change} before React commits`, async () => {
    const snapshot = snapshotFixture({
      navigation: [
        {
          sessionId: "session-work",
          generation: 1,
          workspaceId: "workspace-shared",
          category: "implementation",
          itemId: "item-1",
          tabId: "t",
          paneId: "p",
        },
      ],
      geometry: {
        sequence: 0,
        tabs: [{ tabId: "t", generation: 0, ownerConnectionId: null, canvas: null }],
        panes: [{ paneId: "p", size: { cols: 80, rows: 24 } }],
      },
      surfaces: [{ id: "s", itemId: "item-1" }],
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
    const client = fakeClient(snapshot);
    client.stream = async () => streamFixture();
    const store = createWorkCraftStore(client);
    try {
      await store.start();
      await store.getState().attach("session-work");
      const stamp = inputStampFixture(snapshot);
      const captured = store.getState();
      expect(typeof captured.canReactivate).toBe("function");
      expect(captured.canReactivate("p", stamp)).toBe(true);
      expect(captured.canReactivate("missing", stamp)).toBe(false);
      expect(captured.canReactivate("p", { ...stamp, epoch: "old-epoch" })).toBe(false);
      expect(captured.canSendInput("p", stamp)).toBe(false);
      const next = structuredClone(snapshot);
      next.revision += 1;
      const parent = next.items.find((item) => item.id === "root-1")!;
      if (change === "disconnect") {
        store.stop();
      } else {
        if (change === "epoch") {
          next.epoch = "epoch-b";
        } else if (change === "active tab") {
          next.navigation[0]!.tabId = "other";
        } else if (change === "layout") {
          next.tabs[0]!.layout = null;
        } else if (change === "pane") {
          next.panes = [];
        } else if (change === "surface") {
          next.surfaces = [];
        } else if (change === "tab owner") {
          next.tabs[0]!.surfaceId = "other";
        } else if (change === "item" || change === "parent") {
          next.items = next.items.filter(
            (item) => item.id !== (change === "item" ? "item-1" : "root-1"),
          );
        } else if (change === "item archived" || change === "parent archived") {
          next.items.find(
            (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
          )!.archived = true;
        } else if (change === "parent workspace") {
          parent.workspaceId = "other";
        } else if (change === "parent category") {
          parent.category = "inbox";
        } else if (change === "parent nesting") {
          parent.parentId = "other";
        } else {
          next.panes[0]!.processStatus = change;
        }
        await store.apply({ type: "snapshot", snapshot: next });
      }
      expect(captured.canReactivate).toBe(store.getState().canReactivate);
      expect(captured.canReactivate("p", stamp)).toBe(false);
    } finally {
      store.stop();
    }
  });
}

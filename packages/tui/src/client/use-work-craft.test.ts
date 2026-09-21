import { expect, test } from "bun:test";

import type { Snapshot, StreamHandlers, WorkCraftClient } from "@work-craft/server/client";

import { createWorkCraftStore } from "@/client/use-work-craft.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

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

test("force reload closes the old stream and retains coherent state while connecting", async () => {
  const snapshot = snapshotFixture();
  let closes = 0;
  let streamCalls = 0;
  const client = fakeClient(snapshot);
  client.stream = async () => {
    streamCalls += 1;
    return {
      close: () => {
        closes += 1;
      },
      sendInput() {},
      resize() {},
    };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return { close() {}, sendInput() {}, resize() {} };
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
    return {
      close() {
        closes += 1;
        nextHandlers.onClose?.();
      },
      sendInput() {},
      resize() {},
    };
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

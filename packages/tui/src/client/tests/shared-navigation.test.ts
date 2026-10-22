import { expect, test } from "bun:test";

import type {
  InputStamp,
  Snapshot,
  StreamHandlers,
  WorkCraftClient,
} from "@work-craft/server/client";

import { createWorkCraftStore } from "@/client/store";
import { terminalReplaySteps } from "@/client/terminal-replay";
import {
  controlSnapshotFixture,
  snapshotFixture,
  streamFixture,
  terminalSnapshotFixture,
} from "@/tests/support/fixtures";

test("an old connection cannot append output after automatic reconnect in the same store run", async () => {
  const { snapshot, client } = fixture();
  snapshot.terminalHistories = [
    {
      paneId: "pane-1",
      cursor: 3,
      data: Buffer.from("old").toString("base64"),
      truncated: false,
      startCursor: 0,
      prefixBytes: 0,
      initialSize: { cols: 80, rows: 24 },
      initialGridSequence: 0,
      resizes: [],
    },
  ];
  const handlers: StreamHandlers[] = [];
  let connected!: () => void;
  const reconnected = new Promise<void>((resolve) => {
    connected = resolve;
  });
  client.stream = async (next) => {
    handlers.push(next);
    if (handlers.length === 2) {
      connected();
    }
    return streamFixture();
  };
  const store = createWorkCraftStore(client, { retryDelays: [0], sleep: async () => {} });
  try {
    await store.start();
    handlers[0]!.onClose?.();
    await reconnected;
    handlers[0]!.onMessage({
      type: "terminal.output",
      runtimeGeneration: 0,
      epoch: snapshot.epoch,
      geometrySequence: 1,
      paneId: "pane-1",
      cursor: 6,
      data: Buffer.from("BAD").toString("base64"),
    });
    await store.apply({ type: "snapshot", snapshot });
    expect(store.getState().outputs.pane("pane-1").read()?.chunks).toEqual([]);
  } finally {
    store.stop();
  }
});
import { snapshotTerminals, type TerminalBuffer } from "@/client/terminal-buffer";

test("a full snapshot replaces an incomplete byte queue even at the same tail cursor", () => {
  const previous: TerminalBuffer = {
    epoch: "epoch-a",
    runtimeGeneration: 0,
    resetGeneration: 0,
    history: new Uint8Array(),
    historyCursor: 0,
    historyStartCursor: 0,
    historyPrefixBytes: 0,
    initialSize: { cols: 80, rows: 24 },
    initialGridSequence: 0,
    resizes: [],
    chunks: [
      { cursor: 8, data: new TextEncoder().encode("tail"), geometrySequence: 0, origin: "live" },
    ],
  };
  const snapshot = snapshotFixture({
    terminalHistories: [
      {
        paneId: "pane-1",
        cursor: 8,
        data: Buffer.from("fulltail").toString("base64"),
        truncated: false,
        startCursor: 0,
        prefixBytes: 0,
        initialSize: { cols: 80, rows: 24 },
        initialGridSequence: 0,
        resizes: [],
      },
    ],
  });
  const result = snapshotTerminals(snapshot, new Map([["pane-1", previous]])).get("pane-1")!;
  expect(new TextDecoder().decode(result.history)).toBe("fulltail");
  expect(result.chunks).toEqual([]);
});

function fixture() {
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
      sequence: 1,
      tabs: [
        {
          tabId: "tab-1",
          generation: 1,
          ownerConnectionId: "connection",
          canvas: { cols: 100, rows: 30 },
        },
      ],
      panes: [{ paneId: "pane-1", size: { cols: 100, rows: 29 } }],
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
        cwd: "/",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "running",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  });
  const client: WorkCraftClient = {
    ensureDaemon: async () => {},
    health: async () => ({ epoch: "epoch-a", revision: 4, pid: 1 }),
    snapshot: async () => snapshot,
    controlSnapshot: async () => controlSnapshotFixture(await client.snapshot()),
    paneHistory: async (paneId) => ({
      epoch: snapshot.epoch,
      paneId,
      runtimeGeneration: 0,
      history: terminalSnapshotFixture(snapshot).terminalHistories.find(
        (history) => history.paneId === paneId,
      )!,
    }),
    command: async () => {
      throw new Error("TUI must use attached stream RPC");
    },
    streamOnce: async () => ({ type: "snapshot", snapshot }),
    stream: async () =>
      streamFixture({
        attach: async (sessionId) => ({ connectionId: "connection", generation: 1, sessionId }),
        command: async () => ({ ok: true, revision: 4, result: { id: "id" } }),
      }),
  };
  return { snapshot, client };
}

for (const sessionId of ["session-work", "other-session"]) {
  test(`buffered output retains response authority across ownership transfer (${sessionId})`, async () => {
    const { snapshot, client } = fixture();
    snapshot.sessions = [{ id: sessionId, name: "Viewer", position: 0 }];
    snapshot.navigation[0]!.sessionId = sessionId;
    snapshot.sessionWorkspaces = [{ sessionId, workspaceId: "workspace-shared", position: 0 }];
    snapshot.terminalHistories = [
      {
        paneId: "pane-1",
        cursor: 0,
        data: "",
        truncated: false,
        startCursor: 0,
        prefixBytes: 0,
        initialSize: { cols: 100, rows: 29 },
        initialGridSequence: 0,
        resizes: [],
      },
    ];
    const store = createWorkCraftStore(client);
    try {
      await store.start();
      await store.getState().attach(sessionId);
      const output = {
        type: "terminal.output" as const,
        runtimeGeneration: 0,
        epoch: snapshot.epoch,
        paneId: "pane-1",
        cursor: 4,
        data: Buffer.from("\x1b[6n").toString("base64"),
        geometrySequence: 1,
      };
      await store.apply(output);
      const original = store.getState().outputs.pane("pane-1").read()!;
      const stamp = {
        epoch: snapshot.epoch,
        attachmentGeneration: store.getState().attachment!.generation,
        navigationGeneration: 1,
        geometrySequence: 1,
      };
      expect(terminalReplaySteps(original, null).steps.at(-1)).toMatchObject({
        responseStamp: stamp,
      });
      const geometry = structuredClone(snapshot.geometry);
      geometry.sequence++;
      geometry.tabs[0]!.generation++;
      geometry.tabs[0]!.ownerConnectionId = "other-owner";
      await store.apply({
        type: "terminal.geometry",
        epoch: snapshot.epoch,
        geometry,
        resizes: [],
      });
      await store.apply({ ...output, cursor: 8, geometrySequence: 2 });
      const replay = terminalReplaySteps(store.getState().outputs.pane("pane-1").read()!, null);
      expect(
        replay.steps.flatMap((step) =>
          step.type === "bytes" && step.origin === "live" ? [step.responseStamp] : [],
        ),
      ).toEqual([stamp, null]);
      expect(store.getState().canRespond("pane-1", stamp)).toBe(false);
      const restored = structuredClone(geometry);
      restored.sequence++;
      restored.tabs[0]!.generation++;
      restored.tabs[0]!.ownerConnectionId = "connection";
      await store.apply({
        type: "terminal.geometry",
        epoch: snapshot.epoch,
        geometry: restored,
        resizes: [],
      });
      await store.apply({ ...output, cursor: 12 });
      expect(
        store.getState().outputs.pane("pane-1").read()!.chunks.at(-1)?.responseStamp,
      ).toBeNull();
    } finally {
      store.stop();
    }
  });
}

test("captured input and response stamps never revalidate after navigation away and back before React commits", async () => {
  const { snapshot, client } = fixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    await store.getState().attach("session-work");
    const captured = store.getState();
    const stamp: InputStamp = {
      epoch: "epoch-a",
      attachmentGeneration: 1,
      navigationGeneration: 1,
      geometrySequence: 1,
    };
    expect(captured.canSendInput("pane-1", stamp)).toBe(true);
    expect(captured.canRespond("pane-1", stamp)).toBe(true);
    for (const generation of [2, 3]) {
      const next = structuredClone(snapshot);
      next.revision += generation - 1;
      next.navigation[0]!.generation = generation;
      await store.apply({ type: "snapshot", snapshot: next });
      expect(captured.canSendInput("pane-1", stamp)).toBe(false);
      expect(captured.canRespond("pane-1", stamp)).toBe(false);
    }
  } finally {
    store.stop();
  }
});

test("same-revision geometry resync stays coherent and a delayed domain snapshot cannot roll it back", async () => {
  const { snapshot, client } = fixture();
  const store = createWorkCraftStore(client);
  try {
    await store.start();
    const next = structuredClone(snapshot);
    next.geometry.sequence = 3;
    next.geometry.tabs[0]!.generation = 2;
    next.geometry.tabs[0]!.ownerConnectionId = "other";
    client.snapshot = async () => next;
    await store.apply({
      type: "terminal.geometry",
      epoch: snapshot.epoch,
      geometry: next.geometry,
      resizes: [],
    });
    expect(store.getState().geometry).toEqual(next.geometry);
    expect(store.snapshot()?.geometry).toEqual(next.geometry);
    const delayed: Snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    await store.apply({ type: "snapshot", snapshot: delayed });
    expect(store.snapshot()?.revision).toBe(delayed.revision);
    expect(store.snapshot()?.geometry).toEqual(next.geometry);
    expect(store.getState().geometry).toEqual(next.geometry);
  } finally {
    store.stop();
  }
});

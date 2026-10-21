import { expect, test } from "bun:test";

import type {
  ControlSnapshot,
  PaneHistoryResponse,
  WorkCraftClient,
} from "@work-craft/server/client";

import { createWorkCraftStore } from "@/client/store";
import { snapshotFixture, streamFixture, terminalSnapshotFixture } from "@/tests/support/fixtures";

function fixture(count = 2) {
  const full = terminalSnapshotFixture(
    snapshotFixture({
      panes: Array.from({ length: count }, (_, index) => ({
        id: String(index),
        surfaceId: "surface",
        kind: "terminal",
        title: "Shell",
        cwd: "/",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "running",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      })),
    }),
  );
  const { terminalHistories, ...metadata } = full;
  const control: ControlSnapshot = {
    ...metadata,
    terminalStates: full.panes.map(({ id }) => ({ paneId: id, runtimeGeneration: 1 })),
  };
  let read = async (paneId: string): Promise<PaneHistoryResponse> => ({
    epoch: full.epoch,
    paneId,
    runtimeGeneration: 1,
    history: terminalHistories.find((history) => history.paneId === paneId)!,
  });
  const client: WorkCraftClient = {
    ensureDaemon: async () => {},
    health: async () => ({ epoch: full.epoch, revision: full.revision, pid: 1 }),
    snapshot: async () => full,
    controlSnapshot: async () => control,
    paneHistory: (paneId: string) => read(paneId),
    command: async () => ({ ok: true as const, revision: 5, result: { id: "id" } }),
    stream: async () => streamFixture(),
    streamOnce: async () => ({ type: "snapshot" as const, snapshot: full }),
  };
  const store = createWorkCraftStore(client);
  return {
    store,
    control,
    full,
    client,
    setRead: (next: typeof read) => {
      read = next;
    },
  };
}

test("held pane history never blocks unrelated output or command results", async () => {
  const f = fixture();
  await f.store.start();
  await Promise.all(
    f.control.terminalStates.map(({ paneId }) => f.store.getState().resyncPane(paneId)),
  );
  let release!: (response: PaneHistoryResponse) => void;
  const held = new Promise<PaneHistoryResponse>((resolve) => {
    release = resolve;
  });
  f.setRead(async () => held);
  const recovery = f.store.getState().resyncPane("0");
  const settled: string[] = [];
  try {
    await f.store.apply({
      type: "terminal.output",
      epoch: f.full.epoch,
      paneId: "1",
      runtimeGeneration: 1,
      cursor: 1,
      data: "eA==",
      geometrySequence: f.control.geometry.sequence,
    });
    settled.push("B-output");
    await f.store.apply({ type: "control.snapshot", snapshot: { ...f.control, revision: 5 } });
    settled.push("control");
    await f.store.getState().command({ type: "session.create", name: "Still works" });
    settled.push("command");
    expect(settled).toEqual(["B-output", "control", "command"]);
    expect(f.store.getState().snapshot).not.toHaveProperty("terminalHistories");
    expect(f.store.getState().outputs.pane("1").read()?.chunks.at(-1)?.cursor).toBe(1);
  } finally {
    release({
      epoch: f.full.epoch,
      paneId: "0",
      runtimeGeneration: 1,
      history: f.full.terminalHistories[0]!,
    });
    await recovery;
    f.store.stop();
  }
});

test("pane recovery is coalesced and at most four history requests run concurrently", async () => {
  const f = fixture(8);
  await f.store.start();
  await Promise.all(
    f.control.terminalStates.map(({ paneId }) => f.store.getState().resyncPane(paneId)),
  );
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  f.setRead(
    (paneId) =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        releases.push(() => {
          active--;
          resolve({
            epoch: f.full.epoch,
            paneId,
            runtimeGeneration: 1,
            history: f.full.terminalHistories.find((history) => history.paneId === paneId)!,
          });
        });
      }),
  );
  const jobs = Array.from({ length: 8 }, (_, index) =>
    f.store.getState().resyncPane(String(index)),
  );
  jobs.push(f.store.getState().resyncPane("0"));
  try {
    await Bun.sleep(0);
    expect(active).toBe(4);
    for (let index = 0; index < 8; index++) {
      releases[index]!();
      await Bun.sleep(0);
    }
    await Promise.all(jobs);
    expect(peak).toBe(4);
    expect(releases).toHaveLength(8);
  } finally {
    f.store.stop();
  }
});

test("late recovery cannot replace overtaking live bytes and two same-cursor resize markers", async () => {
  const f = fixture();
  await f.store.start();
  await Promise.all(
    f.control.terminalStates.map(({ paneId }) => f.store.getState().resyncPane(paneId)),
  );
  let release!: (response: PaneHistoryResponse) => void;
  const held = new Promise<PaneHistoryResponse>((resolve) => {
    release = resolve;
  });
  f.setRead(async () => held);
  const recovery = f.store.getState().resyncPane("0");
  try {
    await f.store.apply({
      type: "terminal.output",
      epoch: f.full.epoch,
      runtimeGeneration: 1,
      paneId: "0",
      cursor: 4,
      data: "Y2Q=",
      geometrySequence: f.control.geometry.sequence,
    });
    const markers = [
      { cursor: 4, sequence: 1, cols: 100, rows: 30 },
      { cursor: 4, sequence: 2, cols: 120, rows: 40 },
    ];
    await f.store.apply({
      type: "terminal.geometry",
      epoch: f.full.epoch,
      geometry: { ...f.control.geometry, sequence: f.control.geometry.sequence + 1 },
      resizes: markers.map((marker) => ({ paneId: "0", runtimeGeneration: 1, marker })),
    });
    release({
      epoch: f.full.epoch,
      paneId: "0",
      runtimeGeneration: 1,
      history: { ...f.full.terminalHistories[0]!, cursor: 2, data: "YWI=" },
    });
    await recovery;
    const buffer = f.store.getState().outputs.pane("0").read()!;
    expect([...buffer.history]).toEqual([97, 98]);
    expect([...buffer.chunks[0]!.data]).toEqual([99, 100]);
    expect(buffer.resizes).toEqual(markers);
    expect(buffer.chunks[0]?.responseStamp).toBeNull();
  } finally {
    f.store.stop();
  }
});

test("pane recovery starts at native acknowledgement rather than the newest received cursor", async () => {
  const f = fixture();
  await f.store.start();
  await Promise.all(
    f.control.terminalStates.map(({ paneId }) => f.store.getState().resyncPane(paneId)),
  );
  const output = f.store.getState().outputs.pane("0");
  output.next(null, 8192);
  output.consumed({ cursor: 0, gridSequence: 0 });
  const afterCursors: (number | undefined)[] = [];
  f.client.paneHistory = async (paneId, after) => {
    afterCursors.push(after);
    return {
      epoch: f.full.epoch,
      paneId,
      runtimeGeneration: 1,
      history: f.full.terminalHistories[0]!,
    };
  };
  try {
    await f.store.apply({
      type: "terminal.output",
      epoch: f.full.epoch,
      paneId: "0",
      runtimeGeneration: 1,
      cursor: 3,
      data: "YWJj",
      geometrySequence: f.control.geometry.sequence,
    });
    output.next({ cursor: 0, gridSequence: 0 }, 8192);
    await f.store.getState().resyncPane("0");
    expect(afterCursors).toEqual([0]);
  } finally {
    f.store.stop();
  }
});

for (const change of ["runtime", "epoch", "navigation", "reload"] as const) {
  test(`obsolete pane history cannot regain authority after ${change}`, async () => {
    const f = fixture();
    await f.store.start();
    await f.store.getState().attach("session-work");
    await Promise.all(
      f.control.terminalStates.map(({ paneId }) => f.store.getState().resyncPane(paneId)),
    );
    let release!: (response: PaneHistoryResponse) => void;
    let aborted = false;
    const held = new Promise<PaneHistoryResponse>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    f.client.paneHistory = async (paneId, _after, options) => {
      if (reads++ === 0) {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return held;
      }
      const current = f.store.getState().snapshot!;
      return {
        epoch: current.epoch,
        paneId,
        runtimeGeneration: current.terminalStates.find((state) => state.paneId === paneId)!
          .runtimeGeneration,
        history: f.full.terminalHistories.find((history) => history.paneId === paneId)!,
      };
    };
    const recovery = f.store.getState().resyncPane("0");
    try {
      if (change === "reload") {
        await f.store.reload();
      } else {
        const next = { ...f.control, revision: 5 };
        if (change === "runtime") {
          next.terminalStates = next.terminalStates.map((state) =>
            state.paneId === "0" ? { ...state, runtimeGeneration: 2 } : state,
          );
        } else if (change === "epoch") {
          next.epoch = "replacement-daemon";
        } else {
          next.navigation = next.navigation.map((navigation) => ({
            ...navigation,
            generation: navigation.generation + 2,
          }));
        }
        await f.store.apply({ type: "control.snapshot", snapshot: next });
      }
      release({
        epoch: f.full.epoch,
        paneId: "0",
        runtimeGeneration: 1,
        history: { ...f.full.terminalHistories[0]!, cursor: 3, data: "QkFE" },
      });
      await recovery;
      await Bun.sleep(0);
      const buffer = f.store.getState().outputs.pane("0").read()!;
      expect(aborted).toBe(true);
      expect(new TextDecoder().decode(buffer.history)).not.toContain("BAD");
      if (change === "runtime") {
        expect(buffer.runtimeGeneration).toBe(2);
      }
      if (change === "epoch") {
        expect(buffer.epoch).toBe("replacement-daemon");
      }
    } finally {
      f.store.stop();
    }
  });
}

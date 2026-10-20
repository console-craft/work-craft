import {
  type Command,
  type CommandResponse,
  decodeBytes,
  type LayoutNode,
  type ServerMessage,
  type Snapshot,
  type StreamConnection,
  type WorkCraftClient,
} from "@work-craft/server/client";

import {
  appendTerminalChunk,
  snapshotTerminals,
  type TerminalBuffer,
} from "@/client/terminal-buffer";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type WorkCraftState = {
  connectionError: string | null;
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  /** Reads current authoritative state even from callbacks captured before a React commit. */
  canSendInput(paneId: string, epoch: string): boolean;
  /** Live exited-action readiness; never grants terminal input eligibility. */
  canReactivate(paneId: string, epoch: string): boolean;
  command(command: Command): Promise<CommandResponse>;
  reload(): Promise<void>;
  stream: StreamConnection | null;
  terminals: ReadonlyMap<string, TerminalBuffer>;
};

export type WorkCraftStore = {
  apply(message: ServerMessage): Promise<void>;
  getState(): WorkCraftState;
  reload(): Promise<void>;
  snapshot(): Snapshot | null;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
};

export type WorkCraftStoreOptions = {
  retryDelays?: readonly number[];
  sleep?(milliseconds: number): Promise<void>;
};

const RETRY_DELAYS = [100, 250, 500, 1000, 2000] as const;

function containsPane(layout: LayoutNode | null, paneId: string): boolean {
  if (layout === null) {
    return false;
  }
  return layout.type === "pane"
    ? layout.paneId === paneId
    : containsPane(layout.first, paneId) || containsPane(layout.second, paneId);
}

export function createWorkCraftStore(
  client: WorkCraftClient,
  options: WorkCraftStoreOptions = {},
): WorkCraftStore {
  const listeners = new Set<() => void>();
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const sleep = options.sleep ?? Bun.sleep;
  let run = 0;
  let applying = Promise.resolve();
  let state: WorkCraftState = {
    connectionError: null,
    snapshot: null,
    status: "connecting",
    canSendInput: (paneId, epoch) => canUsePane(paneId, epoch, "running"),
    canReactivate: (paneId, epoch) => canUsePane(paneId, epoch, "exited"),
    command: async (command) => {
      if (state.status !== "connected") {
        throw new Error("Cannot mutate while disconnected");
      }
      return client.command(command);
    },
    reload,
    stream: null,
    terminals: new Map(),
  };

  function canUsePane(paneId: string, epoch: string, status: "running" | "exited"): boolean {
    const snapshot = state.snapshot;
    if (state.status !== "connected" || snapshot?.epoch !== epoch) {
      return false;
    }
    const pane = snapshot.panes.find((pane) => pane.id === paneId);
    const surface = snapshot.surfaces.find((surface) => surface.id === pane?.surfaceId);
    const item = snapshot.items.find((item) => item.id === surface?.itemId);
    const parent = snapshot.items.find((parent) => parent.id === item?.parentId);
    const tab = snapshot.tabs.find(
      (tab) => tab.id === surface?.activeTabId && tab.surfaceId === surface?.id,
    );
    return (
      item !== undefined &&
      !item.archived &&
      (item.parentId === null ||
        (parent !== undefined &&
          !parent.archived &&
          parent.parentId === null &&
          parent.workspaceId === item.workspaceId &&
          parent.category === item.category)) &&
      pane?.kind === "terminal" &&
      pane.processStatus === status &&
      containsPane(tab?.layout ?? null, paneId)
    );
  }

  function update(patch: Partial<WorkCraftState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  function replaceSnapshot(snapshot: Snapshot): void {
    const current = state.snapshot;
    if (
      current === null ||
      snapshot.epoch !== current.epoch ||
      snapshot.revision > current.revision
    ) {
      update({ snapshot, terminals: snapshotTerminals(snapshot, state.terminals) });
    } else if (snapshot.epoch === current.epoch && snapshot.revision === current.revision) {
      const terminals = snapshotTerminals(snapshot, state.terminals);
      if (terminals !== state.terminals) {
        update({ terminals });
      }
    }
  }

  async function refresh(activeRun?: number): Promise<boolean> {
    const snapshot = await client.snapshot();
    if (activeRun !== undefined && run !== activeRun) {
      return false;
    }
    replaceSnapshot(snapshot);
    return true;
  }

  // Transport orders snapshots within one connection; this queue also rejects obsolete store runs.
  // Equal-revision snapshots can still recover output missed across connections.
  async function applyMessage(message: ServerMessage, activeRun?: number): Promise<void> {
    if (message.type === "terminal.output") {
      if (message.epoch !== state.snapshot?.epoch) {
        return;
      }
      const current = state.terminals.get(message.paneId) ?? {
        epoch: message.epoch,
        history: new Uint8Array(),
        historyCursor: 0,
        chunks: [],
      };
      const lastCursor = current.chunks.at(-1)?.cursor ?? current.historyCursor;
      if (message.cursor <= lastCursor) {
        return;
      }
      const terminals = new Map(state.terminals);
      terminals.set(
        message.paneId,
        appendTerminalChunk(current, message.cursor, decodeBytes(message.data)),
      );
      update({ terminals });
      return;
    }
    if (message.type !== "snapshot") {
      return;
    }
    const current = state.snapshot;
    const next = message.snapshot;
    if (current === null || next.epoch !== current.epoch || next.revision <= current.revision + 1) {
      replaceSnapshot(next);
    } else if (next.revision > current.revision + 1) {
      await refresh(activeRun);
    }
  }

  async function connect(activeRun: number): Promise<void> {
    let stream: StreamConnection | undefined;
    stream = await client.stream({
      onMessage(message) {
        void apply(message, activeRun).catch(() => stream?.close());
      },
      onClose() {
        if (run === activeRun) {
          void reconnect(activeRun);
        }
      },
    });
    if (run !== activeRun) {
      stream.close();
      return;
    }
    update({ status: "connected", stream, connectionError: null });
  }

  async function reconnect(activeRun: number): Promise<void> {
    if (run !== activeRun) {
      return;
    }
    update({ status: "connecting", stream: null });
    for (const delay of retryDelays) {
      await sleep(delay);
      if (run !== activeRun) {
        return;
      }
      try {
        await connect(activeRun);
        return;
      } catch {
        // Continue through the bounded retry sequence.
      }
    }
    if (run !== activeRun) {
      return;
    }
    try {
      await client.ensureDaemon();
      if (run !== activeRun || !(await refresh(activeRun))) {
        return;
      }
      await connect(activeRun);
    } catch (cause) {
      if (run === activeRun) {
        update({
          status: "disconnected",
          stream: null,
          connectionError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  async function establish(activeRun: number, recoverDaemon: boolean): Promise<void> {
    update({ status: "connecting", stream: null });
    try {
      if (recoverDaemon) {
        await client.ensureDaemon();
      }
      if (run !== activeRun || !(await refresh(activeRun))) {
        return;
      }
      await connect(activeRun);
    } catch {
      if (run === activeRun) {
        await reconnect(activeRun);
      }
    }
  }

  async function reload(): Promise<void> {
    const activeRun = ++run;
    const oldStream = state.stream;
    update({ status: "connecting", stream: null });
    oldStream?.close();
    await sleep(0);
    if (run !== activeRun) {
      return;
    }
    await establish(activeRun, false);
  }

  function apply(message: ServerMessage, activeRun?: number): Promise<void> {
    const result = applying.then(() => {
      if (activeRun !== undefined && run !== activeRun) {
        return;
      }
      return applyMessage(message, activeRun);
    });
    applying = result.catch(() => {});
    return result;
  }

  return {
    apply,
    getState: () => state,
    reload,
    snapshot: () => state.snapshot,
    async start() {
      const activeRun = ++run;
      await establish(activeRun, true);
    },
    stop() {
      run += 1;
      state.stream?.close();
      update({ status: "disconnected", stream: null });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

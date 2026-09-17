import {
  createClient,
  decodeBytes,
  type Command,
  type CommandResponse,
  type ServerMessage,
  type Snapshot,
  type StreamConnection,
  type WorkCraftClient,
} from "@work-craft/server/client";
import { useEffect, useSyncExternalStore } from "react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type TerminalBuffer = {
  epoch: string;
  history: Uint8Array;
  historyCursor: number;
  chunks: { cursor: number; data: Uint8Array }[];
};

export type WorkCraftState = {
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  command(command: Command): Promise<CommandResponse>;
  stream: StreamConnection | null;
  terminals: ReadonlyMap<string, TerminalBuffer>;
};

export type WorkCraftStore = {
  apply(message: ServerMessage): Promise<void>;
  getState(): WorkCraftState;
  snapshot(): Snapshot | null;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
};

const RETRY_DELAYS = [100, 250, 500, 1000, 2000] as const;
const MAX_TERMINAL_BYTES = 1024 * 1024;

function snapshotTerminals(
  snapshot: Snapshot,
  current: ReadonlyMap<string, TerminalBuffer>,
): ReadonlyMap<string, TerminalBuffer> {
  const terminals = new Map<string, TerminalBuffer>();
  let changed = current.size !== snapshot.terminalHistories.length;
  for (const history of snapshot.terminalHistories) {
    const previous = current.get(history.paneId);
    let next = previous;
    if (previous?.epoch !== snapshot.epoch) {
      next = {
        epoch: snapshot.epoch,
        history: decodeBytes(history.data),
        historyCursor: history.cursor,
        chunks: [],
      };
    } else {
      const latestCursor = previous.chunks.at(-1)?.cursor ?? previous.historyCursor;
      if (history.cursor > latestCursor) {
        const data = decodeBytes(history.data);
        const missingBytes = history.cursor - latestCursor;
        const retainedStart = history.cursor - Math.min(history.cursor, MAX_TERMINAL_BYTES);
        next =
          latestCursor >= retainedStart && missingBytes <= data.byteLength
            ? appendTerminalChunk(
                previous,
                history.cursor,
                data.slice(data.byteLength - missingBytes),
              )
            : {
                epoch: snapshot.epoch,
                history: data,
                historyCursor: history.cursor,
                chunks: [],
              };
      }
    }
    changed ||= next !== previous;
    terminals.set(history.paneId, next!);
  }
  return changed ? terminals : current;
}

function appendTerminalChunk(
  buffer: TerminalBuffer,
  cursor: number,
  data: Uint8Array,
): TerminalBuffer {
  const chunks = [...buffer.chunks, { cursor, data }];
  let excess =
    chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0) - MAX_TERMINAL_BYTES;
  while (excess > 0) {
    const first = chunks[0]!;
    if (first.data.byteLength <= excess) {
      excess -= first.data.byteLength;
      chunks.shift();
    } else {
      chunks[0] = { ...first, data: first.data.slice(excess) };
      excess = 0;
    }
  }
  return { ...buffer, chunks };
}

export function createWorkCraftStore(client: WorkCraftClient): WorkCraftStore {
  const listeners = new Set<() => void>();
  let run = 0;
  let applying = Promise.resolve();
  let state: WorkCraftState = {
    snapshot: null,
    status: "connecting",
    command: (command) => client.command(command),
    stream: null,
    terminals: new Map(),
  };

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

  async function refresh(): Promise<void> {
    replaceSnapshot(await client.snapshot());
  }

  async function applyMessage(message: ServerMessage): Promise<void> {
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
      await refresh();
    }
  }

  async function connect(activeRun: number): Promise<void> {
    let stream: StreamConnection | undefined;
    stream = await client.stream({
      onMessage(message) {
        void apply(message).catch(() => stream?.close());
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
    update({ status: "connected", stream });
  }

  async function reconnect(activeRun: number): Promise<void> {
    update({ status: "disconnected", stream: null });
    for (const delay of RETRY_DELAYS) {
      await Bun.sleep(delay);
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
      await refresh();
      await connect(activeRun);
    } catch {
      update({ status: "disconnected", stream: null });
    }
  }

  function apply(message: ServerMessage): Promise<void> {
    const result = applying.then(() => applyMessage(message));
    applying = result.catch(() => {});
    return result;
  }

  return {
    apply,
    getState: () => state,
    snapshot: () => state.snapshot,
    async start() {
      const activeRun = ++run;
      update({ status: "connecting", stream: null });
      try {
        await client.ensureDaemon();
        await refresh();
        await connect(activeRun);
      } catch {
        if (run === activeRun) {
          await reconnect(activeRun);
        }
      }
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

const store = createWorkCraftStore(createClient());

export function useWorkCraft(): WorkCraftState {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  useEffect(() => {
    void store.start();
    return () => store.stop();
  }, []);
  return state;
}

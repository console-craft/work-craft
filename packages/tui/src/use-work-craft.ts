import {
  createClient,
  type StreamConnection,
  type WorkCraftClient,
} from "@work-craft/server/client";
import type { Command, CommandResponse, ServerMessage, Snapshot } from "@work-craft/server";
import { useEffect, useSyncExternalStore } from "react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type WorkCraftState = {
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  command(command: Command): Promise<CommandResponse>;
  stream: StreamConnection | null;
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

export function createWorkCraftStore(client: WorkCraftClient): WorkCraftStore {
  const listeners = new Set<() => void>();
  let run = 0;
  let applying = Promise.resolve();
  let state: WorkCraftState = {
    snapshot: null,
    status: "connecting",
    command: (command) => client.command(command),
    stream: null,
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
      snapshot.revision >= current.revision
    ) {
      update({ snapshot });
    }
  }

  async function refresh(): Promise<void> {
    replaceSnapshot(await client.snapshot());
  }

  async function applyMessage(message: ServerMessage): Promise<void> {
    if (message.type !== "snapshot") {
      return;
    }
    const current = state.snapshot;
    const next = message.snapshot;
    if (current === null || next.epoch !== current.epoch) {
      update({ snapshot: next });
    } else if (next.revision === current.revision + 1) {
      update({ snapshot: next });
    } else if (next.revision > current.revision + 1) {
      await refresh();
    }
  }

  async function connect(activeRun: number): Promise<void> {
    const stream = await client.stream({
      onMessage(message) {
        void apply(message).catch(() => {});
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

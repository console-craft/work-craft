import type { Database } from "bun:sqlite";
import { applyCommand } from "./commands.ts";
import { parseCommand } from "./protocol.ts";
import type { Command, CommandResponse, Snapshot } from "./protocol.ts";
import { readSnapshot } from "./snapshot.ts";

export type Health = { epoch: string; revision: number; pid: number };

export type WorkCraftApp = {
  health(): Health;
  snapshot(): Snapshot;
  execute(command: Command): Promise<CommandResponse>;
  subscribe(socket: Bun.ServerWebSocket): void;
  unsubscribe(socket: Bun.ServerWebSocket): void;
};

export function createApp(options: { db: Database }): WorkCraftApp {
  const epoch = crypto.randomUUID();
  const subscribers = new Set<Bun.ServerWebSocket>();
  let revision = 0;

  function snapshot(): Snapshot {
    return readSnapshot(options.db, epoch, revision);
  }

  return {
    health() {
      return { epoch, revision, pid: process.pid };
    },
    snapshot,
    async execute(value) {
      const command = parseCommand(value);
      const { result } = applyCommand(options.db, command);
      if (command.type === "daemon.stop") {
        return { ok: true, revision, result };
      }

      revision += 1;
      const message = JSON.stringify({ type: "snapshot", snapshot: snapshot() });
      for (const socket of subscribers) {
        socket.send(message);
      }
      return { ok: true, revision, result };
    },
    subscribe(socket) {
      subscribers.add(socket);
      socket.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() }));
    },
    unsubscribe(socket) {
      subscribers.delete(socket);
    },
  };
}

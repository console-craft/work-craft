import type { Database } from "bun:sqlite";
import { applyCommand } from "./commands.ts";
import { TerminalHistory } from "./history.ts";
import { decodeBytes, encodeBytes, parseCommand } from "./protocol.ts";
import type {
  ClientMessage,
  Command,
  CommandResponse,
  PaneStatus,
  ServerMessage,
  Snapshot,
} from "./protocol.ts";
import { RuntimeRegistry } from "./runtime.ts";
import { readSnapshot } from "./snapshot.ts";

export type Health = { epoch: string; revision: number; pid: number };

export type WorkCraftApp = {
  health(): Health;
  snapshot(): Snapshot;
  execute(command: Command): Promise<CommandResponse>;
  receive(message: ClientMessage): void;
  subscribe(socket: Bun.ServerWebSocket): void;
  unsubscribe(socket: Bun.ServerWebSocket): void;
  runtime: RuntimeRegistry;
};

export function createApp(options: { db: Database; history?: TerminalHistory }): WorkCraftApp {
  const epoch = crypto.randomUUID();
  const subscribers = new Set<Bun.ServerWebSocket>();
  const history = options.history ?? new TerminalHistory(options.db);
  let revision = 0;

  function snapshot(): Snapshot {
    return readSnapshot(options.db, epoch, revision, history);
  }

  function broadcast(message: ServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const socket of subscribers) {
      socket.send(encoded);
    }
  }

  function onOutput(paneId: string, bytes: Uint8Array): void {
    const cursor = history.append(paneId, bytes);
    broadcast({ type: "terminal.output", epoch, paneId, cursor, data: encodeBytes(bytes) });
  }

  function onStatus(paneId: string, status: PaneStatus, error?: string): void {
    const now = new Date().toISOString();
    const result = options.db.run(
      `UPDATE panes SET
        process_status = ?,
        error_text = ?,
        started_at = CASE WHEN ? = 'starting' THEN ? ELSE started_at END,
        exited_at = CASE WHEN ? IN ('exited', 'interrupted', 'failed') THEN ? WHEN ? = 'starting' THEN NULL ELSE exited_at END
      WHERE id = ?`,
      [status, error ?? null, status, now, status, now, status, paneId],
    );
    if (result.changes !== 1) {
      throw new Error(`Pane not found: ${paneId}`);
    }
    revision += 1;
    broadcast({
      type: "process.status",
      epoch,
      paneId,
      status,
      ...(error === undefined ? {} : { error }),
    });
    broadcast({ type: "snapshot", snapshot: snapshot() });
  }

  const runtime = new RuntimeRegistry({ onOutput, onStatus });

  return {
    runtime,
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
      broadcast({ type: "snapshot", snapshot: snapshot() });
      return { ok: true, revision, result };
    },
    receive(message) {
      if (message.type === "terminal.input") {
        runtime.write(message.paneId, decodeBytes(message.data));
      } else {
        runtime.resize(message.paneId, message.cols, message.rows);
      }
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

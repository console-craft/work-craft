import type { Database } from "bun:sqlite";

import { decodeBytes, encodeBytes, parseCommand, ProtocolError } from "../api/protocol.ts";
import type {
  ClientMessage,
  Command,
  CommandResponse,
  DirectoryData,
  PaneStatus,
  ServerMessage,
  Snapshot,
} from "../api/protocol.ts";
import { validateSplitCwd } from "../terminal/cwd.ts";
import { TerminalHistory } from "../terminal/history.ts";
import { RuntimeRegistry } from "../terminal/runtime.ts";
import { applyCommand } from "./commands.ts";
import { canonicalDirectoryPath, type DirectoryScan, inspectDirectory } from "./directories.ts";
import { isTrustedGroupScan, readItems, reconcileDirectoryScan } from "./items.ts";
import { readSnapshot } from "./snapshot.ts";

export type Health = { epoch: string; revision: number; pid: number };

export type WorkCraftApp = {
  health(): Health;
  snapshot(): Snapshot;
  recover(): Promise<void>;
  startDirectoryRefresh(): void;
  refreshDirectories(): Promise<void>;
  closeDirectoryRefresh(): Promise<void>;
  execute(command: Command): Promise<CommandResponse>;
  receive(message: ClientMessage): void;
  subscribe(socket: Bun.ServerWebSocket): void;
  unsubscribe(socket: Bun.ServerWebSocket): void;
  history: TerminalHistory;
  runtime: RuntimeRegistry;
};

export function createApp(options: {
  db: Database;
  history?: TerminalHistory;
  onStop?: (destroy: boolean) => void;
  inspectDirectory?: typeof inspectDirectory;
}): WorkCraftApp {
  const epoch = crypto.randomUUID();
  const subscribers = new Set<Bun.ServerWebSocket>();
  const history = options.history ?? new TerminalHistory(options.db);
  let revision = 0;
  let recovery: Promise<void> | undefined;
  const directoryAbort = new AbortController();
  const inspections = new Map<string, Promise<DirectoryScan>>();
  let directoryPass: Promise<void> | undefined;
  let directoryTimer: ReturnType<typeof setTimeout> | undefined;
  let directoryRefreshStarted = false;
  let directoryRefreshClosed = false;
  let directoryClose: Promise<void> | undefined;

  function snapshot(): Snapshot {
    return readSnapshot(options.db, epoch, revision, history);
  }

  function broadcast(message: ServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const socket of subscribers) {
      socket.send(encoded);
    }
  }

  function publishChange(changed: boolean): void {
    if (changed) {
      revision += 1;
      broadcast({ type: "snapshot", snapshot: snapshot() });
    }
  }

  function inspectPath(path: string): Promise<DirectoryScan> {
    const pending = inspections.get(path);
    if (pending !== undefined) {
      return pending;
    }
    const inspection = Promise.resolve()
      .then(() => {
        if (directoryRefreshClosed) {
          throw new ProtocolError("Directory discovery is closed");
        }
        return (options.inspectDirectory ?? inspectDirectory)(path, directoryAbort.signal);
      })
      .finally(() => {
        inspections.delete(path);
      });
    inspections.set(path, inspection);
    return inspection;
  }

  function currentDirectory(id: string, workspaceId: string, data: DirectoryData): boolean {
    return (
      options.db
        .query(
          `SELECT 1 FROM items WHERE id = ? AND workspace_id = ? AND kind = 'directory' AND archived = 0
       AND json_extract(data_json, '$.path') = ? AND json_extract(data_json, '$.gitCommonDir') IS ?`,
        )
        .get(id, workspaceId, data.path, data.gitCommonDir) !== null
    );
  }

  async function inspectRemembered(
    data: Pick<DirectoryData, "path" | "availability" | "failureReason">,
  ): Promise<DirectoryScan> {
    try {
      return await inspectPath(data.path);
    } catch (error) {
      return {
        path: data.path,
        available: data.availability === "available",
        ...(data.failureReason === undefined ? {} : { reason: data.failureReason }),
        git: null,
        discoveryError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function refreshDirectoryPass(): Promise<void> {
    const roots = readItems(options.db).filter(
      (item) => item.kind === "directory" && !item.archived,
    );
    for (const root of roots) {
      if (directoryRefreshClosed) {
        return;
      }
      if (root.kind !== "directory" || !currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      let scan = await inspectRemembered(root.data);
      if (directoryRefreshClosed) {
        return;
      }
      if (!currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      if (root.data.isGitCheckout && !isTrustedGroupScan(root.data, scan)) {
        const children = readItems(options.db).filter(
          (item) => item.kind === "worktree" && item.parentId === root.id && !item.archived,
        );
        for (const child of children) {
          if (directoryRefreshClosed) {
            return;
          }
          if (!currentDirectory(root.id, root.workspaceId, root.data)) {
            break;
          }
          if (child.kind !== "worktree") {
            continue;
          }
          const currentChild = () =>
            options.db
              .query(
                `SELECT 1 FROM items WHERE id = ? AND parent_id = ? AND workspace_id = ? AND kind = 'worktree'
             AND archived = 0 AND json_extract(data_json, '$.path') = ?`,
              )
              .get(child.id, root.id, root.workspaceId, child.data.path) !== null;
          if (!currentChild()) {
            continue;
          }
          const fallback = await inspectRemembered(child.data);
          if (directoryRefreshClosed) {
            return;
          }
          if (!currentDirectory(root.id, root.workspaceId, root.data)) {
            break;
          }
          if (
            currentChild() &&
            fallback.path === child.data.path &&
            isTrustedGroupScan(root.data, fallback)
          ) {
            scan = fallback;
            break;
          }
        }
      }
      if (!currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      publishChange(reconcileDirectoryScan(options.db, root.id, scan));
    }
  }

  function refreshDirectories(): Promise<void> {
    if (directoryRefreshClosed) {
      return Promise.resolve();
    }
    directoryPass ??= refreshDirectoryPass().finally(() => {
      directoryPass = undefined;
    });
    return directoryPass;
  }

  function startDirectoryRefresh(): void {
    if (directoryRefreshStarted || directoryRefreshClosed) {
      return;
    }
    directoryRefreshStarted = true;
    function run(): void {
      void refreshDirectories()
        .catch((error) => {
          console.error("Work Craft directory refresh failed:", error);
        })
        .finally(() => {
          if (!directoryRefreshClosed) {
            directoryTimer = setTimeout(run, 5000);
          }
        });
    }
    run();
  }

  function closeDirectoryRefresh(): Promise<void> {
    if (directoryClose !== undefined) {
      return directoryClose;
    }
    directoryRefreshClosed = true;
    clearTimeout(directoryTimer);
    directoryAbort.abort();
    directoryClose = Promise.allSettled([...inspections.values(), directoryPass]).then(() => {});
    return directoryClose;
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

  async function recoverOnce(): Promise<void> {
    const panes = new Map(snapshot().panes.map((pane) => [pane.id, pane]));
    const interrupted = options.db.transaction(() => {
      const rows = options.db
        .query<{ id: string }, []>(
          "SELECT id FROM panes WHERE process_status IN ('running', 'starting', 'interrupted') ORDER BY id",
        )
        .all();
      const update = options.db.query(
        "UPDATE panes SET process_status = 'interrupted', error_text = NULL, exited_at = ? WHERE id = ?",
      );
      const exitedAt = new Date().toISOString();
      for (const { id } of rows) {
        update.run(exitedAt, id);
      }
      return rows;
    })();

    const separator = new TextEncoder().encode(
      "\r\n[work-craft: daemon restarted; shell restored]\r\n",
    );
    for (const { id } of interrupted) {
      history.append(id, separator);
    }
    await history.flush();

    for (const { id } of interrupted) {
      const pane = panes.get(id)!;
      try {
        await runtime.start(pane);
      } catch (cause) {
        const failed = options.db
          .query<{ status: PaneStatus }, [string]>(
            "SELECT process_status AS status FROM panes WHERE id = ?",
          )
          .get(id)?.status;
        if (failed !== "failed") {
          throw cause;
        }
      }
    }
  }

  function recover(): Promise<void> {
    recovery ??= recoverOnce();
    return recovery;
  }

  return {
    history,
    runtime,
    health() {
      return { epoch, revision, pid: process.pid };
    },
    snapshot,
    recover,
    startDirectoryRefresh,
    refreshDirectories,
    closeDirectoryRefresh,
    async execute(value) {
      let command = parseCommand(value);
      if (command.type === "directory.register" && directoryRefreshClosed) {
        throw new ProtocolError("Directory discovery is closed");
      }
      const registration =
        command.type === "directory.register"
          ? await inspectPath(await canonicalDirectoryPath(command.path))
          : undefined;
      if (command.type === "directory.register" && directoryRefreshClosed) {
        throw new ProtocolError("Directory discovery is closed");
      }
      if (registration !== undefined && !registration.available) {
        throw new ProtocolError(
          registration.reason ?? "Directory became unavailable during registration",
        );
      }
      if (command.type === "pane.split") {
        try {
          const cwd =
            command.cwd === undefined
              ? await runtime.currentDirectory(command.paneId)
              : await validateSplitCwd(command.cwd);
          command = { ...command, cwd };
        } catch (cause) {
          throw new ProtocolError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      // Keep the runtime's final identity check adjacent to the synchronous split transaction.
      const { result, effects, changed } = applyCommand(options.db, command, registration);
      if (command.type === "daemon.stop" || command.type === "daemon.destroy") {
        options.onStop?.(command.type === "daemon.destroy");
        return { ok: true, revision, result };
      }

      for (const effect of effects) {
        if (effect.type !== "spawn-pane" || runtime.isLive(effect.paneId)) {
          continue;
        }
        const pane = snapshot().panes.find(({ id }) => id === effect.paneId);
        if (pane === undefined) {
          throw new Error(`Pane not found after commit: ${effect.paneId}`);
        }
        try {
          await runtime.start(pane);
        } catch {
          // RuntimeRegistry has already persisted and broadcast the failed status.
        }
      }

      publishChange(changed);
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

import type { Database } from "bun:sqlite";

import { type CommandOrigin, createConnections } from "../api/connections.ts";
import { encodeBytes, parseCommand, ProtocolError } from "../api/protocol.ts";
import type {
  ClientMessage,
  CommandResponse,
  ControlSnapshot,
  DirectoryData,
  PaneHistoryResponse,
  PaneStatus,
  ServerMessage,
  Snapshot,
} from "../api/protocol.ts";
import { validateSplitCwd } from "../terminal/cwd.ts";
import { TerminalHistory } from "../terminal/history.ts";
import { observeOutput, outputProbeEnabled } from "../terminal/output-probe.ts";
import { RuntimeRegistry } from "../terminal/runtime.ts";
import { applyCommand } from "./commands.ts";
import { canonicalDirectoryPath, type DirectoryScan, inspectDirectory } from "./directories.ts";
import { isTrustedGroupScan, readItems, reconcileDirectoryScan } from "./items.ts";
import { normalizeSessionNavigations, readNavigationCatalog } from "./navigation-store.ts";
import { createTerminalSizing, type GeometryDecision } from "./sizing.ts";
import { readSnapshot, readSnapshotState } from "./snapshot.ts";

export type Health = { epoch: string; revision: number; pid: number };

const MAX_INLINE_SNAPSHOT_BYTES = 512 * 1024;

export type WorkCraftApp = {
  health(): Health;
  snapshot(): Snapshot;
  controlSnapshot(): ControlSnapshot;
  paneHistory(paneId: string, afterCursor?: number): PaneHistoryResponse;
  recover(): Promise<void>;
  startDirectoryRefresh(): void;
  refreshDirectories(): Promise<void>;
  closeDirectoryRefresh(): Promise<void>;
  execute(command: unknown, origin?: CommandOrigin): Promise<CommandResponse>;
  receive(socket: Bun.ServerWebSocket<unknown>, message: ClientMessage): Promise<void>;
  subscribe(socket: Bun.ServerWebSocket<unknown>, options?: { snapshot: "control" | "full" }): void;
  unsubscribe(socket: Bun.ServerWebSocket<unknown>): void;
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
  const subscribers = new Map<Bun.ServerWebSocket<unknown>, "control" | "full">();
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
  const sizing = createTerminalSizing(readSnapshotState(options.db, epoch, revision));

  function controlSnapshot(): ControlSnapshot {
    const state = readSnapshotState(options.db, epoch, revision, sizing.current());
    return {
      ...state,
      terminalStates: state.panes.map(({ id }) => ({
        paneId: id,
        runtimeGeneration: runtime.generation(id),
      })),
    };
  }

  function paneHistory(paneId: string, afterCursor?: number): PaneHistoryResponse {
    const started = outputProbeEnabled ? performance.now() : 0;
    if (afterCursor !== undefined && (!Number.isSafeInteger(afterCursor) || afterCursor < 0)) {
      throw new ProtocolError("History cursor must be a non-negative safe integer");
    }
    if (!options.db.query("SELECT 1 FROM panes WHERE id = ?").get(paneId)) {
      throw new ProtocolError(`Pane not found: ${paneId}`);
    }
    const retained = history.read(paneId, afterCursor);
    if (outputProbeEnabled) {
      observeOutput({
        stage: "pane.history.read",
        paneId,
        cursor: retained.cursor,
        bytes: retained.data.byteLength,
        durationMs: performance.now() - started,
      });
    }
    return {
      epoch,
      paneId,
      runtimeGeneration: runtime.generation(paneId),
      history: { ...retained, data: encodeBytes(retained.data) },
    };
  }

  function snapshot(): Snapshot {
    const started = outputProbeEnabled ? performance.now() : 0;
    const result = readSnapshot(options.db, epoch, revision, history, sizing.current());
    if (outputProbeEnabled) {
      observeOutput({
        stage: "snapshot.read",
        generation: revision,
        durationMs: performance.now() - started,
      });
    }
    return result;
  }

  function broadcast(message: ServerMessage): void {
    const encoded = encodeMessage(message);
    for (const socket of subscribers.keys()) {
      const sent = socket.send(encoded);
      if (outputProbeEnabled) {
        observeOutput({
          stage: "socket.send",
          bytes: Buffer.byteLength(encoded),
          pending: socket.getBufferedAmount(),
          ...(message.type === "terminal.output"
            ? {
                paneId: message.paneId,
                cursor: message.cursor,
                geometrySequence: message.geometrySequence,
              }
            : {}),
          generation: sent,
        });
      }
    }
  }

  function encodeMessage(message: ServerMessage): string {
    const started = outputProbeEnabled ? performance.now() : 0;
    const encoded = JSON.stringify(message);
    if (outputProbeEnabled) {
      observeOutput({
        stage: "message.encode",
        bytes: Buffer.byteLength(encoded),
        durationMs: performance.now() - started,
      });
    }
    // Leave queue room for output and acknowledgments instead of disconnecting on one snapshot.
    if (
      (message.type === "snapshot" || message.type === "control.snapshot") &&
      Buffer.byteLength(encoded) > MAX_INLINE_SNAPSHOT_BYTES
    ) {
      return JSON.stringify({
        type: message.type === "snapshot" ? "snapshot.available" : "control.available",
        epoch: message.snapshot.epoch,
        revision: message.snapshot.revision,
      });
    }
    return encoded;
  }

  function publishChange(changed: boolean): void {
    if (changed) {
      revision += 1;
      connections.reconcile();
      applyGeometry(sizing.reconcile(controlSnapshot()));
      let full: string | undefined;
      let control: string | undefined;
      for (const [socket, mode] of subscribers) {
        if (mode === "control") {
          control ??= encodeMessage({ type: "control.snapshot", snapshot: controlSnapshot() });
          socket.send(control);
        } else {
          full ??= encodeMessage({ type: "snapshot", snapshot: snapshot() });
          socket.send(full);
        }
      }
    }
  }

  function applyGeometry(decision: GeometryDecision): void {
    if (!decision.changed) {
      return;
    }
    const resizes = decision.resizes.flatMap(({ paneId, size }) => {
      const marker = history.recordGrid(paneId, size);
      return marker ? [{ paneId, marker, runtimeGeneration: runtime.generation(paneId) }] : [];
    });
    broadcast({ type: "terminal.geometry", epoch, geometry: decision.geometry, resizes });
    for (const { paneId, size } of decision.resizes) {
      if (runtime.isLive(paneId)) {
        runtime.resize(paneId, size.cols, size.rows);
      }
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
      const changed = options.db.transaction(() => {
        const before = readNavigationCatalog(options.db);
        const changed = reconcileDirectoryScan(options.db, root.id, scan);
        return normalizeSessionNavigations(options.db, before) || changed;
      })();
      publishChange(changed);
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

  function onOutput(paneId: string, bytes: Uint8Array, runtimeGeneration: number): void {
    if (runtime.generation(paneId) !== runtimeGeneration) {
      return;
    }
    const started = outputProbeEnabled ? performance.now() : 0;
    const cursor = history.append(paneId, bytes);
    if (outputProbeEnabled) {
      observeOutput({ stage: "pty.read", paneId, cursor, bytes: bytes.byteLength });
      observeOutput({
        stage: "history.append",
        paneId,
        cursor,
        bytes: bytes.byteLength,
        durationMs: performance.now() - started,
      });
    }
    broadcast({
      type: "terminal.output",
      epoch,
      paneId,
      runtimeGeneration,
      cursor,
      data: encodeBytes(bytes),
      geometrySequence: sizing.current().sequence,
    });
  }

  function onStatus(
    paneId: string,
    status: PaneStatus,
    runtimeGeneration: number,
    error?: string,
  ): void {
    if (runtime.generation(paneId) !== runtimeGeneration) {
      return;
    }
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
    broadcast({
      type: "process.status",
      epoch,
      paneId,
      status,
      runtimeGeneration,
      ...(error === undefined ? {} : { error }),
    });
    publishChange(true);
  }

  const runtime = new RuntimeRegistry({ onOutput, onStatus });
  const connections = createConnections({
    epoch,
    snapshot: () => readSnapshotState(options.db, epoch, revision, sizing.current()),
    execute,
    runtimeGeneration: (paneId) => runtime.generation(paneId),
    onMaterial: (paneId, scrollOffset) => runtime.material(paneId, scrollOffset),
    onSemantic: (paneId, input) => runtime.writeSemantic(paneId, input),
    inputPending: (paneId) => runtime.inputPending(paneId),
    onViewer: (id, report) => applyGeometry(sizing.report(id, report)),
    onAttachActivity: (id) => applyGeometry(sizing.attachmentActivity(id)),
    onActivity: (id, sequence) => applyGeometry(sizing.activity(id, sequence)),
    onDisconnect: (id) => applyGeometry(sizing.remove(id)),
    onInput: (paneId, bytes, source) => {
      if (source === "input" && runtime.isLive(paneId)) {
        runtime.write(paneId, bytes);
      }
    },
  });

  async function recoverOnce(): Promise<void> {
    const panes = new Map(controlSnapshot().panes.map((pane) => [pane.id, pane]));
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
        history.recordGrid(pane.id, { cols: 80, rows: 24 });
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

  async function execute(value: unknown, origin?: CommandOrigin): Promise<CommandResponse> {
    let command = parseCommand(value);
    function validateOrigin(): void {
      if (
        origin &&
        (!connections.isCurrent(origin) ||
          ((command.type === "session.navigate" ||
            command.type === "session.step" ||
            command.type === "session.openItem") &&
            command.sessionId !== origin.sessionId) ||
          ("activation" in command &&
            command.activation !== undefined &&
            command.activation.sessionId !== origin.sessionId))
      ) {
        throw new ProtocolError("Attachment changed before command activation");
      }
    }
    validateOrigin();
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
    validateOrigin();
    const { result, effects, changed } = applyCommand(options.db, command, registration);
    if (
      origin?.sessionId &&
      (command.type === "item.create" ||
        command.type === "directory.register" ||
        command.type === "workspace.create")
    ) {
      // A response may beat its snapshot; follow-up activation needs this exact committed cursor.
      result.navigation = readSnapshotState(
        options.db,
        epoch,
        revision,
        sizing.current(),
      ).navigation.find(({ sessionId }) => sessionId === origin.sessionId);
    }
    if (command.type === "daemon.stop" || command.type === "daemon.destroy") {
      options.onStop?.(command.type === "daemon.destroy");
      return { ok: true, revision, result };
    }

    publishChange(changed);
    const committedRevision = revision;

    for (const effect of effects) {
      if (effect.type !== "spawn-pane" || runtime.isLive(effect.paneId)) {
        continue;
      }
      const pane = controlSnapshot().panes.find(({ id }) => id === effect.paneId);
      if (pane === undefined) {
        throw new Error(`Pane not found after commit: ${effect.paneId}`);
      }
      try {
        const size = sizing.current().panes.find(({ paneId }) => paneId === pane.id)?.size ?? {
          cols: 80,
          rows: 24,
        };
        history.recordGrid(pane.id, size);
        await runtime.start(pane, size);
      } catch {
        // RuntimeRegistry has already persisted and broadcast the failed status.
      }
    }

    return { ok: true, revision: committedRevision, result };
  }

  return {
    history,
    runtime,
    snapshot,
    controlSnapshot,
    paneHistory,
    recover,
    startDirectoryRefresh,
    refreshDirectories,
    closeDirectoryRefresh,
    execute,
    health() {
      return { epoch, revision, pid: process.pid };
    },
    receive: (socket, message) => connections.receive(socket, message),
    subscribe(socket, options) {
      const mode = options?.snapshot ?? "full";
      subscribers.set(socket, mode);
      connections.open(socket);
      socket.send(
        encodeMessage(
          mode === "control"
            ? { type: "control.snapshot", snapshot: controlSnapshot() }
            : { type: "snapshot", snapshot: snapshot() },
        ),
      );
    },
    unsubscribe(socket) {
      subscribers.delete(socket);
      connections.close(socket);
    },
  };
}

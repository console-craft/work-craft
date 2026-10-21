import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";

import { encodeBytes } from "./api/protocol.ts";
import type {
  ClientAttachment,
  Command,
  CommandResponse,
  InputStamp,
  InteractiveMessage,
  ServerMessage,
  Snapshot,
  TerminalInputContext,
  ValidationField,
  ViewerReport,
} from "./api/protocol.ts";
import type { Health } from "./application/app.ts";
import { resolvePaths } from "./daemon/paths.ts";
import { observeOutput, outputProbeEnabled } from "./terminal/output-probe.ts";

export { decodeBytes } from "./api/protocol.ts";
export { projectPaneLayout } from "./application/layout.ts";
export type { PaneRect, PaneGeometry } from "./application/layout.ts";
export type {
  ActivationContext,
  ClientAttachment,
  InputStamp,
  TerminalInputContext,
  InteractiveMessage,
  InteractiveServerMessage,
  TerminalSize,
  TerminalGeometry,
  GridMarker,
  ViewerReport,
  SessionNavigation,
  NavigationTarget,
  NavigationLevel,
  CategoryKind,
  Command,
  CommandResponse,
  LayoutNode,
  ServerMessage,
  Snapshot,
  WorkItem,
  DirectoryData,
  WorktreeData,
  ValidationField,
} from "./api/protocol.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly field?: ValidationField,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Resolve in the calling client, never in the daemon's unrelated cwd. */
export function resolveClientPath(path: string, cwd = process.cwd()): string {
  if (
    path.trim() === "" ||
    path.includes("\0") ||
    (path.startsWith("~") && path !== "~" && !path.startsWith("~/"))
  ) {
    throw new ApiError("Enter a valid path.", "path");
  }
  return resolve(
    cwd,
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
  );
}

export type StreamHandlers = {
  onMessage(message: ServerMessage): void;
  onClose?(error?: Error): void;
};

export type StreamConnection = {
  close(): void;
  attach(sessionId: string | null): Promise<ClientAttachment>;
  command(command: Command, attachmentGeneration: number): Promise<CommandResponse>;
  /** Ephemeral messages are dropped, never replayed, once the transport starts closing. */
  reportViewport(report: ViewerReport | null, stamp: InputStamp): void;
  activity(stamp: InputStamp, sequence: number): void;
  sendInput(paneId: string, bytes: Uint8Array, context: TerminalInputContext): void;
};

export type WorkCraftClient = {
  ensureDaemon(options?: { recover?: boolean }): Promise<void>;
  health(): Promise<Health>;
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<CommandResponse>;
  stream(handlers: StreamHandlers): Promise<StreamConnection>;
  streamOnce(): Promise<ServerMessage>;
};

export const INTERNAL_DAEMON_ARG = "__daemon";
export const INTERNAL_DESTROY_DAEMON_ARG = "__daemon-destroy";
export { resolvePaths };

async function requestJson(socketPath: string, path: string, init?: RequestInit): Promise<unknown> {
  const started = outputProbeEnabled ? performance.now() : 0;
  if (outputProbeEnabled && path === "/snapshot") {
    observeOutput({ stage: "snapshot.fetch.start" });
  }
  const response = await fetch(`http://localhost${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(3_000),
    unix: socketPath,
  });
  const body = await response.json();
  if (outputProbeEnabled && path === "/snapshot") {
    observeOutput({ stage: "snapshot.fetch.end", durationMs: performance.now() - started });
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}`;
    const field =
      typeof body === "object" &&
      body !== null &&
      "field" in body &&
      typeof body.field === "string" &&
      ["name", "title", "path"].includes(body.field)
        ? (body.field as ValidationField)
        : undefined;
    throw field === undefined ? new Error(message) : new ApiError(message, field);
  }
  return body;
}

function healthSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(250, deadline - Date.now())));
}

async function requestHealth(socketPath: string, deadline: number): Promise<Health> {
  return (await requestJson(socketPath, "/health", { signal: healthSignal(deadline) })) as Health;
}

function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function spawnDaemon(recover: boolean): { child: Bun.Subprocess; stderrPath: string } {
  const stderrPath = join(tmpdir(), `work-craft-startup-${crypto.randomUUID()}.log`);
  const stderr = openSync(stderrPath, "wx", 0o600);
  try {
    const daemonArg = recover ? INTERNAL_DAEMON_ARG : INTERNAL_DESTROY_DAEMON_ARG;
    const command = Bun.main.startsWith("/$bunfs/")
      ? [process.execPath, daemonArg]
      : [
          process.execPath,
          fileURLToPath(new URL("./main.ts", import.meta.url)),
          ...(recover ? [] : [daemonArg]),
        ];
    const child = Bun.spawn(command, {
      detached: true,
      env: process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr,
    });
    child.unref();
    return { child, stderrPath };
  } catch (error) {
    rmSync(stderrPath, { force: true });
    throw error;
  } finally {
    closeSync(stderr);
  }
}

export function createClient(options: { socketPath?: string } = {}): WorkCraftClient {
  const socketPath = options.socketPath ?? resolvePaths().socketPath;

  async function ensureDaemon(options: { recover?: boolean } = {}): Promise<void> {
    const deadline = Date.now() + 3_000;
    try {
      await requestHealth(socketPath, deadline);
      return;
    } catch (error) {
      if (!isConnectionFailure(error)) {
        throw error;
      }
    }

    let delay = 20;
    let lastFailure = "daemon did not start";
    while (Date.now() < deadline) {
      const { child, stderrPath } = spawnDaemon(options.recover !== false);
      while (Date.now() < deadline) {
        try {
          const health = await requestHealth(socketPath, deadline);
          if (health.pid !== child.pid && child.exitCode === null) {
            await Promise.race([
              child.exited,
              Bun.sleep(Math.min(20, Math.max(0, deadline - Date.now()))),
            ]);
            if (child.exitCode === null) {
              continue;
            }
          }
          rmSync(stderrPath, { force: true });
          return;
        } catch {
          if (child.exitCode !== null) {
            break;
          }
          await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
          delay = Math.min(delay * 2, 200);
        }
      }
      if (child.exitCode === null && options.recover === false) {
        child.kill("SIGTERM");
        await Promise.race([child.exited, Bun.sleep(500)]);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await child.exited;
        }
      }
      const output = readFileSync(stderrPath, "utf8").trim();
      rmSync(stderrPath, { force: true });
      const status =
        child.exitCode === null ? `PID ${child.pid} is still running` : `exit ${child.exitCode}`;
      lastFailure = `${status}${output === "" ? "" : `: ${output}`}`;
      await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    }

    throw new Error(`Work Craft daemon did not become healthy within 3 seconds (${lastFailure})`);
  }

  function stream(handlers: StreamHandlers): Promise<StreamConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix:${socketPath}:/stream`);
      let opened = false;
      let closeError: Error | undefined;
      let current: Pick<Snapshot, "epoch" | "revision"> | undefined;
      let snapshots = Promise.resolve();
      let queuedMessages = 0;
      let alive = true;
      let requestId = 0;
      const pending = new Map<
        number,
        {
          resolve(value: ClientAttachment | CommandResponse): void;
          reject(error: Error): void;
          timer: Timer;
        }
      >();

      function send(message: InteractiveMessage): boolean {
        if (!alive || socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        socket.send(JSON.stringify(message));
        return true;
      }

      function request(
        message:
          | { type: "client.attach"; sessionId: string | null }
          | { type: "client.command"; command: Command; attachmentGeneration: number },
      ): Promise<ClientAttachment | CommandResponse> {
        if (pending.size >= 128) {
          return Promise.reject(new Error("Too many interactive requests in flight"));
        }
        const id = ++requestId;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("Interactive request timed out"));
          }, 10_000);
          pending.set(id, { resolve, reject, timer });
          try {
            if (!send({ ...message, requestId: id })) {
              throw new Error("Stream is disconnected");
            }
          } catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          }
        });
      }

      function applySnapshot(snapshot: Snapshot): void {
        if (!alive || (current?.epoch === snapshot.epoch && snapshot.revision < current.revision)) {
          return;
        }
        current = { epoch: snapshot.epoch, revision: snapshot.revision };
        handlers.onMessage({ type: "snapshot", snapshot });
      }

      async function handleSnapshot(next: Snapshot): Promise<void> {
        if (
          current === undefined ||
          next.epoch !== current.epoch ||
          next.revision === current.revision + 1
        ) {
          applySnapshot(next);
        } else if (next.revision > current.revision + 1) {
          const epoch = current.epoch;
          const refreshed = (await requestJson(socketPath, "/snapshot")) as Snapshot;
          if (alive && current.epoch === epoch) {
            applySnapshot(refreshed);
          }
        } else if (next.revision === current.revision) {
          applySnapshot(next);
        }
      }

      function closeWith(error: unknown): void {
        closeError = error instanceof Error ? error : new Error(String(error));
        socket.close();
      }

      socket.on("message", (data) => {
        try {
          const received = outputProbeEnabled ? performance.now() : 0;
          const message = JSON.parse(data.toString()) as ServerMessage;
          const metadata =
            outputProbeEnabled && message.type === "terminal.output"
              ? {
                  paneId: message.paneId,
                  cursor: message.cursor,
                  geometrySequence: message.geometrySequence,
                }
              : undefined;
          if (outputProbeEnabled) {
            queuedMessages++;
            observeOutput({
              stage: "socket.receive",
              ...metadata,
              bytes: Array.isArray(data)
                ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0)
                : data.byteLength,
              pending: queuedMessages,
              durationMs: performance.now() - received,
            });
          }
          snapshots = snapshots
            .then(async () => {
              const applied = outputProbeEnabled ? performance.now() : 0;
              if (outputProbeEnabled) {
                observeOutput({
                  stage: "transport.apply.start",
                  ...metadata,
                  pending: queuedMessages,
                  durationMs: applied - received,
                });
              }
              try {
                if (!alive) {
                  return;
                }
                if (message.type === "snapshot.available") {
                  applySnapshot((await requestJson(socketPath, "/snapshot")) as Snapshot);
                  return;
                }
                if (message.type === "snapshot") {
                  await handleSnapshot(message.snapshot);
                  return;
                }
                if (
                  (message.type === "client.attached" && message.requestId !== null) ||
                  message.type === "command.result" ||
                  message.type === "command.error"
                ) {
                  const item = pending.get(message.requestId!);
                  if (item) {
                    pending.delete(message.requestId!);
                    clearTimeout(item.timer);
                    if (message.type === "command.error") {
                      item.reject(new ApiError(message.message, message.field));
                    } else {
                      item.resolve(
                        message.type === "client.attached" ? message.attachment : message.response,
                      );
                    }
                  }
                }
                handlers.onMessage(message);
              } finally {
                if (outputProbeEnabled) {
                  queuedMessages--;
                  observeOutput({
                    stage: "transport.apply.end",
                    ...metadata,
                    pending: queuedMessages,
                    durationMs: performance.now() - applied,
                  });
                }
              }
            })
            .catch(closeWith);
        } catch (error) {
          closeWith(error);
        }
      });
      socket.once("open", () => {
        opened = true;
        resolve({
          close: () => socket.close(),
          attach: (sessionId) =>
            request({ type: "client.attach", sessionId }) as Promise<ClientAttachment>,
          command: (command, attachmentGeneration) =>
            request({
              type: "client.command",
              command,
              attachmentGeneration,
            }) as Promise<CommandResponse>,
          reportViewport: (report, stamp) => send({ type: "client.viewport", report, stamp }),
          activity: (stamp, sequence) => send({ type: "client.activity", stamp, sequence }),
          sendInput: (paneId, bytes, context) =>
            send({ type: "terminal.input", paneId, data: encodeBytes(bytes), context }),
        });
      });
      socket.once("error", (error) => {
        closeError = error;
        if (!opened) {
          reject(error);
        }
      });
      socket.once("close", () => {
        alive = false;
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(closeError ?? new Error("Stream closed during request"));
        }
        pending.clear();
        if (!opened) {
          reject(closeError ?? new Error("WebSocket closed before connecting"));
          return;
        }
        handlers.onClose?.(closeError);
      });
    });
  }

  return {
    ensureDaemon,
    async health() {
      return (await requestJson(socketPath, "/health")) as Health;
    },
    async snapshot() {
      return (await requestJson(socketPath, "/snapshot")) as Snapshot;
    },
    async command(command) {
      return (await requestJson(socketPath, "/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      })) as CommandResponse;
    },
    stream,
    streamOnce() {
      return new Promise((resolve, reject) => {
        let connection: StreamConnection | undefined;
        let received = false;
        void stream({
          onMessage(message) {
            if (message.type !== "snapshot") {
              return;
            }
            received = true;
            connection?.close();
            resolve(message);
          },
          onClose(error) {
            if (!received) {
              reject(error ?? new Error("WebSocket closed before receiving a message"));
            }
          },
        }).then((value) => {
          connection = value;
          if (received) {
            connection.close();
          }
        }, reject);
      });
    },
  };
}

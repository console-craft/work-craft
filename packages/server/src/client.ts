import WebSocket from "ws";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "./paths.ts";
import { encodeBytes } from "./protocol.ts";
import type { Command, CommandResponse, ServerMessage, Snapshot } from "./protocol.ts";
import type { Health } from "./app.ts";

export { decodeBytes } from "./protocol.ts";
export type {
  CategoryKind,
  Command,
  CommandResponse,
  LayoutNode,
  ServerMessage,
  Snapshot,
} from "./protocol.ts";

export type StreamHandlers = {
  onMessage(message: ServerMessage): void;
  onClose?(error?: Error): void;
};

export type StreamConnection = {
  close(): void;
  sendInput(paneId: string, bytes: Uint8Array): void;
  resize(paneId: string, cols: number, rows: number): void;
};

export type WorkCraftClient = {
  ensureDaemon(): Promise<void>;
  health(): Promise<Health>;
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<CommandResponse>;
  stream(handlers: StreamHandlers): Promise<StreamConnection>;
  streamOnce(): Promise<ServerMessage>;
};

async function requestJson(socketPath: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`http://localhost${path}`, { ...init, unix: socketPath });
  const body = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
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

export function createClient(options: { socketPath?: string } = {}): WorkCraftClient {
  const socketPath = options.socketPath ?? resolvePaths().socketPath;

  async function ensureDaemon(): Promise<void> {
    const deadline = Date.now() + 3_000;
    try {
      await requestHealth(socketPath, deadline);
      return;
    } catch (error) {
      if (!isConnectionFailure(error)) {
        throw error;
      }
    }

    const stderrPath = join(tmpdir(), `work-craft-startup-${crypto.randomUUID()}.log`);
    const stderr = openSync(stderrPath, "wx", 0o600);
    let child: Bun.Subprocess;
    try {
      child = Bun.spawn([process.execPath, fileURLToPath(new URL("./main.ts", import.meta.url))], {
        detached: true,
        env: process.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr,
      });
      child.unref();
    } catch (error) {
      rmSync(stderrPath, { force: true });
      throw error;
    } finally {
      closeSync(stderr);
    }

    let delay = 20;
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
        await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
        delay = Math.min(delay * 2, 200);
      }
    }

    const output = readFileSync(stderrPath, "utf8").trim();
    rmSync(stderrPath, { force: true });
    const status =
      child.exitCode === null ? `PID ${child.pid} is still running` : `exit ${child.exitCode}`;
    throw new Error(
      `Work Craft daemon did not become healthy within 3 seconds (${status})${output === "" ? "" : `: ${output}`}`,
    );
  }

  function stream(handlers: StreamHandlers): Promise<StreamConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix:${socketPath}:/stream`);
      let opened = false;
      let closeError: Error | undefined;
      let current: Pick<Snapshot, "epoch" | "revision"> | undefined;
      let snapshots = Promise.resolve();

      function applySnapshot(snapshot: Snapshot): void {
        if (current?.epoch === snapshot.epoch && snapshot.revision <= current.revision) {
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
          applySnapshot((await requestJson(socketPath, "/snapshot")) as Snapshot);
        }
      }

      function closeWith(error: unknown): void {
        closeError = error instanceof Error ? error : new Error(String(error));
        socket.close();
      }

      socket.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString()) as ServerMessage;
          if (message.type !== "snapshot") {
            handlers.onMessage(message);
            return;
          }
          snapshots = snapshots.then(() => handleSnapshot(message.snapshot)).catch(closeWith);
        } catch (error) {
          closeWith(error);
        }
      });
      socket.once("open", () => {
        opened = true;
        resolve({
          close: () => socket.close(),
          sendInput: (paneId, bytes) =>
            socket.send(
              JSON.stringify({ type: "terminal.input", paneId, data: encodeBytes(bytes) }),
            ),
          resize: (paneId, cols, rows) =>
            socket.send(JSON.stringify({ type: "terminal.resize", paneId, cols, rows })),
        });
      });
      socket.once("error", (error) => {
        closeError = error;
        if (!opened) {
          reject(error);
        }
      });
      socket.once("close", () => {
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

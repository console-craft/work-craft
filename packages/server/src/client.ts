import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { assertTerminalProtocol } from "./api/identity";
import type {
  Command,
  CommandResponse,
  ControlSnapshot,
  PaneHistoryResponse,
  ServerMessage,
  Snapshot,
} from "./api/protocol.ts";
import type { Health } from "./application/app.ts";
import { ApiError, requestJson } from "./client/http.ts";
import { ensureDaemon } from "./client/startup.ts";
import { openStream, type StreamConnection, type StreamHandlers } from "./client/stream.ts";
import { resolvePaths } from "./daemon/paths.ts";

export { TERMINAL_PROTOCOL } from "./api/identity";
export { decodeBytes, STREAM_BACKPRESSURE_LIMIT } from "./api/protocol.ts";
export {
  compactFrame,
  createCompactFrameBuilder,
  validateCompactFrame,
} from "./api/terminal-material-codec";
export type {
  CompactMaterialFrame,
  MaterialCell,
  MaterialFrame,
  SemanticTerminalInput,
} from "./api/terminal-material";
export type {
  TerminalMaterialResult,
  TerminalProjectionContext,
  TerminalSemanticContext,
} from "./api/terminal-projection-protocol";
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
  ControlSnapshot,
  PaneHistoryResponse,
  PaneRuntimeIdentity,
  WorkItem,
  DirectoryData,
  WorktreeData,
  ValidationField,
} from "./api/protocol.ts";
export { ApiError } from "./client/http.ts";
export { INTERNAL_DAEMON_ARG, INTERNAL_DESTROY_DAEMON_ARG } from "./client/startup.ts";
export type { StreamConnection, StreamHandlers } from "./client/stream.ts";
export { resolvePaths };

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

export type WorkCraftClient = {
  ensureDaemon(options?: { recover?: boolean }): Promise<void>;
  health(): Promise<Health>;
  snapshot(): Promise<Snapshot>;
  controlSnapshot(): Promise<ControlSnapshot>;
  paneHistory(
    paneId: string,
    afterCursor?: number,
    options?: { signal?: AbortSignal },
  ): Promise<PaneHistoryResponse>;
  command(command: Command): Promise<CommandResponse>;
  stream(
    handlers: StreamHandlers,
    options?: { snapshot: "control" | "full" },
  ): Promise<StreamConnection>;
  streamOnce(): Promise<ServerMessage>;
};

export function createClient(options: { socketPath?: string } = {}): WorkCraftClient {
  const socketPath = options.socketPath ?? resolvePaths().socketPath;
  const stream: WorkCraftClient["stream"] = (handlers, options) =>
    openStream(socketPath, handlers, options);

  return {
    ensureDaemon: (options) => ensureDaemon(socketPath, options),
    async health() {
      const health = (await requestJson(socketPath, "/health")) as Health;
      assertTerminalProtocol(health.protocol);
      return health;
    },
    async snapshot() {
      return (await requestJson(socketPath, "/snapshot")) as Snapshot;
    },
    async controlSnapshot() {
      return (await requestJson(socketPath, "/control")) as ControlSnapshot;
    },
    async paneHistory(paneId, afterCursor, options) {
      const query = afterCursor === undefined ? "" : `?after=${afterCursor}`;
      return (await requestJson(
        socketPath,
        `/panes/${encodeURIComponent(paneId)}/history${query}`,
        {
          signal: options?.signal,
        },
      )) as PaneHistoryResponse;
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

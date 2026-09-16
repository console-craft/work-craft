import WebSocket from "ws";
import { resolvePaths } from "./paths.ts";
import type { Command, CommandResponse, ServerMessage, Snapshot } from "./protocol.ts";
import type { Health } from "./app.ts";

export type StreamHandlers = {
  onMessage(message: ServerMessage): void;
  onClose?(error?: Error): void;
};

export type StreamConnection = {
  close(): void;
};

export type WorkCraftClient = {
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

export function createClient(options: { socketPath?: string } = {}): WorkCraftClient {
  const socketPath = options.socketPath ?? resolvePaths().socketPath;

  function stream(handlers: StreamHandlers): Promise<StreamConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix:${socketPath}:/stream`);
      let opened = false;
      let closeError: Error | undefined;

      socket.on("message", (data) => {
        try {
          handlers.onMessage(JSON.parse(data.toString()) as ServerMessage);
        } catch (error) {
          closeError = error instanceof Error ? error : new Error(String(error));
          socket.close();
        }
      });
      socket.once("open", () => {
        opened = true;
        resolve({ close: () => socket.close() });
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

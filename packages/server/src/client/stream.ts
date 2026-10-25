import WebSocket from "ws";

import { assertTerminalProtocol } from "../api/identity";
import { encodeBytes, STREAM_BACKPRESSURE_LIMIT } from "../api/protocol.ts";
import type {
  ClientAttachment,
  Command,
  CommandResponse,
  ControlSnapshot,
  InputStamp,
  InteractiveMessage,
  ServerMessage,
  Snapshot,
  TerminalInputContext,
  ViewerReport,
} from "../api/protocol.ts";
import type { SemanticTerminalInput } from "../api/terminal-material";
import { validateCompactFrame } from "../api/terminal-material-codec";
import {
  sameTerminalContext,
  type TerminalMaterialResult,
  type TerminalProjectionContext,
  type TerminalProjectionPayload,
  type TerminalSemanticContext,
} from "../api/terminal-projection-protocol";
import { observeOutput, outputProbeEnabled } from "../terminal/output-probe.ts";
import { ApiError, requestJson } from "./http.ts";

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
  requestMaterial(
    paneId: string,
    context: TerminalProjectionContext,
    scrollOffset: number,
    signal?: AbortSignal,
  ): Promise<TerminalMaterialResult>;
  sendSemantic(
    paneId: string,
    input: SemanticTerminalInput,
    context: TerminalSemanticContext,
    signal?: AbortSignal,
  ): Promise<{ forwarded: boolean }>;
};

export function openStream(
  socketPath: string,
  handlers: StreamHandlers,
  options?: { snapshot: "control" | "full" },
): Promise<StreamConnection> {
  return new Promise((resolve, reject) => {
    const control = options?.snapshot === "control";
    const snapshotPath = control ? "/control" : "/snapshot";
    const abort = new AbortController();
    const socket = new WebSocket(`ws+unix:${socketPath}:/stream${control ? "?view=control" : ""}`);
    let opened = false;
    const handshake = setTimeout(
      () => closeWith(new Error("Daemon protocol handshake timed out")),
      3000,
    );
    let closeError: Error | undefined;
    let current: Pick<Snapshot, "epoch" | "revision"> | undefined;
    let snapshots = Promise.resolve();
    let queuedMessages = 0;
    let queuedBytes = 0;
    let alive = true;
    let requestId = 0;
    const pending = new Map<
      number,
      {
        resolve(value: unknown): void;
        reject(error: Error): void;
        cleanup(): void;
      }
    >();

    function send(message: InteractiveMessage): boolean {
      if (!alive || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      const encoded = JSON.stringify(message);
      if (Buffer.byteLength(encoded) > STREAM_BACKPRESSURE_LIMIT) {
        throw new Error("Stream request byte limit");
      }
      socket.send(encoded);
      return true;
    }

    function request(
      message:
        | { type: "client.attach"; sessionId: string | null }
        | { type: "client.command"; command: Command; attachmentGeneration: number }
        | TerminalProjectionPayload,
      signal?: AbortSignal,
    ): Promise<unknown> {
      signal?.throwIfAborted();
      if (pending.size >= 128) {
        return Promise.reject(new Error("Too many interactive requests in flight"));
      }
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        function cleanup(): void {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
        }
        function cancel(): void {
          pending.delete(id);
          cleanup();
          reject(signal?.reason ?? new Error("Request aborted"));
        }
        const timer = setTimeout(() => {
          pending.delete(id);
          cleanup();
          reject(new Error("Interactive request timed out"));
        }, 10_000);
        pending.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          if (!send({ ...message, requestId: id })) {
            throw new Error("Stream is disconnected");
          }
        } catch (error) {
          cleanup();
          pending.delete(id);
          reject(error);
        }
      });
    }

    async function requestMaterial(
      paneId: string,
      context: TerminalProjectionContext,
      scrollOffset: number,
      signal?: AbortSignal,
    ): Promise<TerminalMaterialResult> {
      const captured = { ...context };
      const material = (await request(
        { type: "terminal.material", paneId, context: captured, scrollOffset },
        signal,
      )) as TerminalMaterialResult;
      if (
        !material ||
        material.paneId !== paneId ||
        !material.context ||
        !sameTerminalContext(material.context, captured) ||
        !Number.isSafeInteger(material.sequence) ||
        material.sequence < 0
      ) {
        throw new Error("Material response scope mismatch");
      }
      validateCompactFrame(material.frame);
      return material;
    }

    async function sendSemantic(
      paneId: string,
      input: SemanticTerminalInput,
      context: TerminalSemanticContext,
      signal?: AbortSignal,
    ): Promise<{ forwarded: boolean }> {
      const captured = { ...context };
      if (input.kind !== "paste") {
        return (await request(
          { type: "terminal.semantic", paneId, context: captured, input },
          signal,
        )) as { forwarded: boolean };
      }
      if (
        input.bytes.length + 128 > STREAM_BACKPRESSURE_LIMIT ||
        !input.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ) {
        throw new Error("Invalid paste byte limit or value");
      }
      const bytes = Uint8Array.from(input.bytes);
      const id = crypto.randomUUID();
      try {
        await request(
          {
            type: "terminal.paste",
            paneId,
            context: captured,
            transfer: { id, operation: "begin", total: bytes.length },
          },
          signal,
        );
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          const data = Buffer.from(bytes.subarray(offset, offset + 65536)).toString("base64");
          await request(
            {
              type: "terminal.paste",
              paneId,
              context: captured,
              transfer: { id, operation: "chunk", offset, data },
            },
            signal,
          );
        }
        return (await request(
          {
            type: "terminal.paste",
            paneId,
            context: captured,
            transfer: { id, operation: "commit" },
          },
          signal,
        )) as { forwarded: boolean };
      } catch (error) {
        await request(
          {
            type: "terminal.paste",
            paneId,
            context: captured,
            transfer: { id, operation: "cancel" },
          },
          AbortSignal.timeout(250),
        ).catch(() => {});
        throw error;
      }
    }

    function applySnapshot(snapshot: Snapshot | ControlSnapshot): void {
      if (!alive || (current?.epoch === snapshot.epoch && snapshot.revision < current.revision)) {
        return;
      }
      current = { epoch: snapshot.epoch, revision: snapshot.revision };
      handlers.onMessage(
        "terminalHistories" in snapshot
          ? { type: "snapshot", snapshot }
          : { type: "control.snapshot", snapshot },
      );
    }

    async function handleSnapshot(next: Snapshot | ControlSnapshot): Promise<void> {
      if (
        current === undefined ||
        next.epoch !== current.epoch ||
        next.revision === current.revision + 1
      ) {
        applySnapshot(next);
      } else if (next.revision > current.revision + 1) {
        const epoch = current.epoch;
        const refreshed = (await requestJson(socketPath, snapshotPath, {
          signal: abort.signal,
        })) as Snapshot | ControlSnapshot;
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
        if (Buffer.byteLength(data.toString()) > STREAM_BACKPRESSURE_LIMIT) {
          throw new Error("Stream response byte limit");
        }
        const message = JSON.parse(data.toString()) as ServerMessage;
        if (!opened) {
          if (message.type !== "client.ready") {
            throw new Error("Incompatible daemon: missing protocol handshake");
          }
          assertTerminalProtocol(message.protocol);
          clearTimeout(handshake);
          acceptConnection();
          return;
        }
        if (
          message.type === "terminal.material.result" ||
          message.type === "terminal.input.result" ||
          message.type === "terminal.error"
        ) {
          const item = pending.get(message.requestId);
          if (!item) {
            return;
          }
          pending.delete(message.requestId);
          item.cleanup();
          if (message.type === "terminal.error") {
            item.reject(new ApiError(message.message.slice(0, 256)));
          } else if (message.type === "terminal.material.result") {
            item.resolve(message.material);
          } else if (typeof message.forwarded === "boolean") {
            item.resolve({ forwarded: message.forwarded });
          } else {
            item.reject(new Error("Invalid semantic acknowledgement"));
          }
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
            item.cleanup();
            if (message.type === "command.error") {
              item.reject(new ApiError(message.message, message.field));
            } else {
              item.resolve(
                message.type === "client.attached" ? message.attachment : message.response,
              );
            }
          }
        }
        const bytes = Buffer.byteLength(data.toString());
        queuedBytes += bytes;
        if (queuedBytes > STREAM_BACKPRESSURE_LIMIT) {
          throw new Error("Stream pending work exceeded its byte limit");
        }
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
              if (message.type === "snapshot.available" || message.type === "control.available") {
                applySnapshot(
                  (await requestJson(socketPath, snapshotPath, { signal: abort.signal })) as
                    | Snapshot
                    | ControlSnapshot,
                );
                return;
              }
              if (message.type === "snapshot" || message.type === "control.snapshot") {
                await handleSnapshot(message.snapshot);
                return;
              }
              handlers.onMessage(message);
            } finally {
              queuedBytes -= bytes;
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
    function acceptConnection(): void {
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
        requestMaterial,
        sendSemantic,
      });
    }
    // Bun's ws error dispatch needs the listener to remain registered through close.
    socket.on("error", (error) => {
      closeError = error;
      if (!opened) {
        reject(error);
      }
    });
    socket.once("close", () => {
      clearTimeout(handshake);
      alive = false;
      abort.abort();
      for (const item of pending.values()) {
        item.cleanup();
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

import { projectPaneLayout } from "../application/layout.ts";
import type { NavigationCatalog } from "../application/navigation.ts";
import { TERMINAL_PROTOCOL } from "./identity";
import { parseInteractiveMessage } from "./interactive-protocol.ts";
import { STREAM_BACKPRESSURE_LIMIT } from "./protocol";
import {
  type ClientAttachment,
  type CommandResponse,
  decodeBytes,
  type InputStamp,
  type InteractiveServerMessage,
  ProtocolError,
  type SessionNavigation,
  type Snapshot,
  type TerminalGeometry,
  type TerminalInputContext,
  type ViewerReport,
} from "./protocol.ts";
import type { CompactMaterialFrame, SemanticTerminalInput } from "./terminal-material";
import { createPasteReceiver } from "./terminal-paste";
import type { TerminalProjectionRequest } from "./terminal-projection-protocol";
import type { TerminalProjectionContext } from "./terminal-projection-protocol";

export type InteractiveSnapshot = Omit<NavigationCatalog, "panes"> &
  Pick<Snapshot, "epoch" | "revision" | "panes"> & {
    navigation: SessionNavigation[];
    geometry: TerminalGeometry;
  };
export type CommandOrigin = {
  connectionId: string;
  attachmentGeneration: number;
  sessionId: string | null;
};
export type ConnectionRegistry = {
  open(socket: Bun.ServerWebSocket<unknown>): string;
  close(socket: Bun.ServerWebSocket<unknown>): void;
  receive(socket: Bun.ServerWebSocket<unknown>, value: unknown): Promise<void>;
  reconcile(): void;
  attachment(socket: Bun.ServerWebSocket<unknown>): ClientAttachment | null;
  isCurrent(origin: CommandOrigin): boolean;
};
type Connection = {
  attachment: ClientAttachment;
  lastRequestId: number;
  requests: Set<number>;
  report: ViewerReport | null;
  paste: ReturnType<typeof createPasteReceiver>;
};
type ConnectionOptions = {
  epoch: string;
  snapshot(): InteractiveSnapshot;
  runtimeGeneration?(paneId: string): number;
  execute(command: unknown, origin: CommandOrigin): Promise<CommandResponse>;
  onViewer(connectionId: string, report: ViewerReport | null): void;
  onAttachActivity(connectionId: string): void;
  onActivity(connectionId: string, sequence: number): void;
  onDisconnect(connectionId: string): void;
  onInput(paneId: string, bytes: Uint8Array, source: "input" | "response"): void;
  onMaterial?(
    paneId: string,
    scrollOffset: number,
    isCurrent: () => boolean,
  ):
    | { sequence: number; frame: CompactMaterialFrame }
    | Promise<{ sequence: number; frame: CompactMaterialFrame }>;
  onSemantic?(paneId: string, input: SemanticTerminalInput | Uint8Array): Promise<boolean>;
  inputPending?(paneId: string): boolean;
};

function send(socket: Bun.ServerWebSocket<unknown>, message: InteractiveServerMessage): void {
  socket.send(JSON.stringify(message));
}

function context(
  snapshot: InteractiveSnapshot,
  connection: Connection,
  stamp: InputStamp,
): SessionNavigation | undefined {
  const navigation = snapshot.navigation.find(
    ({ sessionId }) => sessionId === connection.attachment.sessionId,
  );
  return snapshot.epoch === stamp.epoch &&
    connection.attachment.generation === stamp.attachmentGeneration &&
    navigation?.generation === stamp.navigationGeneration
    ? navigation
    : undefined;
}

function validPane(
  snapshot: InteractiveSnapshot,
  navigation: SessionNavigation,
  paneId: string,
  requireRunning = true,
): boolean {
  const pane = snapshot.panes.find(({ id }) => id === paneId);
  const tab = snapshot.tabs.find(({ id }) => id === navigation.tabId);
  const surface = snapshot.surfaces.find(({ id }) => id === tab?.surfaceId);
  const item = snapshot.items.find(({ id }) => id === surface?.itemId);
  const parent = snapshot.items.find(({ id }) => id === item?.parentId);
  return (
    pane?.kind === "terminal" &&
    (!requireRunning || pane.processStatus === "running") &&
    pane.surfaceId === surface?.id &&
    item !== undefined &&
    item.id === navigation.itemId &&
    item.workspaceId === navigation.workspaceId &&
    item.category === navigation.category &&
    !item.archived &&
    (item.parentId === null ||
      (parent !== undefined &&
        !parent.archived &&
        parent.parentId === null &&
        parent.workspaceId === item.workspaceId &&
        parent.category === item.category)) &&
    snapshot.sessionWorkspaces.some(
      (entry) => entry.sessionId === navigation.sessionId && entry.workspaceId === item.workspaceId,
    ) &&
    projectPaneLayout(tab?.layout ?? null, { x: 0, y: 0, width: 0, height: 0 }).panes.filter(
      (entry) => entry.paneId === paneId,
    ).length === 1
  );
}

/** Socket identity is ephemeral; every input decision reads the current authoritative cursor. */
export function createConnections(options: ConnectionOptions): ConnectionRegistry {
  const connections = new Map<Bun.ServerWebSocket<unknown>, Connection>();

  function close(socket: Bun.ServerWebSocket<unknown>): void {
    const connection = connections.get(socket);
    if (connection) {
      connection.paste.clear();
      connections.delete(socket);
      options.onDisconnect(connection.attachment.connectionId);
    }
  }

  function withdraw(connection: Connection): void {
    connection.paste.clear();
    connection.report = null;
    options.onViewer(connection.attachment.connectionId, null);
  }

  function eligible(
    snapshot: InteractiveSnapshot,
    connection: Connection,
    navigation: SessionNavigation,
    paneId: string,
  ): boolean {
    const report = connection.report;
    const layout = snapshot.tabs.find(({ id }) => id === navigation.tabId)?.layout ?? null;
    const rect =
      report &&
      projectPaneLayout(layout, {
        x: 0,
        y: 0,
        width: report.canvas.cols,
        height: report.canvas.rows,
      }).panes.find((pane) => pane.paneId === paneId)?.rect;
    return (
      paneId === navigation.paneId &&
      report?.eligible === true &&
      report.tabId === navigation.tabId &&
      report.canvas.cols >= 60 &&
      report.canvas.rows >= 6 &&
      !!rect &&
      rect.width >= 20 &&
      rect.height - 1 >= 5
    );
  }

  function projectionScope(
    connection: Connection,
    paneId: string,
    stamp: TerminalProjectionContext,
    requireRunning: boolean,
  ): { snapshot: InteractiveSnapshot; navigation: SessionNavigation } {
    const snapshot = options.snapshot();
    const navigation = context(snapshot, connection, stamp);
    const tab = snapshot.geometry.tabs.find((entry) => entry.tabId === navigation?.tabId);
    if (
      !navigation ||
      tab?.generation !== stamp.geometrySequence ||
      stamp.runtimeGeneration !== options.runtimeGeneration?.(paneId) ||
      !validPane(snapshot, navigation, paneId, requireRunning)
    ) {
      throw new ProtocolError("Stale or unauthorized terminal scope");
    }
    return { snapshot, navigation };
  }

  function clearObsoletePaste(connection: Connection): void {
    const stamp = connection.paste.stamp;
    if (!stamp) {
      return;
    }
    try {
      const scope = projectionScope(connection, stamp.paneId, stamp, true);
      if (!eligible(scope.snapshot, connection, scope.navigation, stamp.paneId)) {
        connection.paste.clear();
      }
    } catch {
      connection.paste.clear();
    }
  }

  function receivePaste(
    connection: Connection,
    message: Extract<TerminalProjectionRequest, { type: "terminal.paste" }>,
  ): Uint8Array | null {
    const { transfer } = message;
    const stamp = { ...message.context, paneId: message.paneId };
    switch (transfer.operation) {
      case "begin":
        return connection.paste.accept(
          { type: "paste.begin", id: transfer.id, total: transfer.total, stamp },
          stamp,
        );
      case "chunk":
        return connection.paste.accept(
          {
            type: "paste.chunk",
            id: transfer.id,
            offset: transfer.offset,
            data: transfer.data,
            stamp,
          },
          stamp,
        );
      case "commit":
      case "cancel":
        return connection.paste.accept(
          {
            type: transfer.operation === "commit" ? "paste.commit" : "paste.cancel",
            id: transfer.id,
            stamp,
          },
          stamp,
        );
    }
  }

  async function projection(
    socket: Bun.ServerWebSocket<unknown>,
    connection: Connection,
    message: TerminalProjectionRequest,
  ): Promise<void> {
    if (message.type === "terminal.paste" && message.transfer.operation === "cancel") {
      receivePaste(connection, message);
      send(socket, {
        type: "terminal.input.result",
        requestId: message.requestId,
        forwarded: false,
      });
      return;
    }
    clearObsoletePaste(connection);
    const { snapshot, navigation } = projectionScope(
      connection,
      message.paneId,
      message.context,
      message.type !== "terminal.material",
    );
    let reply: InteractiveServerMessage;
    if (message.type === "terminal.material") {
      if (!options.onMaterial) {
        throw new ProtocolError("Terminal material is unavailable");
      }
      const isCurrent = (): boolean => {
        if (connections.get(socket) !== connection) {
          return false;
        }
        try {
          const scope = projectionScope(connection, message.paneId, message.context, false);
          const status = scope.snapshot.panes.find(
            ({ id }) => id === message.paneId,
          )?.processStatus;
          return (
            status === "running" ||
            status === "exited" ||
            status === "failed" ||
            status === "interrupted"
          );
        } catch {
          return false;
        }
      };
      if (!isCurrent()) {
        throw new ProtocolError("Stale or starting terminal material scope");
      }
      const material = await options.onMaterial(message.paneId, message.scrollOffset, isCurrent);
      if (!isCurrent()) {
        throw new ProtocolError("Terminal material scope changed during read");
      }
      reply = {
        type: "terminal.material.result",
        requestId: message.requestId,
        material: {
          paneId: message.paneId,
          context: message.context,
          ...material,
        },
      };
    } else {
      if (!eligible(snapshot, connection, navigation, message.paneId)) {
        throw new ProtocolError("Terminal is not eligible for input");
      }
      if (!options.onSemantic) {
        throw new ProtocolError("Semantic input is unavailable");
      }
      if (options.inputPending?.(message.paneId)) {
        throw new ProtocolError("Terminal input in flight");
      }
      if (message.type === "terminal.semantic" && connection.paste.bytes) {
        throw new ProtocolError("Paste pending; input cannot overtake it");
      }
      const input =
        message.type === "terminal.paste" ? receivePaste(connection, message) : message.input;
      let forwarded = false;
      if (input) {
        // Elect only for complete input; a paste must not invalidate its own assembly stamps.
        if (message.context.kind !== "focus" && message.context.activitySequence !== undefined) {
          options.onActivity(connection.attachment.connectionId, message.context.activitySequence);
          for (const entry of connections.values()) {
            clearObsoletePaste(entry);
          }
        }
        const current = options.snapshot();
        const selected = context(current, connection, message.context);
        // Our synchronous sizing election may change geometry, never the other input authority.
        if (
          !selected ||
          message.context.runtimeGeneration !== options.runtimeGeneration?.(message.paneId) ||
          !validPane(current, selected, message.paneId) ||
          !eligible(current, connection, selected, message.paneId)
        ) {
          throw new ProtocolError("Terminal input scope changed during activity");
        }
        const previousSize = snapshot.geometry.panes.find(
          ({ paneId }) => paneId === message.paneId,
        )?.size;
        const currentSize = current.geometry.panes.find(
          ({ paneId }) => paneId === message.paneId,
        )?.size;
        if (
          message.context.kind !== "mouse" ||
          (previousSize?.cols === currentSize?.cols && previousSize?.rows === currentSize?.rows)
        ) {
          forwarded = await options.onSemantic(message.paneId, input);
        }
      }
      reply = { type: "terminal.input.result", requestId: message.requestId, forwarded };
    }
    if (connections.get(socket) !== connection) {
      return;
    }
    const encoded = JSON.stringify(reply);
    if (Buffer.byteLength(encoded) > STREAM_BACKPRESSURE_LIMIT) {
      throw new ProtocolError("Projection frame envelope byte limit");
    }
    socket.send(encoded);
  }

  function input(
    connection: Connection,
    paneId: string,
    data: string,
    stamp: TerminalInputContext,
  ): void {
    if (stamp.source === "input" && (connection.paste.bytes || options.inputPending?.(paneId))) {
      return;
    }
    const snapshot = options.snapshot();
    const navigation = context(snapshot, connection, stamp);
    const tab = snapshot.geometry.tabs.find(({ tabId }) => tabId === navigation?.tabId);
    if (
      !navigation ||
      (stamp.runtimeGeneration !== undefined &&
        stamp.runtimeGeneration !== options.runtimeGeneration?.(paneId)) ||
      tab?.generation !== stamp.geometrySequence ||
      !validPane(snapshot, navigation, paneId)
    ) {
      return;
    }
    const id = connection.attachment.connectionId;
    if (stamp.source === "response") {
      if (tab.ownerConnectionId === id) {
        options.onInput(paneId, decodeBytes(data), "response");
      }
      return;
    }
    if (!eligible(snapshot, connection, navigation, paneId)) {
      return;
    }
    const previousSize = snapshot.geometry.panes.find((pane) => pane.paneId === paneId)?.size;
    if (stamp.kind !== "focus" && stamp.activitySequence !== undefined) {
      options.onActivity(id, stamp.activitySequence);
    }
    const current = options.snapshot();
    const currentSize = current.geometry.panes.find((pane) => pane.paneId === paneId)?.size;
    if (
      stamp.kind === "mouse" &&
      (previousSize?.cols !== currentSize?.cols || previousSize?.rows !== currentSize?.rows)
    ) {
      return;
    }
    if (context(current, connection, stamp) && validPane(current, navigation, paneId)) {
      options.onInput(paneId, decodeBytes(data), "input");
    }
  }

  return {
    open(socket) {
      const connectionId = crypto.randomUUID();
      connections.set(socket, {
        attachment: { connectionId, generation: 0, sessionId: null },
        lastRequestId: 0,
        requests: new Set(),
        report: null,
        paste: createPasteReceiver(),
      });
      send(socket, {
        type: "client.ready",
        epoch: options.epoch,
        connectionId,
        protocol: TERMINAL_PROTOCOL,
      });
      return connectionId;
    },
    close,
    attachment(socket) {
      const value = connections.get(socket)?.attachment;
      return value ? { ...value } : null;
    },
    isCurrent(origin) {
      return [...connections.values()].some(
        ({ attachment }) =>
          attachment.connectionId === origin.connectionId &&
          attachment.generation === origin.attachmentGeneration &&
          attachment.sessionId === origin.sessionId,
      );
    },
    reconcile() {
      const snapshot = options.snapshot();
      for (const [socket, connection] of connections) {
        clearObsoletePaste(connection);
        const sessionId = connection.attachment.sessionId;
        if (sessionId !== null && !snapshot.sessions.some(({ id }) => id === sessionId)) {
          withdraw(connection);
          connection.attachment = {
            ...connection.attachment,
            sessionId: null,
            generation: connection.attachment.generation + 1,
          };
          send(socket, {
            type: "client.attached",
            requestId: null,
            attachment: connection.attachment,
          });
        } else if (
          connection.report &&
          snapshot.navigation.find((entry) => entry.sessionId === sessionId)?.tabId !==
            connection.report.tabId
        ) {
          withdraw(connection);
        }
      }
    },
    async receive(socket, value) {
      const connection = connections.get(socket);
      if (!connection) {
        return;
      }
      try {
        const message = parseInteractiveMessage(value);
        if (
          message.type === "client.attach" ||
          message.type === "client.command" ||
          message.type === "terminal.material" ||
          message.type === "terminal.semantic" ||
          message.type === "terminal.paste"
        ) {
          if (message.requestId <= connection.lastRequestId) {
            throw new ProtocolError("interactive request IDs must increase");
          }
          connection.lastRequestId = message.requestId;
          if (connection.requests.size >= 128) {
            send(socket, {
              type:
                message.type === "client.attach" || message.type === "client.command"
                  ? "command.error"
                  : "terminal.error",
              requestId: message.requestId,
              message: "Too many interactive requests in flight",
            });
            return;
          }
          connection.requests.add(message.requestId);
          try {
            if (
              message.type === "terminal.material" ||
              message.type === "terminal.semantic" ||
              message.type === "terminal.paste"
            ) {
              await projection(socket, connection, message);
            } else if (message.type === "client.attach") {
              if (
                message.sessionId !== null &&
                !options.snapshot().sessions.some(({ id }) => id === message.sessionId)
              ) {
                throw new ProtocolError("session not found");
              }
              if (connection.attachment.sessionId !== message.sessionId) {
                withdraw(connection);
                connection.attachment = {
                  ...connection.attachment,
                  generation: connection.attachment.generation + 1,
                  sessionId: message.sessionId,
                };
                if (message.sessionId !== null) {
                  options.onAttachActivity(connection.attachment.connectionId);
                }
              }
              send(socket, {
                type: "client.attached",
                requestId: message.requestId,
                attachment: connection.attachment,
              });
            } else {
              if (message.attachmentGeneration !== connection.attachment.generation) {
                throw new ProtocolError("Attachment changed before command");
              }
              const origin = {
                connectionId: connection.attachment.connectionId,
                attachmentGeneration: connection.attachment.generation,
                sessionId: connection.attachment.sessionId,
              };
              const response = await options.execute(message.command, origin);
              if (connections.get(socket) === connection) {
                send(socket, { type: "command.result", requestId: message.requestId, response });
              }
            }
          } catch (error) {
            if (connections.get(socket) === connection) {
              if (
                message.type === "terminal.material" ||
                message.type === "terminal.semantic" ||
                message.type === "terminal.paste"
              ) {
                send(socket, {
                  type: "terminal.error",
                  requestId: message.requestId,
                  message: (error instanceof Error
                    ? error.message
                    : "Terminal request failed"
                  ).slice(0, 256),
                });
              } else {
                send(socket, {
                  type: "command.error",
                  requestId: message.requestId,
                  message: error instanceof ProtocolError ? error.message : "Internal server error",
                  ...(error instanceof ProtocolError && error.field ? { field: error.field } : {}),
                });
              }
            }
          } finally {
            connection.requests.delete(message.requestId);
          }
          return;
        }
        const snapshot = options.snapshot();
        if (message.type === "terminal.input") {
          input(connection, message.paneId, message.data, message.context);
          return;
        }
        const navigation = context(snapshot, connection, message.stamp);
        if (!navigation) {
          return;
        }
        if (message.type === "client.viewport") {
          const report = message.report;
          if (report === null) {
            withdraw(connection);
          } else if (
            report.epoch === snapshot.epoch &&
            report.attachmentGeneration === connection.attachment.generation &&
            report.navigationGeneration === navigation.generation &&
            report.tabId === navigation.tabId
          ) {
            connection.report = report;
            options.onViewer(connection.attachment.connectionId, report);
          }
        } else if (connection.report?.eligible && connection.report.tabId === navigation.tabId) {
          options.onActivity(connection.attachment.connectionId, message.sequence);
        }
        for (const entry of connections.values()) {
          clearObsoletePaste(entry);
        }
      } catch {
        close(socket);
        socket.close(1008, "invalid interactive message");
      }
    },
  };
}

import { projectPaneLayout } from "../application/layout.ts";
import type { NavigationCatalog } from "../application/navigation.ts";
import { parseInteractiveMessage } from "./interactive-protocol.ts";
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
  open(socket: Bun.ServerWebSocket): string;
  close(socket: Bun.ServerWebSocket): void;
  receive(socket: Bun.ServerWebSocket, value: unknown): Promise<void>;
  reconcile(): void;
  attachment(socket: Bun.ServerWebSocket): ClientAttachment | null;
  isCurrent(origin: CommandOrigin): boolean;
};
type Connection = {
  attachment: ClientAttachment;
  lastRequestId: number;
  requests: Set<number>;
  report: ViewerReport | null;
};
type ConnectionOptions = {
  epoch: string;
  snapshot(): InteractiveSnapshot;
  execute(command: unknown, origin: CommandOrigin): Promise<CommandResponse>;
  onViewer(connectionId: string, report: ViewerReport | null): void;
  onAttachActivity(connectionId: string): void;
  onActivity(connectionId: string, sequence: number): void;
  onDisconnect(connectionId: string): void;
  onInput(paneId: string, bytes: Uint8Array, source: "input" | "response"): void;
};

function send(socket: Bun.ServerWebSocket, message: InteractiveServerMessage): void {
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
): boolean {
  const pane = snapshot.panes.find(({ id }) => id === paneId);
  const tab = snapshot.tabs.find(({ id }) => id === navigation.tabId);
  const surface = snapshot.surfaces.find(({ id }) => id === tab?.surfaceId);
  const item = snapshot.items.find(({ id }) => id === surface?.itemId);
  const parent = snapshot.items.find(({ id }) => id === item?.parentId);
  return (
    pane?.kind === "terminal" &&
    pane.processStatus === "running" &&
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
  const connections = new Map<Bun.ServerWebSocket, Connection>();

  function close(socket: Bun.ServerWebSocket): void {
    const connection = connections.get(socket);
    if (connection) {
      connections.delete(socket);
      options.onDisconnect(connection.attachment.connectionId);
    }
  }

  function withdraw(connection: Connection): void {
    connection.report = null;
    options.onViewer(connection.attachment.connectionId, null);
  }

  function input(
    connection: Connection,
    paneId: string,
    data: string,
    stamp: TerminalInputContext,
  ): void {
    const snapshot = options.snapshot();
    const navigation = context(snapshot, connection, stamp);
    const tab = snapshot.geometry.tabs.find(({ tabId }) => tabId === navigation?.tabId);
    if (
      !navigation ||
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
    if (
      paneId !== navigation.paneId ||
      !report?.eligible ||
      report.tabId !== navigation.tabId ||
      report.canvas.cols < 60 ||
      report.canvas.rows < 6 ||
      !rect ||
      rect.width < 20 ||
      rect.height - 1 < 5
    ) {
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
      });
      send(socket, { type: "client.ready", epoch: options.epoch, connectionId });
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
        if (message.type === "client.attach" || message.type === "client.command") {
          if (message.requestId <= connection.lastRequestId) {
            throw new ProtocolError("interactive request IDs must increase");
          }
          connection.lastRequestId = message.requestId;
          if (connection.requests.size >= 128) {
            send(socket, {
              type: "command.error",
              requestId: message.requestId,
              message: "Too many interactive requests in flight",
            });
            return;
          }
          connection.requests.add(message.requestId);
          try {
            if (message.type === "client.attach") {
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
              send(socket, {
                type: "command.error",
                requestId: message.requestId,
                message: error instanceof ProtocolError ? error.message : "Internal server error",
                ...(error instanceof ProtocolError && error.field ? { field: error.field } : {}),
              });
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
      } catch {
        close(socket);
        socket.close(1008, "invalid interactive message");
      }
    },
  };
}

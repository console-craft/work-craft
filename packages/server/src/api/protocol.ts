export type CategoryKind =
  | "inbox"
  | "today"
  | "design"
  | "implementation"
  | "collaboration"
  | "operations";

export type PaneStatus = "starting" | "running" | "exited" | "interrupted" | "failed";

export type LayoutNode =
  | { type: "pane"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

export type ShellRestorePolicy = { type: "shell"; executable: string; args: string[] };

export type Snapshot = {
  epoch: string;
  revision: number;
  sessions: { id: string; name: string; position: number }[];
  workspaces: { id: string; name: string }[];
  sessionWorkspaces: { sessionId: string; workspaceId: string; position: number }[];
  categories: { workspaceId: string; kind: CategoryKind; title: string; position: number }[];
  projects: {
    id: string;
    workspaceId: string;
    category: CategoryKind;
    name: string;
    position: number;
  }[];
  items: {
    id: string;
    projectId: string;
    kind: "generic" | "surface";
    title: string;
    position: number;
    data: Record<string, unknown>;
    provenanceItemId: string | null;
  }[];
  surfaces: { id: string; itemId: string; activeTabId: string | null }[];
  tabs: {
    id: string;
    surfaceId: string;
    title: string;
    position: number;
    layout: LayoutNode | null;
  }[];
  panes: {
    id: string;
    surfaceId: string;
    kind: "terminal";
    title: string;
    cwd: string;
    restorePolicy: ShellRestorePolicy;
    processStatus: PaneStatus;
    errorText: string | null;
    startedAt: string | null;
    exitedAt: string | null;
  }[];
  terminalHistories: { paneId: string; cursor: number; data: string; truncated: boolean }[];
};

export type CommandResult = {
  id: string;
  itemId?: string;
  surfaceId?: string;
  tabId?: string;
  paneId?: string;
  stopping?: true;
  destroying?: true;
};

export type CommandResponse = { ok: true; revision: number; result: CommandResult };

export type Command =
  | { type: "session.create"; name: string }
  | { type: "workspace.create"; sessionId: string; name: string }
  | { type: "project.create"; workspaceId: string; category: CategoryKind; name: string }
  | {
      type: "item.create";
      projectId: string;
      kind: "generic" | "surface";
      title: string;
      data?: Record<string, unknown>;
    }
  | { type: "surface.ensure"; itemId: string; cwd?: string }
  | { type: "surface.ensureHere"; projectId: string; cwd?: string }
  | { type: "tab.create"; surfaceId: string; title: string }
  | { type: "surface.selectTab"; surfaceId: string; tabId: string }
  | { type: "pane.split"; paneId: string; direction: "horizontal" | "vertical"; cwd?: string }
  | { type: "process.restart"; paneId: string }
  | { type: "daemon.stop" }
  | { type: "daemon.destroy" };

export type ClientMessage =
  | { type: "terminal.input"; paneId: string; data: string }
  | { type: "terminal.resize"; paneId: string; cols: number; rows: number };

export type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "terminal.output"; epoch: string; paneId: string; cursor: number; data: string }
  | { type: "process.status"; epoch: string; paneId: string; status: PaneStatus; error?: string };

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

const CATEGORY_KINDS = new Set<CategoryKind>([
  "inbox",
  "today",
  "design",
  "implementation",
  "collaboration",
  "operations",
]);

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("message must be an object");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, nonBlank = false): string {
  if (typeof value !== "string" || (nonBlank && value.trim() === "")) {
    throw new ProtocolError(`${field} must be ${nonBlank ? "a non-blank" : "a"} string`);
  }
  return value;
}

function idValue(value: unknown, field: string): string {
  return stringValue(value, field, true);
}

function base64Value(value: unknown, field: string): string {
  const encoded = stringValue(value, field);
  if (Buffer.from(encoded, "base64").toString("base64") !== encoded) {
    throw new ProtocolError(`${field} must be base64`);
  }
  return encoded;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, field);
}

function categoryValue(value: unknown): CategoryKind {
  if (typeof value !== "string" || !CATEGORY_KINDS.has(value as CategoryKind)) {
    throw new ProtocolError("category must be a known category");
  }
  return value as CategoryKind;
}

export function parseCommand(value: unknown): Command {
  const input = objectValue(value);
  const type = stringValue(input.type, "type");
  switch (type) {
    case "session.create":
      return { type, name: stringValue(input.name, "name", true) };
    case "workspace.create":
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        name: stringValue(input.name, "name", true),
      };
    case "project.create":
      return {
        type,
        workspaceId: idValue(input.workspaceId, "workspaceId"),
        category: categoryValue(input.category),
        name: stringValue(input.name, "name", true),
      };
    case "item.create": {
      if (input.kind !== "generic" && input.kind !== "surface") {
        throw new ProtocolError("kind must be generic or surface");
      }
      const data = input.data === undefined ? undefined : objectValue(input.data);
      return {
        type,
        projectId: idValue(input.projectId, "projectId"),
        kind: input.kind,
        title: stringValue(input.title, "title", true),
        ...(data === undefined ? {} : { data }),
      };
    }
    case "surface.ensure":
      return {
        type,
        itemId: idValue(input.itemId, "itemId"),
        ...(input.cwd === undefined ? {} : { cwd: optionalString(input.cwd, "cwd") }),
      };
    case "surface.ensureHere":
      return {
        type,
        projectId: idValue(input.projectId, "projectId"),
        ...(input.cwd === undefined ? {} : { cwd: optionalString(input.cwd, "cwd") }),
      };
    case "tab.create":
      return {
        type,
        surfaceId: idValue(input.surfaceId, "surfaceId"),
        title: stringValue(input.title, "title", true),
      };
    case "surface.selectTab":
      return {
        type,
        surfaceId: idValue(input.surfaceId, "surfaceId"),
        tabId: idValue(input.tabId, "tabId"),
      };
    case "pane.split": {
      if (input.direction !== "horizontal" && input.direction !== "vertical") {
        throw new ProtocolError("direction must be horizontal or vertical");
      }
      return {
        type,
        paneId: idValue(input.paneId, "paneId"),
        direction: input.direction,
        ...(input.cwd === undefined ? {} : { cwd: optionalString(input.cwd, "cwd") }),
      };
    }
    case "process.restart":
      return { type, paneId: idValue(input.paneId, "paneId") };
    case "daemon.stop":
    case "daemon.destroy":
      return { type };
    default:
      throw new ProtocolError(`unknown command type: ${type}`);
  }
}

export function parseClientMessage(value: unknown): ClientMessage {
  const input = objectValue(value);
  const type = stringValue(input.type, "type");
  switch (type) {
    case "terminal.input":
      return {
        type,
        paneId: idValue(input.paneId, "paneId"),
        data: base64Value(input.data, "data"),
      };
    case "terminal.resize": {
      const cols = input.cols;
      const rows = input.rows;
      if (
        !Number.isInteger(cols) ||
        (cols as number) <= 0 ||
        !Number.isInteger(rows) ||
        (rows as number) <= 0
      ) {
        throw new ProtocolError("cols and rows must be positive integers");
      }
      return {
        type,
        paneId: idValue(input.paneId, "paneId"),
        cols: cols as number,
        rows: rows as number,
      };
    }
    default:
      throw new ProtocolError(`unknown client message type: ${type}`);
  }
}

export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

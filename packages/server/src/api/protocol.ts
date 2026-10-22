import type {
  TerminalProjectionReply,
  TerminalProjectionRequest,
} from "./terminal-projection-protocol";

export type CategoryKind =
  | "inbox"
  | "today"
  | "design"
  | "implementation"
  | "collaboration"
  | "operations";

export type PaneStatus = "starting" | "running" | "exited" | "interrupted" | "failed";

export type SessionNavigation = {
  sessionId: string;
  generation: number;
  workspaceId: string | null;
  category: CategoryKind | null;
  itemId: string | null;
  tabId: string | null;
  paneId: string | null;
};

export type NavigationTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "category"; category: CategoryKind }
  | { kind: "item"; itemId: string }
  | { kind: "tab"; tabId: string }
  | { kind: "pane"; paneId: string };

export type NavigationLevel = "category" | "item" | "tab";

export type TerminalSize = { cols: number; rows: number };
export type GridMarker = TerminalSize & { cursor: number; sequence: number };
export type ViewerReport = {
  epoch: string;
  attachmentGeneration: number;
  navigationGeneration: number;
  tabId: string;
  canvas: TerminalSize;
  eligible: boolean;
};
export type TerminalGeometry = {
  sequence: number;
  tabs: {
    tabId: string;
    generation: number;
    ownerConnectionId: string | null;
    canvas: TerminalSize | null;
  }[];
  panes: { paneId: string; size: TerminalSize }[];
};

export type ActivationContext = { sessionId: string; generation: number };
export type ClientAttachment = {
  connectionId: string;
  generation: number;
  sessionId: string | null;
};
export type InputStamp = {
  epoch: string;
  attachmentGeneration: number;
  navigationGeneration: number;
  /** Per-tab generation; unrelated tab activity must not invalidate these bytes. */
  geometrySequence: number;
};
export type TerminalInputContext = InputStamp & { runtimeGeneration?: number } & (
    | { source: "response" }
    | { source: "input"; kind: "key" | "paste" | "mouse" | "focus"; activitySequence?: number }
  );
export type InteractiveMessage =
  | TerminalProjectionRequest
  | { type: "client.attach"; requestId: number; sessionId: string | null }
  | { type: "client.command"; requestId: number; attachmentGeneration: number; command: unknown }
  | { type: "client.viewport"; stamp: InputStamp; report: ViewerReport | null }
  | { type: "client.activity"; stamp: InputStamp; sequence: number }
  | { type: "terminal.input"; paneId: string; data: string; context: TerminalInputContext };

export type InteractiveServerMessage =
  | TerminalProjectionReply
  | { type: "client.ready"; epoch: string; connectionId: string }
  | { type: "client.attached"; requestId: number | null; attachment: ClientAttachment }
  | { type: "command.result"; requestId: number; response: CommandResponse }
  | { type: "command.error"; requestId: number; message: string; field?: ValidationField }
  | {
      type: "terminal.geometry";
      epoch: string;
      geometry: TerminalGeometry;
      resizes: { paneId: string; marker: GridMarker; runtimeGeneration: number }[];
    };

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

type TargetData = {
  path: string;
  branch: string | null;
  availability: "available" | "unavailable";
  failureReason?: string;
};
export type DirectoryData = TargetData & {
  isGitCheckout: boolean;
  gitCommonDir: string | null;
  discoveryError?: string;
};
export type WorktreeData = TargetData;
type WorkItemBase = {
  id: string;
  workspaceId: string;
  category: CategoryKind;
  parentId: string | null;
  title: string;
  position: number;
  archived: boolean;
};
export type WorkItem = WorkItemBase &
  (
    | { kind: "directory"; data: DirectoryData }
    | { kind: "worktree"; data: WorktreeData }
    | { kind: "generic"; data: Record<string, unknown> }
  );

export type Snapshot = {
  epoch: string;
  revision: number;
  sessions: { id: string; name: string; position: number }[];
  workspaces: { id: string; name: string }[];
  sessionWorkspaces: { sessionId: string; workspaceId: string; position: number }[];
  categories: { workspaceId: string; kind: CategoryKind; title: string; position: number }[];
  items: WorkItem[];
  navigation: SessionNavigation[];
  geometry: TerminalGeometry;
  surfaces: { id: string; itemId: string }[];
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
  terminalHistories: {
    paneId: string;
    cursor: number;
    data: string;
    truncated: boolean;
    startCursor: number;
    prefixBytes: number;
    initialSize: TerminalSize | null;
    initialGridSequence: number | null;
    resizes: GridMarker[];
  }[];
};

export type CommandResult = {
  id: string;
  sessionId?: string;
  workspaceId?: string;
  itemId?: string;
  rootItemId?: string;
  surfaceId?: string;
  tabId?: string;
  paneId?: string;
  stopping?: true;
  destroying?: true;
  navigation?: SessionNavigation;
};

/** Runtime identity is daemon-local; epoch disambiguates daemon restarts. */
export type PaneRuntimeIdentity = { paneId: string; runtimeGeneration: number };
export type ControlSnapshot = Omit<Snapshot, "terminalHistories"> & {
  terminalStates: PaneRuntimeIdentity[];
};
export type PaneHistoryResponse = PaneRuntimeIdentity & {
  epoch: string;
  history: Snapshot["terminalHistories"][number];
};

export type CommandResponse = { ok: true; revision: number; result: CommandResult };

export type Command =
  | {
      type: "session.navigate";
      sessionId: string;
      target: NavigationTarget;
      navigationGeneration?: number;
    }
  | { type: "session.step"; sessionId: string; level: NavigationLevel; direction: -1 | 1 }
  | {
      type: "session.openItem";
      sessionId: string;
      itemId: string;
      cwd?: string;
      navigationGeneration?: number;
    }
  | { type: "session.create"; name: string }
  | { type: "session.update"; sessionId: string; name?: string; position?: number }
  | { type: "session.delete"; sessionId: string }
  | { type: "session.workspace.add"; sessionId: string; workspaceId: string }
  | { type: "session.workspace.remove"; sessionId: string; workspaceId: string }
  | { type: "workspace.create"; sessionId: string; name: string }
  | { type: "directory.register"; workspaceId: string; path: string }
  | {
      type: "item.create";
      workspaceId: string;
      category: CategoryKind;
      parentId?: string;
      title: string;
      data?: Record<string, unknown>;
    }
  | { type: "surface.ensure"; itemId: string; cwd?: string }
  | { type: "item.setArchived"; itemId: string; archived: boolean }
  | { type: "tab.create"; surfaceId: string; title: string; activation?: ActivationContext }
  | {
      type: "pane.split";
      paneId: string;
      direction: "horizontal" | "vertical";
      cwd?: string;
      activation?: ActivationContext;
    }
  | { type: "process.restart"; paneId: string; activation?: ActivationContext }
  | { type: "daemon.stop" }
  | { type: "daemon.destroy" };

export type ClientMessage = InteractiveMessage;

// shortcut: bounded burst headroom, replace disconnect-based recovery in the output/lifecycle follow-up.
export const STREAM_BACKPRESSURE_LIMIT = 8 * 1024 * 1024;

export type ServerMessage =
  | InteractiveServerMessage
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "snapshot.available"; epoch: string; revision: number }
  | { type: "control.snapshot"; snapshot: ControlSnapshot }
  | { type: "control.available"; epoch: string; revision: number }
  | {
      type: "terminal.output";
      epoch: string;
      paneId: string;
      cursor: number;
      data: string;
      geometrySequence: number;
      runtimeGeneration: number;
    }
  | {
      type: "process.status";
      epoch: string;
      paneId: string;
      runtimeGeneration: number;
      status: PaneStatus;
      error?: string;
    };

export type ValidationField = "name" | "title" | "path";

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly field?: ValidationField,
  ) {
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
    throw new ProtocolError(
      `${field} must be ${nonBlank ? "a non-blank" : "a"} string`,
      ["name", "title", "path"].includes(field) ? (field as ValidationField) : undefined,
    );
  }
  return value;
}

function idValue(value: unknown, field: string): string {
  return stringValue(value, field, true);
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
  const activation = input.activation === undefined ? undefined : activationValue(input.activation);
  if (
    input.navigationGeneration !== undefined &&
    (!Number.isSafeInteger(input.navigationGeneration) ||
      (input.navigationGeneration as number) < 0)
  ) {
    throw new ProtocolError("navigationGeneration must be a non-negative safe integer");
  }
  const navigationGuard =
    input.navigationGeneration === undefined
      ? {}
      : { navigationGeneration: input.navigationGeneration as number };
  switch (type) {
    case "session.navigate":
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        target: navigationTarget(input.target),
        ...navigationGuard,
      };
    case "session.step":
      if (
        !["category", "item", "tab"].includes(input.level as string) ||
        (input.direction !== -1 && input.direction !== 1)
      ) {
        throw new ProtocolError("step requires category/item/tab and direction -1 or 1");
      }
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        level: input.level as NavigationLevel,
        direction: input.direction,
      };
    case "session.openItem":
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        itemId: idValue(input.itemId, "itemId"),
        ...navigationGuard,
        ...(input.cwd === undefined ? {} : { cwd: optionalString(input.cwd, "cwd") }),
      };
    case "session.create":
      return { type, name: stringValue(input.name, "name", true) };
    case "session.update": {
      if (input.name === undefined && input.position === undefined) {
        throw new ProtocolError("session update requires a name or position");
      }
      const name = input.name === undefined ? undefined : stringValue(input.name, "name", true);
      const position = input.position;
      if (position !== undefined && (!Number.isSafeInteger(position) || (position as number) < 0)) {
        throw new ProtocolError("position must be a non-negative safe integer");
      }
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        ...(name === undefined ? {} : { name }),
        ...(position === undefined ? {} : { position: position as number }),
      };
    }
    case "session.delete":
      return { type, sessionId: idValue(input.sessionId, "sessionId") };
    case "session.workspace.add":
    case "session.workspace.remove":
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        workspaceId: idValue(input.workspaceId, "workspaceId"),
      };
    case "workspace.create":
      return {
        type,
        sessionId: idValue(input.sessionId, "sessionId"),
        name: stringValue(input.name, "name", true),
      };
    case "directory.register":
      return {
        type,
        workspaceId: idValue(input.workspaceId, "workspaceId"),
        path: stringValue(input.path, "path", true),
      };
    case "item.create": {
      if (input.kind !== undefined || input.projectId !== undefined) {
        throw new ProtocolError("item.create accepts generic items only, without a supplied kind");
      }
      const category = categoryValue(input.category);
      if (category === "implementation") {
        throw new ProtocolError("Coding items must be registered directories");
      }
      const data = input.data === undefined ? undefined : objectValue(input.data);
      return {
        type,
        workspaceId: idValue(input.workspaceId, "workspaceId"),
        category,
        ...(input.parentId === undefined ? {} : { parentId: idValue(input.parentId, "parentId") }),
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
    case "item.setArchived":
      if (typeof input.archived !== "boolean") {
        throw new ProtocolError("archived must be boolean");
      }
      return {
        type,
        itemId: idValue(input.itemId, "itemId"),
        archived: input.archived,
      };
    case "tab.create":
      return {
        type,
        ...(activation === undefined ? {} : { activation }),
        surfaceId: idValue(input.surfaceId, "surfaceId"),
        title: stringValue(input.title, "title", true),
      };
    case "surface.selectTab":
      throw new ProtocolError(
        "surface.selectTab was removed; use session.navigate with a sessionId and tab target",
      );
    case "pane.split": {
      if (input.direction !== "horizontal" && input.direction !== "vertical") {
        throw new ProtocolError("direction must be horizontal or vertical");
      }
      return {
        type,
        paneId: idValue(input.paneId, "paneId"),
        ...(activation === undefined ? {} : { activation }),
        direction: input.direction,
        ...(input.cwd === undefined ? {} : { cwd: optionalString(input.cwd, "cwd") }),
      };
    }
    case "process.restart":
      return {
        type,
        paneId: idValue(input.paneId, "paneId"),
        ...(activation === undefined ? {} : { activation }),
      };
    case "daemon.stop":
    case "daemon.destroy":
      return { type };
    default:
      throw new ProtocolError(`unknown command type: ${type}`);
  }
}

export { parseInteractiveMessage as parseClientMessage } from "./interactive-protocol.ts";

function activationValue(value: unknown): ActivationContext {
  const input = objectValue(value);
  if (!Number.isSafeInteger(input.generation) || (input.generation as number) < 0) {
    throw new ProtocolError("activation generation must be a non-negative safe integer");
  }
  return {
    sessionId: idValue(input.sessionId, "sessionId"),
    generation: input.generation as number,
  };
}

function navigationTarget(value: unknown): NavigationTarget {
  const input = objectValue(value);
  switch (input.kind) {
    case "workspace":
      return { kind: input.kind, workspaceId: idValue(input.workspaceId, "workspaceId") };
    case "category":
      return { kind: input.kind, category: categoryValue(input.category) };
    case "item":
      return { kind: input.kind, itemId: idValue(input.itemId, "itemId") };
    case "tab":
      return { kind: input.kind, tabId: idValue(input.tabId, "tabId") };
    case "pane":
      return { kind: input.kind, paneId: idValue(input.paneId, "paneId") };
    default:
      throw new ProtocolError("unknown navigation target kind");
  }
}

export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

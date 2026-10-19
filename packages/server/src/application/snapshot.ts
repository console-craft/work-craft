import type { Database } from "bun:sqlite";

import { encodeBytes } from "../api/protocol.ts";
import type {
  CategoryKind,
  LayoutNode,
  PaneStatus,
  ShellRestorePolicy,
  Snapshot,
} from "../api/protocol.ts";
import type { TerminalHistory } from "../terminal/history.ts";
import { readItems, validateItemAncestry } from "./items.ts";

export const CATEGORIES: readonly { kind: CategoryKind; title: string; position: number }[] = [
  { kind: "inbox", title: "Inbox", position: 0 },
  { kind: "today", title: "Today", position: 1 },
  { kind: "design", title: "Design", position: 2 },
  { kind: "implementation", title: "Implementation", position: 3 },
  { kind: "collaboration", title: "Collaboration", position: 4 },
  { kind: "operations", title: "Operations", position: 5 },
];

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new Error(`Invalid ${field}`, { cause });
  }
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${field}: expected a non-blank string`);
  }
  return value;
}

function parseLayout(value: unknown): LayoutNode {
  const node = recordValue(value, "tabs.layout_json");
  if (node.type === "pane") {
    return { type: "pane", paneId: nonBlankString(node.paneId, "tabs.layout_json paneId") };
  }
  if (node.type !== "split") {
    throw new Error("Invalid tabs.layout_json type");
  }
  if (node.direction !== "horizontal" && node.direction !== "vertical") {
    throw new Error("Invalid tabs.layout_json direction");
  }
  if (
    typeof node.ratio !== "number" ||
    !Number.isFinite(node.ratio) ||
    node.ratio <= 0 ||
    node.ratio >= 1
  ) {
    throw new Error("Invalid tabs.layout_json ratio: expected a number between 0 and 1");
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first: parseLayout(node.first),
    second: parseLayout(node.second),
  };
}

function parseRestorePolicy(value: string): ShellRestorePolicy {
  const policy = recordValue(
    parseJson(value, "panes.restore_policy_json"),
    "panes.restore_policy_json",
  );
  if (
    policy.type !== "shell" ||
    !Array.isArray(policy.args) ||
    !policy.args.every((arg) => typeof arg === "string")
  ) {
    throw new Error("Invalid panes.restore_policy_json: expected a shell policy");
  }
  return {
    type: "shell",
    executable: nonBlankString(policy.executable, "panes.restore_policy_json executable"),
    args: policy.args,
  };
}

function parsePaneStatus(value: string): PaneStatus {
  if (!["starting", "running", "exited", "interrupted", "failed"].includes(value)) {
    throw new Error(`Invalid panes.process_status: ${value}`);
  }
  return value as PaneStatus;
}

export function readSnapshot(
  db: Database,
  epoch: string,
  revision: number,
  history?: TerminalHistory,
): Snapshot {
  const sessions = db
    .query<{ id: string; name: string; position: number }, []>(
      "SELECT id, name, position FROM sessions ORDER BY position, id",
    )
    .all();
  const workspaces = db
    .query<{ id: string; name: string }, []>("SELECT id, name FROM workspaces ORDER BY id")
    .all();
  const sessionWorkspaces = db
    .query<{ sessionId: string; workspaceId: string; position: number }, []>(
      "SELECT session_id AS sessionId, workspace_id AS workspaceId, position FROM session_workspaces ORDER BY session_id, position, workspace_id",
    )
    .all();
  const items = readItems(db);
  validateItemAncestry(items);
  const surfaces = db
    .query<{ id: string; itemId: string; activeTabId: string | null }, []>(
      "SELECT id, item_id AS itemId, active_tab_id AS activeTabId FROM surfaces ORDER BY id",
    )
    .all();
  const tabRows = db
    .query<
      {
        id: string;
        surfaceId: string;
        title: string;
        position: number;
        layoutJson: string | null;
      },
      []
    >(
      "SELECT id, surface_id AS surfaceId, title, position, layout_json AS layoutJson FROM tabs ORDER BY position, id",
    )
    .all();
  const paneRows = db
    .query<
      {
        id: string;
        surfaceId: string;
        kind: "terminal";
        title: string;
        cwd: string;
        restorePolicyJson: string;
        processStatus: string;
        errorText: string | null;
        startedAt: string | null;
        exitedAt: string | null;
      },
      []
    >(
      "SELECT id, surface_id AS surfaceId, kind, title, cwd, restore_policy_json AS restorePolicyJson, process_status AS processStatus, error_text AS errorText, started_at AS startedAt, exited_at AS exitedAt FROM panes ORDER BY id",
    )
    .all();
  const chunkRows = db
    .query<{ paneId: string; cursorStart: number; cursorEnd: number; data: Uint8Array }, []>(
      "SELECT pane_id AS paneId, cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks ORDER BY pane_id, cursor_start, id",
    )
    .all();

  const chunksByPane = new Map<string, typeof chunkRows>();
  for (const chunk of chunkRows) {
    const chunks = chunksByPane.get(chunk.paneId) ?? [];
    chunks.push(chunk);
    chunksByPane.set(chunk.paneId, chunks);
  }

  return {
    epoch,
    revision,
    sessions,
    workspaces,
    sessionWorkspaces,
    categories: workspaces.flatMap((workspace) =>
      CATEGORIES.map((category) => ({ workspaceId: workspace.id, ...category })),
    ),
    items,
    surfaces,
    tabs: tabRows.map(({ layoutJson, ...tab }) => ({
      ...tab,
      layout: layoutJson === null ? null : parseLayout(parseJson(layoutJson, "tabs.layout_json")),
    })),
    panes: paneRows.map(({ restorePolicyJson, processStatus, ...pane }) => ({
      ...pane,
      restorePolicy: parseRestorePolicy(restorePolicyJson),
      processStatus: parsePaneStatus(processStatus),
    })),
    terminalHistories: paneRows.map(({ id }) => {
      if (history !== undefined) {
        const retained = history.read(id);
        return { ...retained, data: encodeBytes(retained.data) };
      }
      const chunks = chunksByPane.get(id) ?? [];
      const bytes = new Uint8Array(
        chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0),
      );
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk.data, offset);
        offset += chunk.data.byteLength;
      }
      return {
        paneId: id,
        cursor: chunks.at(-1)?.cursorEnd ?? 0,
        data: encodeBytes(bytes),
        truncated: (chunks[0]?.cursorStart ?? 0) > 0,
      };
    }),
  };
}

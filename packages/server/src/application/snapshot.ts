import type { Database } from "bun:sqlite";

import { encodeBytes } from "../api/protocol.ts";
import type {
  PaneStatus,
  ShellRestorePolicy,
  Snapshot,
  TerminalGeometry,
} from "../api/protocol.ts";
import { TerminalHistory } from "../terminal/history.ts";
import { readCatalogRows } from "./catalog.ts";
import { CATEGORIES } from "./categories.ts";
import { parseLayout } from "./layout.ts";
import { readSessionNavigation } from "./navigation-store.ts";

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

/** Durable metadata for live authorization, without copying or encoding terminal history. */
export function readSnapshotState(
  db: Database,
  epoch: string,
  revision: number,
  geometry?: TerminalGeometry,
): Omit<Snapshot, "terminalHistories"> {
  const { sessions, workspaces, sessionWorkspaces, items, surfaces, tabRows } = readCatalogRows(db);
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

  return {
    epoch,
    revision,
    sessions,
    navigation: sessions.map(({ id }) => readSessionNavigation(db, id).cursor),
    geometry: geometry ?? {
      sequence: 0,
      tabs: tabRows.map(({ id }) => ({
        tabId: id,
        generation: 0,
        ownerConnectionId: null,
        canvas: null,
      })),
      panes: paneRows.map(({ id }) => ({ paneId: id, size: { cols: 80, rows: 24 } })),
    },
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
  };
}

export function readSnapshot(
  db: Database,
  epoch: string,
  revision: number,
  history?: TerminalHistory,
  geometry?: TerminalGeometry,
): Snapshot {
  const state = readSnapshotState(db, epoch, revision, geometry);
  const retainedHistory = history ?? new TerminalHistory(db);
  return {
    ...state,
    terminalHistories: state.panes.map(({ id }) => {
      const retained = retainedHistory.read(id);
      return { ...retained, data: encodeBytes(retained.data) };
    }),
  };
}

import type { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "node:util";

import { ProtocolError, type SessionNavigation } from "../api/protocol.ts";
import { readCatalogRows } from "./catalog.ts";
import { CATEGORIES } from "./categories.ts";
import { parseLayout } from "./layout.ts";
import {
  initialNavigation,
  type NavigationCatalog,
  type NavigationState,
  normalizeNavigation,
} from "./navigation.ts";

/** Read only the catalog needed by a navigation transaction, never history/runtime snapshots. */
export function readNavigationCatalog(db: Database): NavigationCatalog {
  const { sessions, workspaces, sessionWorkspaces, items, surfaces, tabRows } = readCatalogRows(db);
  return {
    sessions,
    workspaces,
    sessionWorkspaces,
    categories: workspaces.flatMap(({ id }) =>
      CATEGORIES.map((category) => ({ ...category, workspaceId: id })),
    ),
    items,
    surfaces,
    tabs: tabRows.map(({ layoutJson, ...tab }) => ({
      ...tab,
      layout: layoutJson === null ? null : parseLayout(JSON.parse(layoutJson)),
    })),
    panes: db
      .query<NavigationCatalog["panes"][number], []>(
        "SELECT id,surface_id AS surfaceId FROM panes ORDER BY id",
      )
      .all(),
  };
}

function readCursor(db: Database, sessionId: string): SessionNavigation | null {
  const cursor = db
    .query<SessionNavigation, [string]>(
      "SELECT session_id AS sessionId,generation,workspace_id AS workspaceId,category,item_id AS itemId,tab_id AS tabId,pane_id AS paneId FROM session_navigation WHERE session_id = ?",
    )
    .get(sessionId);
  if (cursor && (!Number.isSafeInteger(cursor.generation) || cursor.generation < 0)) {
    throw new ProtocolError("Invalid persisted navigation generation");
  }
  return cursor;
}

export function readSessionNavigation(db: Database, sessionId: string): NavigationState {
  const cursor = readCursor(db, sessionId);
  if (cursor === null) {
    throw new ProtocolError("session navigation not found");
  }
  const surfaceTabs = db
    .query<{ surfaceId: string; tabId: string }, [string]>(
      "SELECT surface_id AS surfaceId,tab_id AS tabId FROM session_surface_tabs WHERE session_id = ? ORDER BY surface_id",
    )
    .all(sessionId);
  const tabPanes = db
    .query<{ tabId: string; paneId: string }, [string]>(
      "SELECT tab_id AS tabId,pane_id AS paneId FROM session_tab_panes WHERE session_id = ? ORDER BY tab_id",
    )
    .all(sessionId);
  return {
    cursor,
    memory: {
      surfaceTabs: Object.fromEntries(
        surfaceTabs.map(({ surfaceId, tabId }) => [surfaceId, tabId]),
      ),
      tabPanes: Object.fromEntries(tabPanes.map(({ tabId, paneId }) => [tabId, paneId])),
    },
  };
}

/** Caller owns the transaction so structural mutation, cursor and memories cannot diverge. */
export function writeSessionNavigation(db: Database, state: NavigationState): boolean {
  const cursor = state.cursor;
  if (!Number.isSafeInteger(cursor.generation) || cursor.generation < 0) {
    throw new ProtocolError("Invalid navigation generation");
  }
  if (
    readCursor(db, cursor.sessionId) !== null &&
    isDeepStrictEqual(readSessionNavigation(db, cursor.sessionId), state)
  ) {
    return false;
  }
  db.query(`INSERT INTO session_navigation (session_id,generation,workspace_id,category,item_id,tab_id,pane_id) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET generation=excluded.generation,workspace_id=excluded.workspace_id,category=excluded.category,item_id=excluded.item_id,tab_id=excluded.tab_id,pane_id=excluded.pane_id`).run(
    cursor.sessionId,
    cursor.generation,
    cursor.workspaceId,
    cursor.category,
    cursor.itemId,
    cursor.tabId,
    cursor.paneId,
  );
  db.run("DELETE FROM session_surface_tabs WHERE session_id = ?", [cursor.sessionId]);
  db.run("DELETE FROM session_tab_panes WHERE session_id = ?", [cursor.sessionId]);
  const insertTab = db.query("INSERT INTO session_surface_tabs VALUES (?,?,?)");
  const insertPane = db.query("INSERT INTO session_tab_panes VALUES (?,?,?)");
  for (const [surfaceId, tabId] of Object.entries(state.memory.surfaceTabs)) {
    insertTab.run(cursor.sessionId, surfaceId, tabId);
  }
  for (const [tabId, paneId] of Object.entries(state.memory.tabPanes)) {
    insertPane.run(cursor.sessionId, tabId, paneId);
  }
  return true;
}

export function normalizeSessionNavigations(db: Database, before: NavigationCatalog): boolean {
  const after = readNavigationCatalog(db);
  let changed = false;
  for (const session of after.sessions) {
    const state =
      readCursor(db, session.id) === null
        ? initialNavigation(after, session.id)
        : normalizeNavigation(before, after, readSessionNavigation(db, session.id));
    changed = writeSessionNavigation(db, state) || changed;
  }
  return changed;
}

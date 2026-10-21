import type { Database } from "bun:sqlite";

import { readNavigationCatalog, writeSessionNavigation } from "../application/navigation-store.ts";
import { initialNavigation } from "../application/navigation.ts";

const SCHEMA = `
CREATE TABLE session_navigation (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  workspace_id TEXT REFERENCES workspaces(id) DEFERRABLE INITIALLY DEFERRED,
  category TEXT CHECK (category IN ('inbox','today','design','implementation','collaboration','operations')),
  item_id TEXT REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  tab_id TEXT REFERENCES tabs(id) DEFERRABLE INITIALLY DEFERRED,
  pane_id TEXT REFERENCES panes(id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((workspace_id IS NOT NULL AND category IS NOT NULL) OR (workspace_id IS NULL AND category IS NULL AND item_id IS NULL AND tab_id IS NULL AND pane_id IS NULL)),
  CHECK (item_id IS NOT NULL OR (tab_id IS NULL AND pane_id IS NULL)),
  CHECK (tab_id IS NOT NULL OR pane_id IS NULL)
);
CREATE TABLE session_surface_tabs (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL REFERENCES tabs(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (session_id,surface_id)
);
CREATE TABLE session_tab_panes (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES panes(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (session_id,tab_id)
);
CREATE TABLE terminal_grids (
  pane_id TEXT PRIMARY KEY REFERENCES panes(id) ON DELETE CASCADE,
  start_cursor INTEGER NOT NULL CHECK (start_cursor >= 0),
  end_cursor INTEGER NOT NULL CHECK (end_cursor >= start_cursor),
  baseline_cols INTEGER, baseline_rows INTEGER, baseline_sequence INTEGER,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  CHECK ((baseline_cols IS NULL AND baseline_rows IS NULL AND baseline_sequence IS NULL) OR
    (baseline_cols > 0 AND baseline_rows > 0 AND baseline_sequence >= 0))
);
CREATE TABLE terminal_resizes (
  pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0), cursor INTEGER NOT NULL CHECK (cursor >= 0),
  cols INTEGER NOT NULL CHECK (cols BETWEEN 1 AND 4096), rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND 4096),
  CHECK (cols * rows <= 1048576), PRIMARY KEY (pane_id,sequence)
);
`;

/** Upgrade only the current development schema; caller data and original version survive failure. */
export function migrateStage2(db: Database): void {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version !== 4) {
    throw new Error(`Cannot migrate schema ${version}: expected Work Craft schema 4`);
  }
  try {
    db.transaction(() => {
      if (db.query("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Invalid foreign keys before migration");
      }
      const catalog = readNavigationCatalog(db);
      const seen = new Set<string>();
      const leaves = db
        .query<{ paneId: string; surfaceId: string }, []>(
          "SELECT value AS paneId,tabs.surface_id AS surfaceId FROM tabs,json_tree(tabs.layout_json) WHERE key = 'paneId'",
        )
        .all();
      for (const leaf of leaves) {
        if (
          seen.has(leaf.paneId) ||
          !catalog.panes.some(
            (pane) => pane.id === leaf.paneId && pane.surfaceId === leaf.surfaceId,
          )
        ) {
          throw new Error("Invalid pane layout ownership during migration");
        }
        seen.add(leaf.paneId);
      }
      const legacy = db
        .query<{ id: string; activeTabId: string | null }, []>(
          "SELECT id,active_tab_id AS activeTabId FROM surfaces",
        )
        .all();
      db.exec(SCHEMA);
      for (const session of catalog.sessions) {
        const accessible = new Set(
          catalog.sessionWorkspaces
            .filter(({ sessionId }) => sessionId === session.id)
            .map(({ workspaceId }) => workspaceId),
        );
        const memory = {
          surfaceTabs: {} as Record<string, string>,
          tabPanes: {} as Record<string, string>,
        };
        for (const surface of catalog.surfaces) {
          const item = catalog.items.find(({ id }) => id === surface.itemId)!;
          if (!accessible.has(item.workspaceId)) {
            continue;
          }
          const tabs = catalog.tabs.filter(({ surfaceId }) => surfaceId === surface.id);
          const old = legacy.find(({ id }) => id === surface.id)?.activeTabId;
          const selected = tabs.find(({ id }) => id === old) ?? tabs[0];
          if (selected) {
            memory.surfaceTabs[surface.id] = selected.id;
          }
          for (const tab of tabs) {
            const pane = db
              .query<{ paneId: string }, [string]>(
                "SELECT value AS paneId FROM json_tree((SELECT layout_json FROM tabs WHERE id = ?)) WHERE key = 'paneId' ORDER BY id LIMIT 1",
              )
              .get(tab.id);
            if (pane) {
              memory.tabPanes[tab.id] = pane.paneId;
            }
          }
        }
        writeSessionNavigation(db, initialNavigation(catalog, session.id, memory));
      }
      db.exec(`INSERT INTO terminal_grids (pane_id,start_cursor,end_cursor,truncated)
        SELECT panes.id,COALESCE(MIN(cursor_start),0),COALESCE(MAX(cursor_end),0),CASE WHEN MIN(cursor_start)>0 THEN 1 ELSE 0 END
        FROM panes LEFT JOIN terminal_chunks ON terminal_chunks.pane_id=panes.id GROUP BY panes.id`);
      db.exec("ALTER TABLE surfaces DROP COLUMN active_tab_id");
      db.exec("PRAGMA user_version = 5");
    })();
  } catch (cause) {
    throw new Error(
      `Work Craft schema 4 to 5 migration failed; no data was changed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

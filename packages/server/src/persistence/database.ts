import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE session_workspaces (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, PRIMARY KEY (session_id, workspace_id)
);
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('inbox','today','design','implementation','collaboration','operations')),
  parent_id TEXT REFERENCES items(id),
  kind TEXT NOT NULL CHECK (kind IN ('generic','directory','worktree')),
  title TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'object')
);
CREATE INDEX items_context_order ON items(workspace_id, category, parent_id, position, id);
CREATE UNIQUE INDEX checkout_identity ON items(workspace_id, category, json_extract(data_json, '$.path')) WHERE kind IN ('directory', 'worktree');
CREATE UNIQUE INDEX repository_identity ON items(workspace_id, category, json_extract(data_json, '$.gitCommonDir')) WHERE kind = 'directory' AND json_extract(data_json, '$.gitCommonDir') IS NOT NULL;
CREATE TABLE surfaces (id TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE);
CREATE TABLE tabs (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL, layout_json TEXT);
CREATE TABLE panes (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind = 'terminal'), title TEXT NOT NULL, cwd TEXT NOT NULL, restore_policy_json TEXT NOT NULL, process_status TEXT NOT NULL, error_text TEXT, started_at TEXT, exited_at TEXT);
CREATE TABLE terminal_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE, cursor_start INTEGER NOT NULL, cursor_end INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX terminal_chunks_pane_cursor ON terminal_chunks(pane_id, cursor_end);
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
    (baseline_cols IS NOT NULL AND baseline_rows IS NOT NULL AND baseline_sequence IS NOT NULL
      AND baseline_cols > 0 AND baseline_rows > 0 AND baseline_sequence >= 0))
);
CREATE TABLE terminal_resizes (
  pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0), cursor INTEGER NOT NULL CHECK (cursor >= 0),
  cols INTEGER NOT NULL CHECK (cols BETWEEN 1 AND 4096), rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND 4096),
  runtime_start TEXT CHECK(runtime_start IN ('fresh','restored')),
  CHECK (cols * rows <= 1048576), PRIMARY KEY (pane_id,sequence)
);
`;

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  try {
    const version = db
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()!.user_version;
    const nonempty =
      db.query("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() !== null;
    if ((version !== 0 && version !== 1) || (version === 0 && nonempty)) {
      throw new Error(
        `Incompatible Work Craft database schema ${version}. Use a fresh WORK_CRAFT_HOME or explicitly reset development state with daemon destroy --force; no data was changed.`,
      );
    }
    db.exec("PRAGMA foreign_keys = ON");
    if (path !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
    }
    if (version === 0) {
      db.transaction(() => {
        db.exec(SCHEMA);
        db.exec("PRAGMA user_version = 1");
      })();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

import { Database } from "bun:sqlite";

export const SCHEMA4 = `
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
CREATE TABLE surfaces (id TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE, active_tab_id TEXT);
CREATE TABLE tabs (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL, layout_json TEXT);
CREATE TABLE panes (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind = 'terminal'), title TEXT NOT NULL, cwd TEXT NOT NULL, restore_policy_json TEXT NOT NULL, process_status TEXT NOT NULL, error_text TEXT, started_at TEXT, exited_at TEXT);
CREATE TABLE terminal_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE, cursor_start INTEGER NOT NULL, cursor_end INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX terminal_chunks_pane_cursor ON terminal_chunks(pane_id, cursor_end);
`;

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  try {
    const version = db
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()!.user_version;
    const nonempty =
      db.query("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() !== null;
    if ((version !== 0 && version !== 4) || (version === 0 && nonempty)) {
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
        db.exec(SCHEMA4);
        db.exec("PRAGMA user_version = 4");
      })();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

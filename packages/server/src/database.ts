import { Database } from "bun:sqlite";

const MIGRATION_1 = `
CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL CHECK (category IN ('inbox','today','design','implementation','collaboration','operations')), name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('generic','surface')), title TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL, provenance_item_id TEXT REFERENCES items(id));
CREATE TABLE surfaces (id TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE, active_tab_id TEXT);
CREATE TABLE tabs (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL, layout_json TEXT);
CREATE TABLE panes (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind = 'terminal'), title TEXT NOT NULL, cwd TEXT NOT NULL, restore_policy_json TEXT NOT NULL, process_status TEXT NOT NULL, error_text TEXT, started_at TEXT, exited_at TEXT);
CREATE TABLE terminal_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE, cursor_start INTEGER NOT NULL, cursor_end INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX terminal_chunks_pane_cursor ON terminal_chunks(pane_id, cursor_end);
`;

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }

  const version =
    db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (version === 0) {
    db.transaction(() => {
      db.exec(MIGRATION_1);
      db.exec("PRAGMA user_version = 1");
    })();
  }
  return db;
}

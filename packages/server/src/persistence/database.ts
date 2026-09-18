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

const MIGRATION_2 = `
CREATE TABLE session_workspaces (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, workspace_id)
);
INSERT INTO session_workspaces (session_id, workspace_id, position)
SELECT session_id, id, position FROM workspaces;
CREATE TABLE workspaces_new (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO workspaces_new (id, name) SELECT id, name FROM workspaces;
DROP TABLE workspaces;
ALTER TABLE workspaces_new RENAME TO workspaces;
`;

function migrateToVersion2(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(MIGRATION_2);
      const violation = db.query("PRAGMA foreign_key_check").get();
      if (violation !== null) {
        throw new Error("Database migration created a foreign-key violation");
      }
      db.exec("PRAGMA user_version = 2");
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
  }

  let version =
    db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (version === 0) {
    db.transaction(() => {
      db.exec(MIGRATION_1);
      db.exec("PRAGMA user_version = 1");
    })();
    version = 1;
  }
  if (version < 2) {
    migrateToVersion2(db);
  }
  return db;
}

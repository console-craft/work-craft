import { Database } from "bun:sqlite";

import { SCHEMA4 } from "./database.ts";

/** A schema-4 fixture with shared ownership and retained output; never starts processes. */
export function stage2Fixture(path = ":memory:") {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA4);
  db.exec("PRAGMA user_version = 4");
  db.exec(`
    INSERT INTO sessions VALUES ('s', 'First', 0), ('other', 'Second', 1);
    INSERT INTO workspaces VALUES ('w', 'Work');
    INSERT INTO session_workspaces VALUES ('s', 'w', 0), ('other', 'w', 0);
    INSERT INTO items VALUES
      ('a', 'w', 'inbox', NULL, 'generic', 'First', 0, 0, '{}'),
      ('b', 'w', 'inbox', NULL, 'generic', 'Next', 1, 0, '{}'),
      ('archived', 'w', 'inbox', NULL, 'generic', 'Archived', 2, 1, '{}'),
      ('child', 'w', 'inbox', 'archived', 'generic', 'Hidden child', 0, 0, '{}');
    INSERT INTO surfaces VALUES ('surface', 'a', 'tab-2');
    INSERT INTO panes (id, surface_id, kind, title, cwd, restore_policy_json, process_status) VALUES
      ('pane-1', 'surface', 'terminal', 'First', '/', '{"type":"shell","executable":"/bin/sh","args":[]}', 'interrupted'),
      ('pane-2', 'surface', 'terminal', 'Second', '/', '{"type":"shell","executable":"/bin/sh","args":[]}', 'exited');
    INSERT INTO tabs VALUES
      ('tab-1', 'surface', 'First', 0, '{"type":"pane","paneId":"pane-1"}'),
      ('tab-2', 'surface', 'Second', 1, '{"type":"pane","paneId":"pane-2"}');
    INSERT INTO terminal_chunks (pane_id,cursor_start,cursor_end,data)
      VALUES ('pane-1',0,8,X'53454E54494E454C');
  `);
  return db;
}

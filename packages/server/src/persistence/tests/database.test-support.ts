import type { Database } from "bun:sqlite";

import {
  readNavigationCatalog,
  writeSessionNavigation,
} from "../../application/navigation-store.ts";
import { initialNavigation } from "../../application/navigation.ts";
import { openDatabase } from "../database.ts";

/** Shared workspace, independent session memories and retained output; never starts processes. */
export function databaseFixture(path = ":memory:"): Database {
  const db = openDatabase(path);
  db.exec(`
    INSERT INTO sessions VALUES ('s', 'First', 0), ('other', 'Second', 1);
    INSERT INTO workspaces VALUES ('w', 'Work');
    INSERT INTO session_workspaces VALUES ('s', 'w', 0), ('other', 'w', 0);
    INSERT INTO items VALUES
      ('a', 'w', 'inbox', NULL, 'generic', 'First', 0, 0, '{}'),
      ('b', 'w', 'inbox', NULL, 'generic', 'Next', 1, 0, '{}'),
      ('archived', 'w', 'inbox', NULL, 'generic', 'Archived', 2, 1, '{}'),
      ('child', 'w', 'inbox', 'archived', 'generic', 'Hidden child', 0, 0, '{}');
    INSERT INTO surfaces VALUES ('surface', 'a');
    INSERT INTO panes (id, surface_id, kind, title, cwd, restore_policy_json, process_status) VALUES
      ('pane-1', 'surface', 'terminal', 'First', '/', '{"type":"shell","executable":"/bin/sh","args":[]}', 'interrupted'),
      ('pane-2', 'surface', 'terminal', 'Second', '/', '{"type":"shell","executable":"/bin/sh","args":[]}', 'exited');
    INSERT INTO tabs VALUES
      ('tab-1', 'surface', 'First', 0, '{"type":"pane","paneId":"pane-1"}'),
      ('tab-2', 'surface', 'Second', 1, '{"type":"pane","paneId":"pane-2"}');
    INSERT INTO terminal_chunks (pane_id,cursor_start,cursor_end,data)
      VALUES ('pane-1',0,8,X'53454E54494E454C');
    INSERT INTO terminal_grids (pane_id,start_cursor,end_cursor)
      VALUES ('pane-1',0,8), ('pane-2',0,0);
  `);
  const catalog = readNavigationCatalog(db);
  db.transaction(() => {
    for (const sessionId of ["s", "other"]) {
      writeSessionNavigation(
        db,
        initialNavigation(catalog, sessionId, {
          surfaceTabs: { surface: "tab-2" },
          tabPanes: { "tab-1": "pane-1", "tab-2": "pane-2" },
        }),
      );
    }
  })();
  return db;
}

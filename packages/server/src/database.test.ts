import { expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { CATEGORIES, readSnapshot } from "./snapshot.ts";

function seedSnapshot(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sessions VALUES ('session-b', 'Second', 1), ('session-a', 'First', 1);
    INSERT INTO workspaces VALUES ('workspace-1', 'session-a', 'Personal', 0);
    INSERT INTO projects VALUES ('project-1', 'workspace-1', 'implementation', 'Work Craft', 0);
    INSERT INTO items VALUES ('item-1', 'project-1', 'surface', 'Build', 0, '{"flag":true}', NULL);
    INSERT INTO surfaces VALUES ('surface-1', 'item-1', 'tab-1');
    INSERT INTO tabs VALUES (
      'tab-1',
      'surface-1',
      'Shells',
      0,
      '{"type":"split","direction":"vertical","ratio":0.4,"first":{"type":"pane","paneId":"pane-1"},"second":{"type":"pane","paneId":"pane-2"}}'
    );
    INSERT INTO panes VALUES (
      'pane-1', 'surface-1', 'terminal', 'Main', '/tmp',
      '{"type":"shell","executable":"/bin/zsh","args":["-l"]}',
      'running', NULL, '2026-09-16T10:00:00Z', NULL
    );
    INSERT INTO panes VALUES (
      'pane-2', 'surface-1', 'terminal', 'Other', '/tmp',
      '{"type":"shell","executable":"/bin/zsh","args":[]}',
      'exited', NULL, NULL, '2026-09-16T11:00:00Z'
    );
    INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data)
      VALUES ('pane-1', 2, 4, X'6162'), ('pane-1', 4, 5, X'63');
  `);
}

test("migrates an empty database and exposes six fixed categories", () => {
  const db = openDatabase(":memory:");
  expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(1);
  expect(CATEGORIES.map((category) => category.kind)).toEqual([
    "inbox",
    "today",
    "design",
    "implementation",
    "collaboration",
    "operations",
  ]);
  expect(readSnapshot(db, "epoch-1", 0)).toMatchObject({
    epoch: "epoch-1",
    revision: 0,
    sessions: [],
  });
  db.close();
});

test("reads a deterministic snapshot from persisted rows", () => {
  const db = openDatabase(":memory:");
  seedSnapshot(db);

  const snapshot = readSnapshot(db, "epoch-2", 7);

  expect(snapshot.sessions.map(({ id }) => id)).toEqual(["session-a", "session-b"]);
  expect(snapshot.categories).toEqual(
    CATEGORIES.map((category) => ({ workspaceId: "workspace-1", ...category })),
  );
  expect(snapshot.items[0]?.data).toEqual({ flag: true });
  expect(snapshot.tabs[0]?.layout).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 0.4,
    first: { type: "pane", paneId: "pane-1" },
    second: { type: "pane", paneId: "pane-2" },
  });
  expect(snapshot.panes[0]?.restorePolicy).toEqual({
    type: "shell",
    executable: "/bin/zsh",
    args: ["-l"],
  });
  expect(snapshot.terminalHistories).toEqual([
    { paneId: "pane-1", cursor: 5, data: "YWJj", truncated: true },
    { paneId: "pane-2", cursor: 0, data: "", truncated: false },
  ]);
  db.close();
});

test("rejects malformed persisted JSON and invalid layout ratios", () => {
  const db = openDatabase(":memory:");
  seedSnapshot(db);

  db.exec("UPDATE items SET data_json = 'not json'");
  expect(() => readSnapshot(db, "epoch-3", 0)).toThrow(/items\.data_json/);

  db.exec(`
    UPDATE items SET data_json = '{}';
    UPDATE tabs SET layout_json = '{"type":"split","direction":"vertical","ratio":1,"first":{"type":"pane","paneId":"pane-1"},"second":{"type":"pane","paneId":"pane-2"}}';
  `);
  expect(() => readSnapshot(db, "epoch-3", 0)).toThrow(/ratio/);
  db.close();
});

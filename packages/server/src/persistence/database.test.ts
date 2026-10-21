import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeBytes } from "../api/protocol.ts";
import { CATEGORIES } from "../application/categories.ts";
import {
  normalizeSessionNavigations,
  readNavigationCatalog,
} from "../application/navigation-store.ts";
import { readSnapshot } from "../application/snapshot.ts";
import { openDatabase } from "./database.ts";

function seedSnapshot(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sessions VALUES ('session-b', 'Second', 1), ('session-a', 'First', 1);
    INSERT INTO workspaces VALUES ('workspace-1', 'Personal');
    INSERT INTO session_workspaces VALUES ('session-a', 'workspace-1', 0);
    INSERT INTO items VALUES ('item-1', 'workspace-1', 'design', NULL, 'generic', 'Build', 0, 0, '{"flag":true}');
    INSERT INTO surfaces VALUES ('surface-1', 'item-1');
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
  normalizeSessionNavigations(db, readNavigationCatalog(db));
}

test("migrates an empty database and exposes six fixed categories", () => {
  const db = openDatabase(":memory:");
  expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(5);
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

test("rejects version 1 workspace ownership without losing descendants or history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-migration-"));
  const databasePath = join(directory, "work-craft.db");
  const legacy = new Database(databasePath, { create: true });
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL CHECK (category IN ('inbox','today','design','implementation','collaboration','operations')), name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('generic','surface')), title TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL, provenance_item_id TEXT REFERENCES items(id));
    CREATE TABLE surfaces (id TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE, active_tab_id TEXT);
    CREATE TABLE tabs (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL, layout_json TEXT);
    CREATE TABLE panes (id TEXT PRIMARY KEY, surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind = 'terminal'), title TEXT NOT NULL, cwd TEXT NOT NULL, restore_policy_json TEXT NOT NULL, process_status TEXT NOT NULL, error_text TEXT, started_at TEXT, exited_at TEXT);
    CREATE TABLE terminal_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, pane_id TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE, cursor_start INTEGER NOT NULL, cursor_end INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX terminal_chunks_pane_cursor ON terminal_chunks(pane_id, cursor_end);
    INSERT INTO sessions VALUES ('session-1', 'Main', 0);
    INSERT INTO workspaces VALUES ('workspace-1', 'session-1', 'Work', 0);
    INSERT INTO projects VALUES ('project-1', 'workspace-1', 'implementation', 'Work Craft', 0);
    INSERT INTO items VALUES ('item-1', 'project-1', 'surface', 'Build', 0, '{}', NULL);
    INSERT INTO surfaces VALUES ('surface-1', 'item-1', 'tab-1');
    INSERT INTO tabs VALUES ('tab-1', 'surface-1', 'Main', 0, '{"type":"pane","paneId":"pane-1"}');
    INSERT INTO panes VALUES ('pane-1', 'surface-1', 'terminal', 'Shell', '/tmp', '{"type":"shell","executable":"/bin/sh","args":[]}', 'exited', NULL, NULL, NULL);
    INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES ('pane-1', 0, 2, X'6f6b');
    PRAGMA user_version = 1;
  `);
  legacy.close();

  expect(() => openDatabase(databasePath)).toThrow(/Incompatible/);
  const migrated = new Database(databasePath);
  try {
    expect(
      migrated.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
    ).toBe(1);
    expect(migrated.query("SELECT id, name FROM workspaces").all()).toEqual([
      { id: "workspace-1", name: "Work" },
    ]);
    expect(migrated.query("SELECT id FROM projects").all()).toEqual([{ id: "project-1" }]);
    expect(migrated.query("SELECT hex(data) AS data FROM terminal_chunks").all()).toEqual([
      { data: "6F6B" },
    ]);
    expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects invalid legacy foreign keys before any schema replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-migration-invalid-"));
  const databasePath = join(directory, "work-craft.db");
  const legacy = new Database(databasePath, { create: true });
  legacy.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL CHECK (category IN ('inbox','today','design','implementation','collaboration','operations')), name TEXT NOT NULL, position INTEGER NOT NULL);
    INSERT INTO projects VALUES ('project-1', 'missing-workspace', 'implementation', 'Work Craft', 0);
    PRAGMA user_version = 1;
  `);
  legacy.close();

  try {
    expect(() => openDatabase(databasePath)).toThrow("Incompatible Work Craft database schema");
    const preserved = new Database(databasePath);
    try {
      expect(
        preserved.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
      ).toBe(1);
      expect(
        preserved
          .query<{ name: string }, []>("PRAGMA table_info(workspaces)")
          .all()
          .map(({ name }) => name),
      ).toContain("session_id");
    } finally {
      preserved.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("makes acknowledged file-backed transactions power-loss durable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-database-"));
  const db = openDatabase(join(directory, "work-craft.db"));
  try {
    expect(db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous).toBe(2);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
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
  expect(snapshot.terminalHistories).toMatchObject([
    {
      paneId: "pane-1",
      cursor: 5,
      startCursor: 2,
      truncated: true,
      initialSize: null,
      initialGridSequence: null,
      resizes: [],
    },
    {
      paneId: "pane-2",
      cursor: 0,
      startCursor: 0,
      prefixBytes: 0,
      data: "",
      truncated: false,
      initialSize: null,
      initialGridSequence: null,
      resizes: [],
    },
  ]);
  expect(new TextDecoder().decode(decodeBytes(snapshot.terminalHistories[0]!.data))).toEndWith(
    "abc",
  );
  db.close();
});

test("preserves empty shell arguments in persisted restore policies", () => {
  const db = openDatabase(":memory:");
  seedSnapshot(db);
  db.exec(`
    UPDATE panes
    SET restore_policy_json = '{"type":"shell","executable":"/bin/zsh","args":["-c",""]}'
    WHERE id = 'pane-1';
  `);

  expect(readSnapshot(db, "epoch-3", 0).panes[0]?.restorePolicy.args).toEqual(["-c", ""]);
  db.close();
});

test("rejects malformed persisted JSON and invalid layout ratios", () => {
  const db = openDatabase(":memory:");
  seedSnapshot(db);

  expect(() => db.exec("UPDATE items SET data_json = 'not json'")).toThrow();
  db.exec("PRAGMA ignore_check_constraints = ON; UPDATE items SET data_json = 'not json'");
  expect(() => readSnapshot(db, "epoch-3", 0)).toThrow(/items\.data_json/);

  db.exec(`
    UPDATE items SET data_json = '{}';
    UPDATE tabs SET layout_json = '{"type":"split","direction":"vertical","ratio":1,"first":{"type":"pane","paneId":"pane-1"},"second":{"type":"pane","paneId":"pane-2"}}';
  `);
  expect(() => readSnapshot(db, "epoch-3", 0)).toThrow(/ratio/);
  db.close();
});

test("incompatible versions and nonempty unversioned schemas preserve sentinel data and release handles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-schema-safety-"));
  try {
    for (const version of [0, 1, 2, 3, 999]) {
      const path = join(directory, `${version}.sqlite`);
      const old = new Database(path, { create: true });
      old.exec(
        `CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('keep me'); PRAGMA user_version = ${version}`,
      );
      const schema = old.query("SELECT sql FROM sqlite_master ORDER BY name").all();
      const journal = old.query("PRAGMA journal_mode").get();
      old.close();
      expect(() => openDatabase(path)).toThrow(/incompatible|reset/i);
      const preserved = new Database(path);
      try {
        expect(preserved.query("SELECT * FROM sentinel").all()).toEqual([{ value: "keep me" }]);
        expect(preserved.query("PRAGMA journal_mode").get()).toEqual(journal);
        expect(preserved.query("PRAGMA user_version").get()).toEqual({ user_version: version });
        expect(preserved.query("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
          schema,
        );
        preserved.exec("BEGIN EXCLUSIVE; ROLLBACK;");
      } finally {
        preserved.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Coding paths and Git common directories are unique per workspace including archived owners", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec("INSERT INTO workspaces VALUES ('w', 'Work'), ('other', 'Other')");
    const insert = db.query(
      "INSERT INTO items VALUES (?, ?, 'implementation', ?, ?, 'root', 0, 1, ?)",
    );
    insert.run(
      "root",
      "w",
      null,
      "directory",
      JSON.stringify({ path: "/root", gitCommonDir: "/root/.git" }),
    );
    expect(() =>
      insert.run(
        "duplicate-common",
        "w",
        null,
        "directory",
        JSON.stringify({ path: "/alias", gitCommonDir: "/root/.git" }),
      ),
    ).toThrow(/UNIQUE/);
    insert.run("child", "w", "root", "worktree", JSON.stringify({ path: "/child" }));
    expect(() =>
      insert.run(
        "duplicate-path",
        "w",
        null,
        "directory",
        JSON.stringify({ path: "/child", gitCommonDir: null }),
      ),
    ).toThrow(/UNIQUE/);
    expect(() =>
      insert.run("duplicate-root-path", "w", "root", "worktree", JSON.stringify({ path: "/root" })),
    ).toThrow(/UNIQUE/);
    insert.run(
      "independent",
      "other",
      null,
      "directory",
      JSON.stringify({ path: "/root", gitCommonDir: "/root/.git" }),
    );
    insert.run(
      "plain",
      "w",
      null,
      "directory",
      JSON.stringify({ path: "/plain", gitCommonDir: null }),
    );
  } finally {
    db.close();
  }
});

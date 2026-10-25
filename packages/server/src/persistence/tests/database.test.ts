import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeBytes } from "../../api/protocol.ts";
import { CATEGORIES } from "../../application/categories.ts";
import {
  normalizeSessionNavigations,
  readNavigationCatalog,
  readSessionNavigation,
  writeSessionNavigation,
} from "../../application/navigation-store.ts";
import { selectNavigation } from "../../application/navigation.ts";
import { readSnapshot } from "../../application/snapshot.ts";
import { openDatabase } from "../database.ts";

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

test("initializes the complete baseline without fabricating resources", () => {
  const db = openDatabase(":memory:");
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  for (const table of [
    "session_navigation",
    "session_surface_tabs",
    "session_tab_panes",
    "terminal_grids",
    "terminal_resizes",
  ]) {
    expect(db.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }
  expect(
    db
      .query<{ name: string }, []>("PRAGMA table_info(surfaces)")
      .all()
      .map(({ name }) => name),
  ).not.toContain("active_tab_id");
  expect(
    db
      .query<{ name: string }, []>("PRAGMA table_info(terminal_resizes)")
      .all()
      .map(({ name }) => name),
  ).toContain("runtime_start");
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

test("baseline navigation, output and runtime boundaries survive file-backed reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-baseline-"));
  const path = join(directory, "state.sqlite");
  let db = openDatabase(path);
  try {
    seedSnapshot(db);
    const selected = selectNavigation(
      readNavigationCatalog(db),
      readSessionNavigation(db, "session-a"),
      {
        kind: "pane",
        paneId: "pane-2",
      },
    );
    db.transaction(() => {
      writeSessionNavigation(db, selected);
      db.exec(`
        INSERT INTO terminal_grids (pane_id,start_cursor,end_cursor) VALUES ('pane-1',2,5);
        INSERT INTO terminal_resizes (pane_id,sequence,cursor,cols,rows,runtime_start) VALUES
          ('pane-1',1,2,80,24,NULL), ('pane-1',2,3,100,30,'fresh'), ('pane-1',3,4,120,40,'restored');
      `);
    })();
    expect(() => db.exec("UPDATE terminal_resizes SET runtime_start='invalid'")).toThrow();
    db.close();
    db = openDatabase(path);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(readSessionNavigation(db, "session-a")).toEqual(selected);
    expect(db.query("SELECT runtime_start FROM terminal_resizes ORDER BY sequence").all()).toEqual([
      { runtime_start: null },
      { runtime_start: "fresh" },
      { runtime_start: "restored" },
    ]);
    const history = readSnapshot(db, "reopened", 0).terminalHistories.find(
      ({ paneId }) => paneId === "pane-1",
    )!;
    expect(new TextDecoder().decode(decodeBytes(history.data))).toEndWith("abc");
    expect(history).toMatchObject({
      startCursor: 2,
      cursor: 5,
      resizes: [
        { cursor: 2, sequence: 1, cols: 80, rows: 24 },
        { cursor: 3, sequence: 2, cols: 100, rows: 30 },
        { cursor: 4, sequence: 3, cols: 120, rows: 40 },
      ],
    });
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
  expect(readNavigationCatalog(db).sessions.map(({ id }) => id)).toEqual([
    "session-a",
    "session-b",
  ]);
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
  db.query("UPDATE sessions SET name = ? WHERE id = ?").run("Renamed", "session-a");
  expect(readSnapshot(db, "epoch-2", 7).sessions[0]?.name).toBe("Renamed");
  expect(readNavigationCatalog(db).sessions[0]?.name).toBe("Renamed");
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
    for (const version of [0, 2, 3, 4, 5, 6, 999]) {
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

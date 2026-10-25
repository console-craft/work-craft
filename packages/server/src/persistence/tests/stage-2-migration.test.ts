import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSessionNavigation } from "../../application/navigation-store.ts";
import { SCHEMA4 } from "../database.ts";
import { migrateStage2 } from "../stage-2-migration.ts";
import { stage2Fixture } from "./stage-2.test-support.ts";

test("an empty initialized database migrates without fabricating a session", () => {
  const db = new Database(":memory:");
  db.exec(SCHEMA4);
  db.exec("PRAGMA user_version = 4");
  try {
    migrateStage2(db);
    expect(db.query("SELECT * FROM session_navigation").all()).toEqual([]);
    expect(db.query("SELECT * FROM terminal_grids").all()).toEqual([]);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
  } finally {
    db.close();
  }
});

test("migrated file-backed selections and original output survive reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-stage2-"));
  const path = join(directory, "state.db");
  try {
    const db = stage2Fixture(path);
    try {
      migrateStage2(db);
    } finally {
      db.close();
    }
    const reopened = new Database(path);
    try {
      expect(readSessionNavigation(reopened, "s").cursor).toMatchObject({
        tabId: "tab-2",
        paneId: "pane-2",
      });
      expect(reopened.query("SELECT hex(data) AS data FROM terminal_chunks").get()).toEqual({
        data: "53454E54494E454C",
      });
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const active of ["tab-2", "missing"]) {
  test(`schema 4 migrates without losing resources or bytes (${active} legacy selection)`, () => {
    const db = stage2Fixture();
    try {
      db.run("UPDATE surfaces SET active_tab_id = ?", [active]);
      const before = [
        "sessions",
        "workspaces",
        "session_workspaces",
        "items",
        "tabs",
        "panes",
        "terminal_chunks",
      ].map((table) => db.query(`SELECT * FROM ${table}`).all());
      migrateStage2(db);
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        [
          "sessions",
          "workspaces",
          "session_workspaces",
          "items",
          "tabs",
          "panes",
          "terminal_chunks",
        ].map((table) => db.query(`SELECT * FROM ${table}`).all()),
      ).toEqual(before);
      expect(
        db
          .query<{ name: string }, []>("PRAGMA table_info(surfaces)")
          .all()
          .some((row) => row.name === "active_tab_id"),
      ).toBe(false);
      for (const sessionId of ["s", "other"]) {
        expect(readSessionNavigation(db, sessionId).cursor).toEqual({
          sessionId,
          generation: 0,
          workspaceId: "w",
          category: "inbox",
          itemId: "a",
          tabId: active === "missing" ? "tab-1" : "tab-2",
          paneId: active === "missing" ? "pane-1" : "pane-2",
        });
      }
      expect(
        db
          .query(
            "SELECT start_cursor,end_cursor,baseline_cols FROM terminal_grids WHERE pane_id = 'pane-1'",
          )
          .get(),
      ).toEqual({ start_cursor: 0, end_cursor: 8, baseline_cols: null });
    } finally {
      db.close();
    }
  });
}

for (const invalid of ["layout", "foreign key"] as const) {
  test(`a migration failure preserves schema 4 and sentinel data (${invalid})`, () => {
    const db = stage2Fixture();
    try {
      if (invalid === "layout") {
        db.exec(
          'UPDATE tabs SET layout_json = \'{"type":"split","ratio":2}\' WHERE id = \'tab-1\'',
        );
      } else {
        db.exec(
          "PRAGMA foreign_keys = OFF; UPDATE tabs SET surface_id = 'missing' WHERE id = 'tab-1'",
        );
      }
      const schema = db.query("SELECT sql FROM sqlite_master ORDER BY name").all();
      const data = db.query("SELECT * FROM terminal_chunks").all();
      expect(() => migrateStage2(db)).toThrow(/migrat|Invalid/i);
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 4 });
      expect(db.query("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
      expect(db.query("SELECT * FROM terminal_chunks").all()).toEqual(data);
      db.exec("BEGIN EXCLUSIVE; ROLLBACK");
    } finally {
      db.close();
    }
  });
}

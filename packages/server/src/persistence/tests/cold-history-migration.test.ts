import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TerminalHistory } from "../../terminal/history";
import { openDatabase } from "../database";
import { migrateStage2 } from "../stage-2-migration";
import { stage2Fixture } from "./stage-2.test-support";

test("schema 5 bytes, navigation and resizes survive the cold-history migration and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-cold-migration-"));
  const path = join(directory, "state.sqlite");
  const old = stage2Fixture(path);
  migrateStage2(old);
  old.exec("INSERT INTO terminal_resizes VALUES ('pane-1',1,4,20,5)");
  const navigation = old.query("SELECT * FROM session_navigation ORDER BY session_id").all();
  old.close();
  const db = openDatabase(path);
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(db.query("SELECT hex(data) AS data FROM terminal_chunks").get()).toEqual({
      data: "53454E54494E454C",
    });
    expect(db.query("SELECT * FROM session_navigation ORDER BY session_id").all()).toEqual(
      navigation,
    );
    expect(db.query("SELECT runtime_start FROM terminal_resizes").all()).toEqual([
      { runtime_start: null },
    ]);
    const history = new TerminalHistory(db);
    expect(history.readForRecovery("pane-1").starts).toEqual([]);
    expect(history.read("pane-1").resizes).toEqual([{ cursor: 4, sequence: 1, cols: 20, rows: 5 }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("new and schema-4 database opening reach schema 6 without losing sentinel bytes", async () => {
  const fresh = openDatabase(":memory:");
  try {
    expect(fresh.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
  } finally {
    fresh.close();
  }
  const directory = await mkdtemp(join(tmpdir(), "work-craft-cold-chain-"));
  const path = join(directory, "state.sqlite");
  stage2Fixture(path).close();
  const db = openDatabase(path);
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(db.query("SELECT hex(data) AS data FROM terminal_chunks").get()).toEqual({
      data: "53454E54494E454C",
    });
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

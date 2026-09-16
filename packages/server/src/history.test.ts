import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.ts";
import { TerminalHistory } from "./history.ts";

function databaseWithPane() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO sessions VALUES ('session-1', 'Main', 0);
    INSERT INTO workspaces VALUES ('workspace-1', 'session-1', 'Work', 0);
    INSERT INTO projects VALUES ('project-1', 'workspace-1', 'implementation', 'Work Craft', 0);
    INSERT INTO items VALUES ('item-1', 'project-1', 'surface', 'Build', 0, '{}', NULL);
    INSERT INTO surfaces VALUES ('surface-1', 'item-1', NULL);
    INSERT INTO panes VALUES (
      'pane-1', 'surface-1', 'terminal', 'Shell', '/tmp',
      '{"type":"shell","executable":"/bin/sh","args":[]}',
      'running', NULL, NULL, NULL
    );
  `);
  return db;
}

test("retains bounded output and marks truncation", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, {
    maxBytesPerPane: 8,
    flushBytes: 4,
    flushIntervalMs: 10,
  });
  history.append("pane-1", new TextEncoder().encode("1234"));
  history.append("pane-1", new TextEncoder().encode("56789"));
  await history.flush();
  const retained = history.read("pane-1");
  expect(retained.truncated).toBe(true);
  expect(new TextDecoder().decode(retained.data)).toContain("earlier terminal output truncated");
  await history.close();
  db.close();
});

test("reads from a retained cursor without repeating the truncation marker", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { maxBytesPerPane: 8, flushBytes: 100 });
  history.append("pane-1", new TextEncoder().encode("123456789"));
  await history.flush();

  const missing = history.read("pane-1", 4);
  expect(missing.cursor).toBe(9);
  expect(missing.truncated).toBe(false);
  expect(new TextDecoder().decode(missing.data)).toBe("56789");

  const stale = history.read("pane-1", 0);
  expect(stale.truncated).toBe(true);
  expect(new TextDecoder().decode(stale.data)).toEndWith("23456789");
  await history.close();
  db.close();
});

test("reads queued output before it is flushed", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { flushBytes: 100, flushIntervalMs: 1_000 });
  expect(history.append("pane-1", new TextEncoder().encode("queued"))).toBe(6);

  const current = history.read("pane-1");
  expect(current.cursor).toBe(6);
  expect(new TextDecoder().decode(current.data)).toBe("queued");
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(0);
  await history.close();
  db.close();
});

test("returns the cursor before a size-triggered batch is persisted", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { flushBytes: 4, flushIntervalMs: 1_000 });

  expect(history.append("pane-1", new TextEncoder().encode("1234"))).toBe(4);
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(0);
  await Bun.sleep(10);
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(1);
  await history.close();
  db.close();
});

test("retains the newest tail of a chunk larger than the limit", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { maxBytesPerPane: 4, flushBytes: 100 });
  history.append("pane-1", new TextEncoder().encode("oversized"));
  await history.flush();

  const current = history.read("pane-1");
  expect(current.cursor).toBe(9);
  expect(new TextDecoder().decode(current.data)).toEndWith("ized");
  expect(
    db
      .query<{ cursorStart: number; cursorEnd: number; data: Uint8Array }, []>(
        "SELECT cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks",
      )
      .get(),
  ).toEqual({ cursorStart: 5, cursorEnd: 9, data: new TextEncoder().encode("ized") });
  await history.close();
  db.close();
});

test("flushes queued output on its timer and on close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-history-"));
  const path = join(directory, "work-craft.db");
  const db = openDatabase(path);
  db.exec(`
    INSERT INTO sessions VALUES ('session-1', 'Main', 0);
    INSERT INTO workspaces VALUES ('workspace-1', 'session-1', 'Work', 0);
    INSERT INTO projects VALUES ('project-1', 'workspace-1', 'implementation', 'Work Craft', 0);
    INSERT INTO items VALUES ('item-1', 'project-1', 'surface', 'Build', 0, '{}', NULL);
    INSERT INTO surfaces VALUES ('surface-1', 'item-1', NULL);
    INSERT INTO panes VALUES ('pane-1', 'surface-1', 'terminal', 'Shell', '/tmp', '{"type":"shell","executable":"/bin/sh","args":[]}', 'running', NULL, NULL, NULL);
  `);
  const history = new TerminalHistory(db, { flushBytes: 100, flushIntervalMs: 10 });

  history.append("pane-1", new TextEncoder().encode("timer"));
  await Bun.sleep(30);
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(1);
  history.append("pane-1", new TextEncoder().encode(" close"));
  await history.close();
  db.close();

  const reopened = openDatabase(path);
  expect(new TextDecoder().decode(new TerminalHistory(reopened).read("pane-1").data)).toBe(
    "timer close",
  );
  reopened.close();
  await rm(directory, { recursive: true, force: true });
});

test("keeps a failed batch queued for an exact retry", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { flushBytes: 100, flushIntervalMs: 1_000 });
  db.exec(`
    CREATE TRIGGER fail_terminal_history BEFORE INSERT ON terminal_chunks
    BEGIN SELECT RAISE(FAIL, 'forced history failure'); END;
  `);
  expect(history.append("pane-1", new TextEncoder().encode("abc"))).toBe(3);

  await expect(history.flush()).rejects.toThrow("forced history failure");
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(0);
  expect(new TextDecoder().decode(history.read("pane-1").data)).toBe("abc");

  db.exec("DROP TRIGGER fail_terminal_history");
  await history.flush();
  await history.flush();
  expect(
    db
      .query<{ cursorStart: number; cursorEnd: number; data: Uint8Array }, []>(
        "SELECT cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks",
      )
      .all(),
  ).toEqual([{ cursorStart: 0, cursorEnd: 3, data: new TextEncoder().encode("abc") }]);
  await history.close();
  db.close();
});

test("timer flush failures stay queued without an unhandled rejection", async () => {
  const db = databaseWithPane();
  const history = new TerminalHistory(db, { flushBytes: 100, flushIntervalMs: 5 });
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  db.exec(`
    CREATE TRIGGER fail_terminal_history BEFORE INSERT ON terminal_chunks
    BEGIN SELECT RAISE(FAIL, 'forced timer failure'); END;
  `);

  try {
    history.append("pane-1", new TextEncoder().encode("timer"));
    await Bun.sleep(20);
    expect(unhandled).toEqual([]);
    expect(new TextDecoder().decode(history.read("pane-1").data)).toBe("timer");

    db.exec("DROP TRIGGER fail_terminal_history");
    await history.flush();
    expect(
      db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
    ).toBe(1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    db.exec("DROP TRIGGER IF EXISTS fail_terminal_history");
    await history.close();
    db.close();
  }
});

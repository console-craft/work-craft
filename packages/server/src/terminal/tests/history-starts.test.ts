import { expect, test } from "bun:test";

import { openDatabase } from "../../persistence/database";
import { TerminalHistory } from "../history";
import type { RuntimeStartMarker } from "../history-geometry";

function fixture(maxMarkers = 1024) {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO workspaces VALUES ('w','Work');
    INSERT INTO items VALUES ('item','w','design',NULL,'generic','Work',0,0,'{}');
    INSERT INTO surfaces VALUES ('surface','item');
    INSERT INTO panes (id,surface_id,kind,title,cwd,restore_policy_json,process_status)
      VALUES ('pane-1','surface','terminal','Shell','/','{"type":"shell","executable":"/bin/sh","args":[]}', 'interrupted');
  `);
  return { db, history: new TerminalHistory(db, { maxMarkers, flushIntervalMs: 60_000 }) };
}

test("unchanged-grid starts persist in exact same-cursor sequence order", async () => {
  const { db, history } = fixture();
  try {
    history.recordGrid("pane-1", { cols: 20, rows: 5 }, "fresh");
    history.append("pane-1", new TextEncoder().encode("old"));
    history.recordGrid("pane-1", { cols: 20, rows: 5 }, "restored");
    history.recordGrid("pane-1", { cols: 30, rows: 6 });
    history.recordGrid("pane-1", { cols: 30, rows: 6 }, "fresh");
    const expected: RuntimeStartMarker[] = [
      { cursor: 0, sequence: 1, cols: 20, rows: 5, runtimeStart: "fresh" },
      { cursor: 3, sequence: 2, cols: 20, rows: 5, runtimeStart: "restored" },
      { cursor: 3, sequence: 4, cols: 30, rows: 6, runtimeStart: "fresh" },
    ];
    expect(history.readForRecovery("pane-1").starts).toEqual(expected);
    const publicHistory = history.read("pane-1");
    expect(publicHistory).not.toHaveProperty("starts");
    for (const marker of publicHistory.resizes) {
      expect(Object.keys(marker).sort()).toEqual(["cols", "cursor", "rows", "sequence"]);
    }
    await history.flush();
    expect(new TerminalHistory(db).readForRecovery("pane-1").starts).toEqual(expected);
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_resizes").get()).toEqual({ n: 4 });
  } finally {
    await history.close();
    db.close();
  }
});

test("start storms share the 1024-marker truncation budget", async () => {
  const { db, history } = fixture();
  try {
    for (let i = 0; i < 2050; i++) {
      history.recordGrid("pane-1", { cols: 20, rows: 5 }, "fresh");
    }
    const retained = history.readForRecovery("pane-1");
    expect(retained.starts).toHaveLength(1024);
    expect(retained.starts[0]?.sequence).toBe(1027);
    expect(retained.truncated).toBe(true);
    expect(new TextDecoder().decode(retained.data)).toContain("earlier terminal output truncated");
    await history.flush();
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_resizes").get()).toEqual({ n: 1024 });
    expect(new TerminalHistory(db).readForRecovery("pane-1").starts).toEqual(retained.starts);
  } finally {
    await history.close();
    db.close();
  }
});

test("failed byte/start flush remains atomic and retryable", async () => {
  const { db, history } = fixture();
  try {
    history.recordGrid("pane-1", { cols: 20, rows: 5 }, "restored");
    history.append("pane-1", new TextEncoder().encode("durable"));
    db.exec(
      "CREATE TRIGGER fail_start BEFORE INSERT ON terminal_resizes BEGIN SELECT RAISE(ABORT, 'forced start failure'); END;",
    );
    await expect(history.flush()).rejects.toThrow("forced start failure");
    expect(db.query("SELECT * FROM terminal_chunks").all()).toEqual([]);
    expect(history.readForRecovery("pane-1").starts).toHaveLength(1);
    db.exec("DROP TRIGGER fail_start");
    await history.flush();
    await history.flush();
    expect(new TextDecoder().decode(new TerminalHistory(db).read("pane-1").data)).toBe("durable");
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_chunks").get()).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_resizes").get()).toEqual({ n: 1 });
  } finally {
    db.exec("DROP TRIGGER IF EXISTS fail_start");
    await history.close();
    db.close();
  }
});

test("corrupt persisted runtime-start kind rejects", async () => {
  const { db, history } = fixture();
  try {
    history.recordGrid("pane-1", { cols: 20, rows: 5 }, "fresh");
    await history.flush();
    db.exec(
      "PRAGMA ignore_check_constraints=ON; UPDATE terminal_resizes SET runtime_start='unknown'",
    );
    expect(() => new TerminalHistory(db).readForRecovery("pane-1")).toThrow(/persisted terminal/);
  } finally {
    await history.close();
    db.close();
  }
});

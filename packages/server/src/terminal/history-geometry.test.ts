import { expect, test } from "bun:test";

import { migrateStage2 } from "../persistence/stage-2-migration.ts";
import { stage2Fixture } from "../persistence/stage-2.test-support.ts";
import { HistoryGeometry } from "./history-geometry.ts";
import { TerminalHistory } from "./history.ts";

test("marker-only truncation preserves the next byte cursor after reopen", async () => {
  const { db, geometry } = fixture(2);
  try {
    for (const cols of [80, 90, 100]) {
      geometry.record("pane-2", 7, { cols, rows: 24 });
    }
    db.transaction(() => geometry.flush("pane-2", 7, 7))();
    geometry.committed("pane-2");
    const history = new TerminalHistory(db);
    try {
      expect(history.append("pane-2", new Uint8Array([120]))).toBe(8);
    } finally {
      await history.close();
    }
  } finally {
    db.close();
  }
});

function fixture(maxMarkers = 1024) {
  const db = stage2Fixture();
  migrateStage2(db);
  return { db, geometry: new HistoryGeometry(db, maxMarkers) };
}

test("resize markers preserve order at one byte cursor and suppress unchanged dimensions", () => {
  const { db, geometry } = fixture();
  try {
    for (const [cols, rows] of [
      [100, 30],
      [80, 24],
      [120, 40],
    ]) {
      geometry.record("pane-2", 7, { cols: cols!, rows: rows! });
    }
    expect(geometry.record("pane-2", 7, { cols: 120, rows: 40 })).toBeUndefined();
    const markers = geometry.read("pane-2", 0, 7).resizes;
    expect(markers.map(({ cursor }) => cursor)).toEqual([7, 7, 7]);
    expect(markers.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(markers.map(({ cols, rows }) => [cols, rows])).toEqual([
      [100, 30],
      [80, 24],
      [120, 40],
    ]);
    db.transaction(() => geometry.flush("pane-2", 0, 7))();
    geometry.committed("pane-2");
    expect(new HistoryGeometry(db).read("pane-2", 0, 7).resizes).toEqual(markers);
  } finally {
    db.close();
  }
});

test("a failed output/marker batch remains retryable and commits atomically", () => {
  const { db, geometry } = fixture();
  try {
    geometry.record("pane-1", 8, { cols: 100, rows: 30 });
    expect(() =>
      db.transaction(() => {
        db.exec(
          "INSERT INTO terminal_chunks (pane_id,cursor_start,cursor_end,data) VALUES ('pane-1',8,9,X'21')",
        );
        geometry.flush("pane-1", 0, 9);
        throw new Error("failed batch");
      })(),
    ).toThrow("failed batch");
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_resizes").get()).toEqual({ n: 0 });
    expect(db.query("SELECT MAX(cursor_end) AS tail FROM terminal_chunks").get()).toEqual({
      tail: 8,
    });
    expect(geometry.read("pane-1", 0, 9).resizes).toHaveLength(1);
    db.transaction(() => {
      db.exec(
        "INSERT INTO terminal_chunks (pane_id,cursor_start,cursor_end,data) VALUES ('pane-1',8,9,X'21')",
      );
      geometry.flush("pane-1", 0, 9);
    })();
    geometry.committed("pane-1");
    expect(new HistoryGeometry(db).read("pane-1", 0, 9).resizes).toHaveLength(1);
    expect(db.query("SELECT end_cursor FROM terminal_grids WHERE pane_id='pane-1'").get()).toEqual({
      end_cursor: 9,
    });
  } finally {
    db.close();
  }
});

test("zero-output resize storms retain bounded markers and a preceding baseline", () => {
  const { db, geometry } = fixture();
  try {
    for (let i = 0; i < 2050; i++) {
      geometry.record("pane-2", 0, { cols: 80 + (i % 2), rows: 24 });
    }
    const retained = geometry.read("pane-2", 0, 0);
    expect(retained.resizes).toHaveLength(1024);
    expect(retained.resizes[0]?.sequence).toBe(1027);
    expect(retained.initialGridSequence).toBe(1026);
    expect(retained.initialSize).toEqual({ cols: 81, rows: 24 });
    expect(retained.truncated).toBe(true);
    db.transaction(() => geometry.flush("pane-2", 0, 0))();
    geometry.committed("pane-2");
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_resizes").get()).toEqual({ n: 1024 });
    expect(new HistoryGeometry(db).read("pane-2", 0, 0)).toEqual(retained);
  } finally {
    db.close();
  }
});

test("byte trimming keeps earlier dimensions as baseline and same-boundary markers in order", () => {
  const { db, geometry } = fixture();
  try {
    geometry.record("pane-2", 0, { cols: 100, rows: 30 });
    geometry.record("pane-2", 4, { cols: 80, rows: 24 });
    geometry.record("pane-2", 4, { cols: 120, rows: 40 });
    expect(geometry.retentionStart("pane-2", 4)).toBe(4);
    const retained = geometry.read("pane-2", 4, 8);
    expect(retained.initialSize).toEqual({ cols: 100, rows: 30 });
    expect(retained.resizes.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(geometry.read("pane-2", 6, 8)).toMatchObject({
      initialSize: { cols: 120, rows: 40 },
      initialGridSequence: 3,
      resizes: [],
    });
  } finally {
    db.close();
  }
});

test("legacy output stays explicitly unknown until a new grid boundary", () => {
  const { db, geometry } = fixture();
  try {
    expect(geometry.read("pane-1", 0, 8)).toMatchObject({
      initialSize: null,
      initialGridSequence: null,
      resizes: [],
    });
    geometry.record("pane-1", 8, { cols: 80, rows: 24 });
    expect(geometry.read("pane-1", 0, 8)).toMatchObject({
      initialSize: null,
      resizes: [{ cursor: 8, sequence: 1, cols: 80, rows: 24 }],
    });
  } finally {
    db.close();
  }
});

test("trimming every byte still persists the monotonic tail independently of chunks", () => {
  const { db, geometry } = fixture(2);
  try {
    db.exec(
      "UPDATE terminal_chunks SET cursor_end=7,data=X'53454E54494E45'; UPDATE terminal_grids SET end_cursor=7 WHERE pane_id='pane-1'",
    );
    for (const cols of [80, 90, 100]) {
      geometry.record("pane-1", 7, { cols, rows: 24 });
    }
    const start = geometry.retentionStart("pane-1", 0);
    expect(start).toBe(7);
    db.transaction(() => {
      db.exec("DELETE FROM terminal_chunks WHERE pane_id='pane-1'");
      geometry.flush("pane-1", start, 7);
    })();
    geometry.committed("pane-1");
    expect(new HistoryGeometry(db).endCursor("pane-1")).toBe(7);
    expect(db.query("SELECT COUNT(*) AS n FROM terminal_chunks").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

test("deleting a pane cascades its persisted grid history", () => {
  const { db, geometry } = fixture();
  try {
    geometry.record("pane-1", 8, { cols: 100, rows: 30 });
    db.transaction(() => geometry.flush("pane-1", 0, 8))();
    geometry.committed("pane-1");
    db.transaction(() => {
      db.exec(
        "UPDATE session_navigation SET pane_id=NULL WHERE pane_id='pane-1'; DELETE FROM session_tab_panes WHERE pane_id='pane-1'; DELETE FROM panes WHERE id='pane-1'",
      );
    })();
    expect(db.query("SELECT * FROM terminal_grids WHERE pane_id='pane-1'").all()).toEqual([]);
    expect(db.query("SELECT * FROM terminal_resizes WHERE pane_id='pane-1'").all()).toEqual([]);
  } finally {
    db.close();
  }
});

for (const corrupt of ["partial baseline", "marker beyond tail"] as const) {
  test(`invalid persisted resize metadata rejects rather than guessing (${corrupt})`, () => {
    const { db } = fixture();
    try {
      if (corrupt === "partial baseline") {
        db.exec(
          "PRAGMA ignore_check_constraints=ON; UPDATE terminal_grids SET baseline_cols=NULL,baseline_rows=24,baseline_sequence=1 WHERE pane_id='pane-2'",
        );
      } else {
        db.exec("INSERT INTO terminal_resizes VALUES ('pane-2',1,2,80,24)");
      }
      expect(() => new HistoryGeometry(db).read("pane-2", 0, 2)).toThrow(/persisted terminal/);
    } finally {
      db.close();
    }
  });
}

test("invalid or backward resize records never enter history", () => {
  const { db, geometry } = fixture();
  try {
    expect(() => geometry.record("pane-1", 7, { cols: 80, rows: 24 })).toThrow(/cursor/);
    expect(() => geometry.record("pane-1", 8, { cols: 0, rows: 24 })).toThrow(/dimensions/);
    expect(() => geometry.record("pane-1", 8, { cols: 4096, rows: 4096 })).toThrow(/dimensions/);
    expect(geometry.read("pane-1", 0, 8).resizes).toEqual([]);
  } finally {
    db.close();
  }
});

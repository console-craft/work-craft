import { expect, test } from "bun:test";

import { databaseFixture } from "../../persistence/tests/database.test-support.ts";
import {
  normalizeSessionNavigations,
  readNavigationCatalog,
  readSessionNavigation,
  writeSessionNavigation,
} from "../navigation-store.ts";
import { selectNavigation } from "../navigation.ts";
import { readSnapshotState } from "../snapshot.ts";

test("navigation stays structural while snapshots reject invalid pane restore policies", () => {
  const db = databaseFixture();
  try {
    db.query("UPDATE panes SET restore_policy_json = ? WHERE id = ?").run(
      JSON.stringify({ type: "shell", executable: "", args: [] }),
      "pane-1",
    );
    expect(readNavigationCatalog(db).panes).toEqual([
      { id: "pane-1", surfaceId: "surface" },
      { id: "pane-2", surfaceId: "surface" },
    ]);
    expect(() => readSnapshotState(db, "epoch", 0)).toThrow(
      /panes\.restore_policy_json executable/,
    );
  } finally {
    db.close();
  }
});

test("session memories round-trip independently and unchanged writes are no-ops", () => {
  const db = databaseFixture();
  try {
    const initial = readSessionNavigation(db, "s");
    const changed = selectNavigation(readNavigationCatalog(db), initial, {
      kind: "tab",
      tabId: "tab-1",
    });
    expect(db.transaction(() => writeSessionNavigation(db, changed))()).toBe(true);
    expect(readSessionNavigation(db, "s")).toEqual(changed);
    expect(db.transaction(() => writeSessionNavigation(db, changed))()).toBe(false);
    expect(readSessionNavigation(db, "other").cursor).toMatchObject({
      tabId: "tab-2",
      paneId: "pane-2",
      generation: 0,
    });
  } finally {
    db.close();
  }
});

test("archive normalization repairs every attached session in the caller transaction", () => {
  const db = databaseFixture();
  try {
    const before = readNavigationCatalog(db);
    db.transaction(() => {
      db.exec("UPDATE items SET archived = 1 WHERE id = 'a'");
      expect(normalizeSessionNavigations(db, before)).toBe(true);
    })();
    for (const sessionId of ["s", "other"]) {
      expect(readSessionNavigation(db, sessionId).cursor).toMatchObject({
        itemId: "b",
        tabId: null,
        paneId: null,
        generation: 1,
      });
    }
    expect(db.query("SELECT COUNT(*) AS count FROM panes").get()).toEqual({ count: 2 });
    expect(db.query("SELECT hex(data) AS data FROM terminal_chunks").get()).toEqual({
      data: "53454E54494E454C",
    });
    expect(db.transaction(() => normalizeSessionNavigations(db, readNavigationCatalog(db)))()).toBe(
      false,
    );
  } finally {
    db.close();
  }
});

test("cursor writes roll back with their structural mutation", () => {
  const db = databaseFixture();
  try {
    const before = readNavigationCatalog(db);
    expect(() =>
      db.transaction(() => {
        db.exec("UPDATE items SET archived = 1 WHERE id = 'a'");
        normalizeSessionNavigations(db, before);
        throw new Error("abort mutation");
      })(),
    ).toThrow("abort mutation");
    expect(readSessionNavigation(db, "s").cursor).toMatchObject({
      itemId: "a",
      tabId: "tab-2",
      generation: 0,
    });
    expect(db.query("SELECT archived FROM items WHERE id = 'a'").get()).toEqual({ archived: 0 });
  } finally {
    db.close();
  }
});

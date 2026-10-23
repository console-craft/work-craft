import type { Database } from "bun:sqlite";

/** Add presentation-only runtime boundaries without rewriting retained output. */
export function migrateColdHistory(db: Database): void {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version !== 5) {
    throw new Error(`Cannot migrate schema ${version}: expected Work Craft schema 5`);
  }
  try {
    db.transaction(() => {
      if (db.query("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Invalid foreign keys before migration");
      }
      db.exec(
        "ALTER TABLE terminal_resizes ADD COLUMN runtime_start TEXT CHECK(runtime_start IN ('fresh','restored'))",
      );
      db.exec("PRAGMA user_version = 6");
    })();
  } catch (cause) {
    throw new Error(
      `Work Craft schema 5 to 6 migration failed; no data was changed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

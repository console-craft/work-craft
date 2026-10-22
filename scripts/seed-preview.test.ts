import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createClient } from "../packages/server/src/client";
import { stopPreview } from "./preview-command";
import { seedPreview } from "./seed-preview";

test("preview seeding uses the real binary, refuses implicit resets and preserves unrelated files", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR!, "opencode", "seed-"));
  const executable = join(directory, "preview binary");
  const home = join(directory, "home");
  const cwd = resolve(import.meta.dir, "..");
  const build = Bun.spawn(
    [process.execPath, "build", "--compile", "src/preview.ts", "--outfile", executable],
    { cwd, stdout: "ignore", stderr: "pipe" },
  );
  try {
    expect(await build.exited).toBe(0);
    const defaultHome = join(directory, "work-craft-preview");
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_STATE_HOME: directory, SHELL: "/bin/sh" };
    delete env.WORK_CRAFT_HOME;
    const status = Bun.spawn([executable, "daemon", "status", "--json"], {
      env,
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      expect(await status.exited).toBe(0);
      expect(
        (await createClient({ socketPath: join(defaultHome, "work-craft.sock") }).health())
          .protocol,
      ).toBe("work-craft-projection-preview/1");
    } finally {
      await stopPreview(executable, defaultHome);
    }
    const first = await seedPreview({ home, executable, cwd, reset: false });
    expect(first.snapshot.sessions.map((session) => session.name)).toEqual(["Playground", "Focus"]);
    expect(first.snapshot.items).toHaveLength(5);
    expect(first.snapshot.tabs).toHaveLength(2);
    expect(first.snapshot.panes).toHaveLength(3);
    expect(first.snapshot.sessionWorkspaces).toHaveLength(2);
    expect(
      first.snapshot.panes.every((pane) => pane.cwd === cwd && pane.processStatus === "running"),
    ).toBe(true);
    expect(first.snapshot.navigation.every((cursor) => cursor.itemId === first.itemId)).toBe(true);
    expect(existsSync(join(home, "work-craft.sock"))).toBe(false);
    expect(existsSync(join(home, "daemon.lock"))).toBe(false);
    await writeFile(join(home, "unrelated"), "keep me");
    await expect(seedPreview({ home, executable, cwd, reset: false })).rejects.toThrow("reset");
    const second = await seedPreview({ home, executable, cwd, reset: true });
    expect(second.backup).toBeDefined();
    expect(await readFile(join(home, "unrelated"), "utf8")).toBe("keep me");
    const backup = new Database(second.backup!, { readonly: true });
    try {
      expect(backup.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(
        backup.query("SELECT id FROM sessions WHERE id = ?").get(first.snapshot.sessions[0]!.id),
      ).not.toBeNull();
    } finally {
      backup.close();
    }
    const db = new Database(join(home, "work-craft.sqlite"), { readonly: true });
    try {
      const row = db
        .query("SELECT restore_policy_json FROM panes WHERE id = ?")
        .get(second.examplePaneId) as { restore_policy_json: string };
      expect(row.restore_policy_json).toContain("Regional indicators");
      expect(row.restore_policy_json).toContain("🇦🇧");
    } finally {
      db.close();
    }
  } finally {
    await stopPreview(executable, home);
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

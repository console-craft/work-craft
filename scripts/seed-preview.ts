import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  type Command,
  type CommandResponse,
  createClient,
  type Snapshot,
} from "../packages/server/src/client";
import { runPreview, stopPreview } from "./preview-command";

export type PreviewSeedResult = {
  home: string;
  backup?: string;
  snapshot: Snapshot;
  itemId: string;
  examplePaneId: string;
};
type CommandResult = CommandResponse["result"];

function integrity(path: string): void {
  const db = new Database(path, { readonly: true });
  try {
    assert.deepEqual(db.query("PRAGMA integrity_check").get(), { integrity_check: "ok" });
  } finally {
    db.close();
  }
}

const example =
  "printf '\\033[2J\\033[HStock OpenTUI preview\\r\\nRegional indicators\\r\\nKnown spacing defect:\\r\\n01234567890123456789\\r\\nRI: |🇦🇧|X (X at col 10)\\r\\nWide: |界🙂| |é|\\r\\nBlanks: |\\033[48;2;68;85;102m     \\033[0m|\\r\\n\\r\\nType below; demo returns\\r\\nafter daemon restart.\\r\\n'; exec /bin/sh -i";

/** Seeds only named application records; reset preserves a verified, stopped SQLite backup. */
export async function seedPreview(options: {
  home: string;
  executable: string;
  cwd: string;
  reset: boolean;
}): Promise<PreviewSeedResult> {
  const { home, executable, reset } = options;
  assert(
    isAbsolute(home) && isAbsolute(executable),
    "Preview home and executable must be absolute",
  );
  const cwd = await realpath(options.cwd);
  const database = join(home, "work-craft.sqlite");
  const existing = [database, join(home, "work-craft.sock"), join(home, "daemon.lock")].some(
    existsSync,
  );
  if (existing && !reset) {
    throw new Error(`Existing preview state; explicit reset required: ${home}`);
  }
  let backup: string | undefined;
  if (existing) {
    await stopPreview(executable, home);
    if (await Bun.file(database).exists()) {
      integrity(database);
      await mkdir(join(home, "backups"), { recursive: true, mode: 0o700 });
      backup = join(
        home,
        "backups",
        `before-reseed-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
      );
      const source = new Database(database, { readonly: true });
      try {
        source.query("VACUUM INTO ?").run(backup);
      } finally {
        source.close();
      }
      await chmod(backup, 0o600);
      integrity(backup);
    }
    await runPreview(executable, home, ["daemon", "destroy", "--force", "--json"]);
  }
  const client = createClient({ socketPath: join(home, "work-craft.sock") });
  async function command(value: Command): Promise<CommandResult> {
    return (await client.command(value)).result;
  }
  let result: PreviewSeedResult;
  try {
    await runPreview(executable, home, ["daemon", "status", "--json"], cwd);
    const playground = await command({ type: "session.create", name: "Playground" });
    const focus = await command({ type: "session.create", name: "Focus" });
    const workspace = await command({
      type: "workspace.create",
      sessionId: playground.id,
      name: "Shared preview",
    });
    await command({
      type: "session.workspace.add",
      sessionId: focus.id,
      workspaceId: workspace.id,
    });
    const items: CommandResult[] = [];
    for (const title of [
      "Rendering playground",
      "Focus experiments",
      "Unicode notes",
      "Shell practice",
      "Scratchpad",
    ]) {
      items.push(
        await command({
          type: "item.create",
          workspaceId: workspace.id,
          category: "design",
          title,
        }),
      );
    }
    const itemId = items[0]!.id;
    const surface = await command({ type: "surface.ensure", itemId, cwd });
    await command({ type: "pane.split", paneId: surface.paneId!, direction: "vertical", cwd });
    await command({ type: "tab.create", surfaceId: surface.surfaceId!, title: "Second shell" });
    for (const session of [playground, focus]) {
      await command({ type: "session.openItem", sessionId: session.id, itemId, cwd });
      await command({
        type: "session.navigate",
        sessionId: session.id,
        target: { kind: "pane", paneId: surface.paneId! },
      });
    }
    const snapshot = await client.snapshot();
    assert.equal(snapshot.sessions.length, 2);
    assert.equal(snapshot.items.length, 5);
    assert.equal(snapshot.tabs.length, 2);
    assert.equal(snapshot.panes.length, 3);
    assert(snapshot.panes.every((pane) => pane.cwd === cwd && pane.processStatus === "running"));
    result = { home, backup, snapshot, itemId, examplePaneId: surface.paneId! };
  } finally {
    await stopPreview(executable, home);
  }
  const db = new Database(database);
  try {
    const update = db
      .query("UPDATE panes SET restore_policy_json = ? WHERE id = ?")
      .run(
        JSON.stringify({ type: "shell", executable: "/bin/sh", args: ["-c", example] }),
        result.examplePaneId,
      );
    assert.equal(update.changes, 1);
  } finally {
    db.close();
  }
  integrity(database);
  await Bun.write(join(home, "preview-seed.json"), `${JSON.stringify(result, null, 2)}\n`);
  await chmod(join(home, "preview-seed.json"), 0o600);
  return result;
}

if (import.meta.main) {
  const home = process.argv[2];
  assert(home, "Usage: bun scripts/seed-preview.ts <absolute-home> [--reset]");
  const result = await seedPreview({
    home,
    executable: resolve("dist/work-craft-preview"),
    cwd: resolve(import.meta.dir, ".."),
    reset: process.argv.includes("--reset"),
  });
  console.log(
    JSON.stringify(
      {
        home: result.home,
        backup: result.backup,
        sessions: result.snapshot.sessions,
        itemId: result.itemId,
        examplePaneId: result.examplePaneId,
      },
      null,
      2,
    ),
  );
}

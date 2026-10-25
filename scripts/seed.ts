import { resolve } from "node:path";

import type { CommandResponse, Snapshot } from "../packages/server/src/client.ts";

const root = resolve(import.meta.dir, "..");

async function cli<T = CommandResponse["result"]>(...args: string[]): Promise<T> {
  const child = Bun.spawn([process.execPath, resolve(root, "src/main.ts"), ...args, "--json"], {
    cwd: root,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${args.join(" ")}: ${stderr.trim() || `exit ${code}`}`);
  }
  return JSON.parse(stdout) as T;
}

async function seed(): Promise<void> {
  const home = process.env.WORK_CRAFT_HOME;
  if (!home?.trim()) {
    throw new Error("Set an explicit WORK_CRAFT_HOME before seeding.");
  }
  process.env.WORK_CRAFT_HOME = resolve(home);
  const snapshot = await cli<Snapshot>("snapshot");
  const resources = [
    "sessions",
    "workspaces",
    "sessionWorkspaces",
    "items",
    "navigation",
    "surfaces",
    "tabs",
    "panes",
  ] as const;
  if (resources.some((key) => snapshot[key].length > 0)) {
    throw new Error(
      "The selected Work Craft home is not empty; reset it explicitly before seeding.",
    );
  }

  const firstSession = await cli("session", "create", "--name", "Session 1");
  const secondSession = await cli("session", "create", "--name", "Session 2");
  let firstItemId = "";
  for (const number of [1, 2]) {
    const workspace = await cli(
      "workspace",
      "create",
      "--session",
      firstSession.id,
      "--name",
      `Workspace ${number}`,
    );
    await cli("session", "add-workspace", secondSession.id, "--workspace", workspace.id);
    for (const [category, title, count] of [
      ["inbox", "Inbox", 3],
      ["today", "Today", 2],
    ] as const) {
      for (let index = 1; index <= count; index++) {
        const item = await cli(
          "item",
          "create",
          "--workspace",
          workspace.id,
          "--category",
          category,
          "--title",
          `${title} Item ${index}`,
        );
        firstItemId ||= item.id;
      }
    }
  }
  const surface = await cli("surface", "ensure", "--item", firstItemId, "--cwd", root);
  await cli("tab", "create", "--surface", surface.id, "--title", "Tab 2");
  for (let index = 0; index < 2; index++) {
    await cli("pane", "split", surface.paneId!, "--direction", "vertical", "--cwd", root);
  }
  await cli("session", "select", firstSession.id, "--pane", surface.paneId!);
  // shortcut: observe startup after 250 ms; use explicit shell readiness if stronger guarantees are needed.
  await Bun.sleep(250);
  const seeded = await cli<Snapshot>("snapshot");
  if (
    seeded.panes.length !== 4 ||
    seeded.panes.some(({ processStatus }) => processStatus !== "running")
  ) {
    throw new Error("Expected four running shell panes; check SHELL and pane process status.");
  }
  const quotedHome = `'${process.env.WORK_CRAFT_HOME.replaceAll("'", "'\\''")}'`;
  console.log(
    `Seeded ${process.env.WORK_CRAFT_HOME} with two sessions, two workspaces and four live shell panes.`,
  );
  console.log(`Launch: WORK_CRAFT_HOME=${quotedHome} bun run tui`);
}

try {
  await seed();
} catch (error) {
  console.error(
    `Seed failed: ${error instanceof Error ? error.message : String(error)} Partial state may remain; inspect it or reset explicitly.`,
  );
  process.exitCode = 1;
}

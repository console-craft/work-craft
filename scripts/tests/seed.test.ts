import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  type ControlSnapshot,
  createClient,
  type LayoutNode,
} from "../../packages/server/src/client.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SEED = join(ROOT, "scripts/seed.ts");

async function runSeed(home: string | undefined, env: NodeJS.ProcessEnv = {}, cwd = ROOT) {
  const child = Bun.spawn([process.execPath, SEED], {
    cwd,
    env: { ...process.env, SHELL: "/bin/sh", ...env, WORK_CRAFT_HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "work-craft-seed-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  return {
    home,
    client,
    async close() {
      if (existsSync(socketPath)) {
        await client.command({ type: "daemon.stop" });
      }
      const deadline = Date.now() + 3_000;
      while (
        (existsSync(socketPath) || existsSync(join(home, "daemon.lock"))) &&
        Date.now() < deadline
      ) {
        await Bun.sleep(20);
      }
      if (existsSync(socketPath) || existsSync(join(home, "daemon.lock"))) {
        throw new Error(`Seed test daemon did not stop; preserving ${home}`);
      }
      await rm(home, { recursive: true, force: true });
    },
  };
}

function structure(snapshot: ControlSnapshot) {
  return {
    sessions: snapshot.sessions,
    workspaces: snapshot.workspaces,
    sessionWorkspaces: snapshot.sessionWorkspaces,
    items: snapshot.items,
    navigation: snapshot.navigation,
    surfaces: snapshot.surfaces,
    tabs: snapshot.tabs,
    panes: snapshot.panes,
  };
}

function leaves(layout: LayoutNode): string[] {
  if (layout.type === "pane") {
    return [layout.paneId];
  }
  expect(layout.direction).toBe("vertical");
  return [...leaves(layout.first), ...leaves(layout.second)];
}

test("seed creates live UX resources and refuses repeated or orphan-workspace seeding", async () => {
  const { home, client, close } = await fixture();
  try {
    const result = await runSeed(home);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(home);
    const snapshot = await client.controlSnapshot();
    expect(snapshot.sessions.map(({ name }) => name)).toEqual(["Session 1", "Session 2"]);
    expect(snapshot.workspaces.map(({ name }) => name).sort()).toEqual([
      "Workspace 1",
      "Workspace 2",
    ]);
    for (const session of snapshot.sessions) {
      expect(
        snapshot.sessionWorkspaces
          .filter(({ sessionId }) => sessionId === session.id)
          .map(({ workspaceId }) => workspaceId)
          .sort(),
      ).toEqual(snapshot.workspaces.map(({ id }) => id).sort());
    }
    for (const workspace of snapshot.workspaces) {
      for (const [category, titles] of [
        ["inbox", ["Inbox Item 1", "Inbox Item 2", "Inbox Item 3"]],
        ["today", ["Today Item 1", "Today Item 2"]],
      ] as const) {
        expect(
          snapshot.items
            .filter((item) => item.workspaceId === workspace.id && item.category === category)
            .map(({ title }) => title),
        ).toEqual([...titles]);
      }
    }
    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.surfaces).toHaveLength(1);
    expect(snapshot.tabs.map(({ title }) => title)).toEqual(["Main", "Tab 2"]);
    const paneIds = leaves(snapshot.tabs[0]!.layout!);
    expect(new Set(paneIds).size).toBe(3);
    expect(snapshot.panes).toHaveLength(4);
    expect(snapshot.panes.every(({ processStatus }) => processStatus === "running")).toBe(true);
    expect(snapshot.panes.every(({ cwd }) => cwd === ROOT)).toBe(true);
    expect(
      snapshot.navigation.find(({ sessionId }) => sessionId === snapshot.sessions[0]!.id),
    ).toMatchObject({
      itemId: snapshot.surfaces[0]!.itemId,
      tabId: snapshot.tabs[0]!.id,
      paneId: paneIds[0],
    });

    const repeated = await runSeed(home);
    expect(repeated.code).not.toBe(0);
    expect(repeated.stderr).toMatch(/nonempty|not empty/i);
    expect(structure(await client.controlSnapshot())).toEqual(structure(snapshot));
    for (const session of snapshot.sessions) {
      await client.command({ type: "session.delete", sessionId: session.id });
    }
    const orphaned = await client.controlSnapshot();
    expect(orphaned.sessions).toEqual([]);
    expect(orphaned.workspaces).toHaveLength(2);
    const refused = await runSeed(home);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/nonempty|not empty/i);
    expect(structure(await client.controlSnapshot())).toEqual(structure(orphaned));
  } finally {
    await close();
  }
}, 30_000);

test("seed requires an explicit nonblank home before creating any state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-seed-guard-"));
  try {
    for (const home of [undefined, "", "   "]) {
      const result = await runSeed(home, { XDG_STATE_HOME: directory }, directory);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/explicit.*WORK_CRAFT_HOME/i);
      expect(await readdir(directory)).toEqual([]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("seed propagates shell failures without deleting partial state or claiming success", async () => {
  for (const failure of ["missing", "exits"]) {
    const { home, client, close } = await fixture();
    try {
      const shell = join(home, "test-shell");
      if (failure === "exits") {
        await writeFile(shell, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      }
      const result = await runSeed(home, { SHELL: shell });
      const snapshot = await client.controlSnapshot();
      expect(result.code, JSON.stringify({ failure, result, panes: snapshot.panes })).not.toBe(0);
      expect(result.stderr).toMatch(/partial state/i);
      expect(result.stdout).not.toContain("Seeded");
      expect(snapshot.sessions).toHaveLength(2);
      expect(snapshot.items).toHaveLength(10);
      expect(
        snapshot.panes.some(
          ({ processStatus }) => processStatus === (failure === "missing" ? "failed" : "exited"),
        ),
      ).toBe(true);
    } finally {
      await close();
    }
  }
}, 30_000);

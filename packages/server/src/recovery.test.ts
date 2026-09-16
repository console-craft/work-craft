import { expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import { openDatabase } from "./database.ts";
import { decodeBytes, type Snapshot } from "./protocol.ts";

type AppOwner = { app: WorkCraftApp; db: Database };

function decodeHistory(snapshot: Snapshot, paneId: string): string {
  const history = snapshot.terminalHistories.find((entry) => entry.paneId === paneId);
  return history === undefined ? "" : new TextDecoder().decode(decodeBytes(history.data));
}

async function waitForHistory(app: WorkCraftApp, paneId: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (decodeHistory(app.snapshot(), paneId).includes(text)) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for pane history: ${text}`);
}

async function persistentAppFixture() {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-recovery-"));
  const databasePath = join(directory, "work-craft.db");
  const startsPath = join(directory, "starts");
  const shellPath = join(directory, "shell");
  await writeFile(
    shellPath,
    '#!/bin/sh\nprintf x >> "$1"\ntrap "exit 0" TERM\nwhile :; do sleep 0.1; done\n',
  );
  await chmod(shellPath, 0o755);
  let owner: AppOwner | undefined = {
    db: openDatabase(databasePath),
    app: undefined as unknown as WorkCraftApp,
  };
  owner.app = createApp({ db: owner.db });

  async function stop(preserveStatus = false): Promise<void> {
    if (owner === undefined) {
      return;
    }
    await owner.app.runtime.stopAll({ preserveStatus });
    await owner.app.history.close();
    owner.db.close();
    owner = undefined;
  }

  return {
    get app() {
      if (owner === undefined) {
        throw new Error("Fixture app is not running");
      }
      return owner.app;
    },
    async openShellAndWrite(command: string): Promise<string> {
      const app = this.app;
      const session = await app.execute({ type: "session.create", name: "Main" });
      const workspace = await app.execute({
        type: "workspace.create",
        sessionId: session.result.id,
        name: "Work",
      });
      const project = await app.execute({
        type: "project.create",
        workspaceId: workspace.result.id,
        category: "implementation",
        name: "Work Craft",
      });
      const item = await app.execute({
        type: "item.create",
        projectId: project.result.id,
        kind: "surface",
        title: "Cold recovery",
        data: { durable: true },
      });
      const opened = applyCommand(owner!.db, {
        type: "surface.open",
        itemId: item.result.id,
        cwd: process.cwd(),
      });
      const paneId = opened.result.paneId!;
      owner!.db.run("UPDATE panes SET restore_policy_json = ? WHERE id = ?", [
        JSON.stringify({
          type: "shell",
          executable: "/bin/sh",
          args: [
            "-c",
            'read command; eval "$command"; trap "exit 0" TERM; while :; do sleep 0.1; done',
          ],
        }),
        paneId,
      ]);
      await app.runtime.start(app.snapshot().panes.find(({ id }) => id === paneId)!);
      owner!.db.run("UPDATE panes SET restore_policy_json = ? WHERE id = ?", [
        JSON.stringify({ type: "shell", executable: shellPath, args: [startsPath] }),
        paneId,
      ]);
      app.receive({
        type: "terminal.input",
        paneId,
        data: Buffer.from(`${command}\n`).toString("base64"),
      });
      await waitForHistory(app, paneId, "before-restart");
      return paneId;
    },
    async crash(): Promise<void> {
      await stop(true);
    },
    setPaneRestore(
      paneId: string,
      values: { cwd?: string; executable?: string; args?: string[] },
    ): void {
      const pane = this.app.snapshot().panes.find(({ id }) => id === paneId)!;
      owner!.db.run("UPDATE panes SET cwd = ?, restore_policy_json = ? WHERE id = ?", [
        values.cwd ?? pane.cwd,
        JSON.stringify({
          type: "shell",
          executable: values.executable ?? pane.restorePolicy.executable,
          args: values.args ?? pane.restorePolicy.args,
        }),
        paneId,
      ]);
    },
    addRunningPaneAfter(paneId: string): string {
      const snapshot = this.app.snapshot();
      const pane = snapshot.panes.find(({ id }) => id === paneId)!;
      const tab = snapshot.tabs.find(({ surfaceId }) => surfaceId === pane.surfaceId)!;
      const nextPaneId = `${paneId}-next`;
      owner!.db.run(
        "INSERT INTO panes (id, surface_id, kind, title, cwd, restore_policy_json, process_status) VALUES (?, ?, 'terminal', 'Shell', ?, ?, 'running')",
        [
          nextPaneId,
          pane.surfaceId,
          pane.cwd,
          JSON.stringify({ type: "shell", executable: shellPath, args: [startsPath] }),
        ],
      );
      owner!.db.run("UPDATE tabs SET layout_json = ? WHERE id = ?", [
        JSON.stringify({
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: tab.layout,
          second: { type: "pane", paneId: nextPaneId },
        }),
        tab.id,
      ]);
      return nextPaneId;
    },
    async restart(): Promise<AppOwner> {
      const db = openDatabase(databasePath);
      const app = createApp({ db });
      owner = { app, db };
      await app.recover();
      return owner;
    },
    async startCount(): Promise<number> {
      try {
        return (await readFile(startsPath, "utf8")).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return 0;
        }
        throw error;
      }
    },
    async waitForStartCount(count: number): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await this.startCount()) === count) {
          return;
        }
        await Bun.sleep(10);
      }
      throw new Error(`Timed out waiting for ${count} shell starts`);
    },
    async close(): Promise<void> {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function expectDurableStatePreserved(before: Snapshot, after: Snapshot, paneId: string): void {
  const pane = before.panes.find(({ id }) => id === paneId)!;
  expect(after.sessions).toEqual(before.sessions);
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.projects).toEqual(before.projects);
  expect(after.items).toEqual(before.items);
  expect(after.surfaces).toEqual(before.surfaces);
  expect(after.tabs).toEqual(before.tabs);
  expect(after.panes.find(({ id }) => id === paneId)).toMatchObject({
    id: pane.id,
    surfaceId: pane.surfaceId,
    kind: pane.kind,
    title: pane.title,
    cwd: pane.cwd,
    restorePolicy: pane.restorePolicy,
    processStatus: "failed",
    errorText: expect.any(String),
  });
  expect(decodeHistory(after, paneId)).toContain(decodeHistory(before, paneId));
  expect(
    decodeHistory(after, paneId).split("[work-craft: daemon restarted; shell restored]").length - 1,
  ).toBe(1);
}

test("restores hierarchy, history, layout, and one shell after restart", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    const before = fixture.app.snapshot();
    await fixture.crash();

    const restarted = await fixture.restart();
    const snapshot = restarted.app.snapshot();

    expect(snapshot.sessions).toEqual(before.sessions);
    expect(snapshot.workspaces).toEqual(before.workspaces);
    expect(snapshot.projects).toEqual(before.projects);
    expect(snapshot.items).toEqual(before.items);
    expect(snapshot.surfaces).toEqual(before.surfaces);
    expect(snapshot.tabs).toEqual(before.tabs);
    expect(snapshot.panes.find((pane) => pane.id === paneId)).toMatchObject({
      cwd: process.cwd(),
      restorePolicy: before.panes[0]!.restorePolicy,
      processStatus: "running",
      errorText: null,
    });
    expect(decodeHistory(snapshot, paneId)).toContain("before-restart");
    expect(decodeHistory(snapshot, paneId)).toContain(
      "\r\n[work-craft: daemon restarted; shell restored]\r\n",
    );
    await fixture.waitForStartCount(1);

    await restarted.app.recover();
    expect(await fixture.startCount()).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("preserves durable pane state when its working directory is missing", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    const cwd = join(tmpdir(), `work-craft-missing-${crypto.randomUUID()}`);
    fixture.setPaneRestore(paneId, { cwd });
    const before = fixture.app.snapshot();
    await fixture.crash();

    const restarted = await fixture.restart();
    const snapshot = restarted.app.snapshot();

    expectDurableStatePreserved(before, snapshot, paneId);
    expect(snapshot.panes.find(({ id }) => id === paneId)).toMatchObject({
      cwd,
      restorePolicy: before.panes[0]!.restorePolicy,
      processStatus: "failed",
      errorText: `Working directory does not exist: ${cwd}`,
    });
    await restarted.app.recover();
    expect(restarted.app.snapshot().panes.find(({ id }) => id === paneId)?.errorText).toBe(
      `Working directory does not exist: ${cwd}`,
    );
  } finally {
    await fixture.close();
  }
});

test("preserves durable pane state when its shell executable is missing", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    const executable = join(tmpdir(), `work-craft-missing-${crypto.randomUUID()}`);
    fixture.setPaneRestore(paneId, { executable, args: ["--durable"] });
    const continuedPaneId = fixture.addRunningPaneAfter(paneId);
    const before = fixture.app.snapshot();
    await fixture.crash();

    const restarted = await fixture.restart();
    const snapshot = restarted.app.snapshot();

    expectDurableStatePreserved(before, snapshot, paneId);
    expect(snapshot.panes.find(({ id }) => id === paneId)).toMatchObject({
      cwd: process.cwd(),
      restorePolicy: { type: "shell", executable, args: ["--durable"] },
      processStatus: "failed",
      errorText: `Shell executable not found: ${executable}`,
    });
    expect(snapshot.panes.find(({ id }) => id === continuedPaneId)?.processStatus).toBe("running");
    await fixture.waitForStartCount(1);
    await restarted.app.recover();
    expect(restarted.app.snapshot().panes.find(({ id }) => id === paneId)?.errorText).toBe(
      `Shell executable not found: ${executable}`,
    );
  } finally {
    await fixture.close();
  }
});

import type { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRenderLib } from "@opentui/core";

import { decodeBytes, type Snapshot } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";

type AppOwner = { app: WorkCraftApp; db: Database };

function decodeHistory(snapshot: Snapshot, paneId: string): string {
  const history = snapshot.terminalHistories.find((entry) => entry.paneId === paneId);
  return history === undefined ? "" : new TextDecoder().decode(decodeBytes(history.data));
}

async function waitForHistory(
  app: WorkCraftApp,
  paneId: string,
  text: string | RegExp,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const output = decodeHistory(app.snapshot(), paneId);
    if (typeof text === "string" ? output.includes(text) : text.test(output)) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(
    `Timed out waiting for pane history: ${text}\n${JSON.stringify(decodeHistory(app.snapshot(), paneId).slice(-4096))}`,
  );
}

async function persistentAppFixture() {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-recovery-"));
  const databasePath = join(directory, "work-craft.db");
  const startsPath = join(directory, "starts");
  const shellPath = join(directory, "shell");
  await writeFile(
    shellPath,
    '#!/bin/sh\nexec 2>/dev/null\nprintf x >> "$1"\ntrap "exit 0" TERM\nwhile :; do sleep 0.1; done\n',
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
    get db() {
      if (owner === undefined) {
        throw new Error("Fixture app is not running");
      }
      return owner.db;
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
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        title: "Work Craft",
      });
      const item = await app.execute({
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        parentId: project.result.id,
        title: "Cold recovery",
        data: { durable: true },
      });
      const opened = applyCommand(owner!.db, {
        type: "surface.ensure",
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
            'read -r command; eval "$command"; trap "exit 0" TERM; while :; do sleep 0.1; done',
          ],
        }),
        paneId,
      ]);
      await app.runtime.start(app.snapshot().panes.find(({ id }) => id === paneId)!);
      owner!.db.run("UPDATE panes SET restore_policy_json = ? WHERE id = ?", [
        JSON.stringify({ type: "shell", executable: shellPath, args: [startsPath] }),
        paneId,
      ]);
      app.runtime.write(paneId, new TextEncoder().encode(`${command}\n`));
      await waitForHistory(app, paneId, "before-restart");
      return paneId;
    },
    async commitInterruptedShell(): Promise<string> {
      const session = await this.app.execute({ type: "session.create", name: "Main" });
      const workspace = await this.app.execute({
        type: "workspace.create",
        sessionId: session.result.id,
        name: "Work",
      });
      const project = await this.app.execute({
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        title: "Work Craft",
      });
      const item = await this.app.execute({
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        parentId: project.result.id,
        title: "Committed shell",
      });
      const opened = applyCommand(owner!.db, {
        type: "surface.ensure",
        itemId: item.result.id,
        cwd: process.cwd(),
      });
      const paneId = opened.result.paneId!;
      owner!.db.run("UPDATE panes SET restore_policy_json = ? WHERE id = ?", [
        JSON.stringify({ type: "shell", executable: shellPath, args: [startsPath] }),
        paneId,
      ]);
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
    reopen(): AppOwner {
      const db = openDatabase(databasePath);
      const app = createApp({ db });
      owner = { app, db };
      return owner;
    },
    async restart(): Promise<AppOwner> {
      const reopened = this.reopen();
      await reopened.app.recover();
      return reopened;
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
  expect(after.items).toEqual(before.items);
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
    expect(snapshot.items).toEqual(before.items);
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

function materialText(app: WorkCraftApp, paneId: string, scrollOffset = 0): string {
  return app.runtime
    .material(paneId, scrollOffset)
    .frame.rows.map((row) =>
      row.map(([count, value, width]) => (width ? value.repeat(count) : "")).join(""),
    )
    .join("\n");
}

test("cold recovery displays several screens across an explicit start and a second daemon restart", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite(
      "printf 'before-restart\\n'; i=0; while [ \"$i\" -lt 80 ]; do printf 'COLD-%03d\\n' \"$i\"; i=$((i+1)); done",
    );
    await waitForHistory(fixture.app, paneId, "COLD-079");
    await fixture.crash();
    const first = await fixture.restart();
    expect(materialText(first.app, paneId)).toContain("COLD-079");
    expect(materialText(first.app, paneId)).toContain("daemon restarted; shell restored");
    await fixture.waitForStartCount(1);
    expect(first.app.recover()).toBe(first.app.recover());
    await first.app.recover();
    expect(await fixture.startCount()).toBe(1);
    await first.app.runtime.stopAll();
    await first.app.execute({ type: "process.restart", paneId });
    await fixture.waitForStartCount(2);
    await fixture.crash();
    const second = await fixture.restart();
    const pages = Array.from({ length: 8 }, (_, i) =>
      materialText(second.app, paneId, i * 24),
    ).join("\n");
    for (const marker of ["COLD-000", "COLD-040", "COLD-079"]) {
      expect(pages).toContain(marker);
    }
    expect(pages.split("daemon restarted; shell restored")).toHaveLength(3);
    expect(
      decodeHistory(second.app.snapshot(), paneId).split("daemon restarted; shell restored"),
    ).toHaveLength(3);
    const starts = second.app.history.readForRecovery(paneId).starts;
    expect(starts.map((start) => start.runtimeStart)).toEqual(["restored", "restored", "restored"]);
    expect(starts[1]!.cursor).toBeLessThan(starts[2]!.cursor);
    await fixture.waitForStartCount(3);
  } finally {
    await fixture.close();
  }
});

test("manual restart preserves multi-screen history and adds one durable boundary per admitted attempt", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite(
      "printf 'before-restart\\n'; i=0; while [ \"$i\" -lt 80 ]; do printf 'MANUAL-%03d\\n' \"$i\"; i=$((i+1)); done",
    );
    await waitForHistory(fixture.app, paneId, "MANUAL-079");
    await fixture.app.runtime.stopAll();
    const before = fixture.app.history.readForRecovery(paneId).cursor;
    await Promise.all([
      fixture.app.execute({ type: "process.restart", paneId }),
      fixture.app.execute({ type: "process.restart", paneId }),
    ]);
    await fixture.waitForStartCount(1);
    const raw = decodeHistory(fixture.app.snapshot(), paneId);
    expect(raw.slice(before)).toStartWith("\r\n[work-craft: shell restarted manually]\r\n");
    expect(raw.split("[work-craft: shell restarted manually]")).toHaveLength(2);
    expect(fixture.app.history.readForRecovery(paneId).starts.at(-1)).toMatchObject({
      cursor: before,
      runtimeStart: "restored",
    });
    const pages = Array.from({ length: 5 }, (_, i) =>
      materialText(fixture.app, paneId, i * 24),
    ).join("\n");
    for (const marker of ["MANUAL-000", "MANUAL-040", "MANUAL-079"]) {
      expect(pages).toContain(marker);
    }
    await fixture.app.execute({ type: "process.restart", paneId });
    expect(decodeHistory(fixture.app.snapshot(), paneId)).toBe(raw);
    await fixture.app.runtime.stopAll();
    await fixture.app.execute({ type: "process.restart", paneId });
    await fixture.waitForStartCount(2);
    expect(
      decodeHistory(fixture.app.snapshot(), paneId).split("[work-craft: shell restarted manually]"),
    ).toHaveLength(3);
  } finally {
    await fixture.close();
  }
});

test("manual flush failure preserves old bytes, reports failure and permits an explicit retry", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    await fixture.app.runtime.stopAll();
    const flush = spyOn(fixture.app.history, "flush");
    flush.mockImplementationOnce(async () => {
      throw new Error("forced manual flush");
    });
    await fixture.app.execute({ type: "process.restart", paneId });
    flush.mockRestore();
    expect(fixture.app.snapshot().panes.find((pane) => pane.id === paneId)).toMatchObject({
      processStatus: "failed",
      errorText: expect.stringContaining("forced manual flush"),
    });
    expect(decodeHistory(fixture.app.snapshot(), paneId)).toContain("before-restart");
    expect(await fixture.startCount()).toBe(0);
    await fixture.app.execute({ type: "process.restart", paneId });
    await fixture.waitForStartCount(1);
  } finally {
    await fixture.close();
  }
});

for (const manual of [false, true]) {
  test(`a ${manual ? "manually restarted" : "recovered"} real child gets fresh input encodings and only its own query reply`, async () => {
    const fixture = await persistentAppFixture();
    const writes = spyOn(Bun.Terminal.prototype, "write");
    try {
      const paneId = await fixture.openShellAndWrite(
        "stty raw -echo; printf 'before-restart\\033[?1h\\033[?2004h\\033[?1000h\\033[?1004h\\033[5n\\033['",
      );
      await waitForHistory(fixture.app, paneId, "\x1b[?2004h");
      fixture.setPaneRestore(paneId, {
        executable: "/bin/sh",
        args: [
          "-c",
          "stty raw -echo; printf READY; dd bs=1 count=3 2>/dev/null | od -An -tx1; dd bs=1 count=1 2>/dev/null | od -An -tx1; printf '\\033[5n'; dd bs=1 count=4 2>/dev/null | od -An -tx1; read -r ignored",
        ],
      });
      if (manual) {
        await fixture.app.runtime.stopAll();
      } else {
        await fixture.crash();
      }
      writes.mockClear();
      const restarted = manual ? { app: fixture.app } : await fixture.restart();
      if (manual) {
        await restarted.app.execute({ type: "process.restart", paneId });
      }
      await waitForHistory(restarted.app, paneId, "READY");
      expect(materialText(restarted.app, paneId)).toContain("before-restart");
      expect(
        await restarted.app.runtime.writeSemantic(paneId, { kind: "focus", focused: true }),
      ).toBe(false);
      expect(
        await restarted.app.runtime.writeSemantic(paneId, {
          kind: "mouse",
          mouse: { action: "press", button: "left", x: 0, y: 0 },
        }),
      ).toBe(false);
      await restarted.app.runtime.writeSemantic(paneId, { kind: "key", key: { key: "arrow_up" } });
      await waitForHistory(restarted.app, paneId, /1b\s+5b\s+41/);
      await restarted.app.runtime.writeSemantic(paneId, { kind: "paste", bytes: [120] });
      await waitForHistory(restarted.app, paneId, /1b\s+5b\s+30\s+6e/);
      expect(decodeHistory(restarted.app.snapshot(), paneId)).toContain(" 78");
      expect(
        writes.mock.calls.map(([bytes]) =>
          typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes),
        ),
      ).toEqual(["\x1b[A", "x", "\x1b[0n"]);
    } finally {
      writes.mockRestore();
      await fixture.close();
    }
  });
}

test("cold capture failure preserves bytes and continues other panes without retrying", async () => {
  const fixture = await persistentAppFixture();
  const lib = resolveRenderLib();
  const lease = spyOn(lib, "contextAcquireBufferLease");
  const create = spyOn(lib, "createContext");
  const destroy = spyOn(lib, "destroyContext");
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    const other = fixture.addRunningPaneAfter(paneId);
    await fixture.crash();
    create.mockClear();
    destroy.mockClear();
    lease.mockImplementationOnce(() => {
      throw new Error("forced cold native lease failure");
    });
    const restarted = await fixture.restart();
    expect(restarted.app.snapshot().panes.find((pane) => pane.id === paneId)).toMatchObject({
      processStatus: "failed",
      errorText: expect.stringContaining("forced cold native lease failure"),
    });
    expect(decodeHistory(restarted.app.snapshot(), paneId)).toContain("before-restart");
    expect(restarted.app.snapshot().panes.find((pane) => pane.id === other)?.processStatus).toBe(
      "running",
    );
    await fixture.waitForStartCount(1);
    await restarted.app.recover();
    expect(await fixture.startCount()).toBe(1);
    await restarted.app.runtime.stopAll();
    expect(create.mock.calls.length).toBe(destroy.mock.calls.length);
  } finally {
    lease.mockRestore();
    create.mockRestore();
    destroy.mockRestore();
    await fixture.close();
  }
});

test("restores an interrupted committed shell exactly once without retrying failed panes", async () => {
  const fixture = await persistentAppFixture();
  try {
    const paneId = await fixture.commitInterruptedShell();
    const failedPaneId = fixture.addRunningPaneAfter(paneId);
    fixture.db.run("UPDATE panes SET process_status = 'failed' WHERE id = ?", [failedPaneId]);
    await fixture.crash();

    const restarted = await fixture.restart();
    await fixture.waitForStartCount(1);

    expect(restarted.app.snapshot().panes.find(({ id }) => id === paneId)?.processStatus).toBe(
      "running",
    );
    expect(
      restarted.app.snapshot().panes.find(({ id }) => id === failedPaneId)?.processStatus,
    ).toBe("failed");
    await restarted.app.recover();
    expect(await fixture.startCount()).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("returns the same rejected recovery promise to every caller", async () => {
  const fixture = await persistentAppFixture();
  try {
    await fixture.openShellAndWrite("printf before-restart");
    await fixture.crash();
    const restarted = fixture.reopen();
    restarted.db.exec("PRAGMA ignore_check_constraints = ON");
    restarted.db.run("UPDATE items SET data_json = 'invalid-json'");

    const first = restarted.app.recover();
    const rejection = first.then(
      () => undefined,
      (error: unknown) => error,
    );
    const concurrent = restarted.app.recover();

    expect(concurrent).toBe(first);
    expect(await rejection).toEqual(
      expect.objectContaining({ message: "Invalid items.data_json" }),
    );
    expect(restarted.app.recover()).toBe(first);
    await expect(restarted.app.recover()).rejects.toThrow("Invalid items.data_json");
  } finally {
    await fixture.close();
  }
});

test("normalizes interrupted metadata before a pre-spawn recovery failure", async () => {
  const fixture = await persistentAppFixture();
  const staleExitedAt = "2000-01-01T00:00:00.000Z";
  try {
    const paneId = await fixture.openShellAndWrite("printf before-restart");
    const nextPaneId = fixture.addRunningPaneAfter(paneId);
    fixture.db.run(
      "UPDATE panes SET error_text = 'stale error', exited_at = ? WHERE id IN (?, ?)",
      [staleExitedAt, paneId, nextPaneId],
    );
    await fixture.crash();
    const restarted = fixture.reopen();
    restarted.db.exec(`
      CREATE TRIGGER fail_recovery_flush BEFORE INSERT ON terminal_chunks
      BEGIN
        SELECT RAISE(ABORT, 'forced recovery flush failure');
      END;
    `);

    await expect(restarted.app.recover()).rejects.toThrow("forced recovery flush failure");
    const panes = restarted.app
      .snapshot()
      .panes.filter(({ id }) => [paneId, nextPaneId].includes(id));

    expect(panes).toHaveLength(2);
    expect(panes.every(({ processStatus }) => processStatus === "interrupted")).toBe(true);
    expect(panes.every(({ errorText }) => errorText === null)).toBe(true);
    expect(panes[0]?.exitedAt).toEqual(expect.any(String));
    expect(panes[0]?.exitedAt).not.toBe(staleExitedAt);
    expect(panes[1]?.exitedAt).toBe(panes[0]?.exitedAt);
  } finally {
    fixture.db.exec("DROP TRIGGER IF EXISTS fail_recovery_flush");
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

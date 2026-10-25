import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as appModule from "../../application/app.ts";
import { applyCommand } from "../../application/commands.ts";
import { inspectDirectory } from "../../application/directories.ts";
import { registerDirectory } from "../../application/items.ts";
import { createClient } from "../../client.ts";
import { openDatabase } from "../../persistence/database.ts";
import { runDaemon } from "../lifecycle.ts";
import { resolvePaths } from "../paths.ts";

const ROOT = join(import.meta.dir, "../../../../..");
const MAIN_PATH = join(import.meta.dir, "../../main.ts");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out waiting for directory lifecycle")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function seedDirectory(home: string) {
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const path = join(home, "target");
  await mkdir(path);
  const canonical = await realpath(path);
  const db = openDatabase(paths.databasePath);
  try {
    const sessionId = applyCommand(db, { type: "session.create", name: "Main" }).result.id;
    const workspaceId = applyCommand(db, { type: "workspace.create", sessionId, name: "Work" })
      .result.id;
    registerDirectory(db, workspaceId, await inspectDirectory(canonical));
    return { paths };
  } finally {
    db.close();
  }
}

function holdDirectoryInspection() {
  const entered = deferred<AbortSignal | undefined>();
  const release = deferred<void>();
  const createApp = appModule.createApp;
  const restores: (() => void)[] = [];
  let app: appModule.WorkCraftApp | undefined;
  let inspected = false;
  let cleaned = false;
  let closedTooEarly = false;
  let databaseClosed = false;
  let historyClosed = false;
  const create = spyOn(appModule, "createApp").mockImplementation((options) => {
    app = createApp({
      ...options,
      inspectDirectory: async (path, signal) => {
        inspected = true;
        entered.resolve(signal);
        await release.promise;
        cleaned = true;
        return { path, available: true, git: null };
      },
    });
    const closeDatabase = options.db.close.bind(options.db);
    const dbSpy = spyOn(options.db, "close").mockImplementation(() => {
      closedTooEarly ||= !cleaned;
      databaseClosed = true;
      return closeDatabase();
    });
    const closeHistory = app.history.close.bind(app.history);
    const historySpy = spyOn(app.history, "close").mockImplementation(() => {
      closedTooEarly ||= !cleaned;
      historyClosed = true;
      return closeHistory();
    });
    restores.push(
      () => dbSpy.mockRestore(),
      () => historySpy.mockRestore(),
    );
    return app;
  });
  return {
    entered,
    release,
    get app() {
      return app;
    },
    get inspected() {
      return inspected;
    },
    get closedTooEarly() {
      return closedTooEarly;
    },
    get databaseClosed() {
      return databaseClosed;
    },
    get historyClosed() {
      return historyClosed;
    },
    restore() {
      create.mockRestore();
      for (const restore of restores) {
        restore();
      }
    },
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnDaemon(home: string, env: Record<string, string> = {}) {
  return Bun.spawn([process.execPath, MAIN_PATH], {
    cwd: ROOT,
    env: { ...process.env, ...env, WORK_CRAFT_HOME: home },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

async function processError(processes: ReturnType<typeof spawnDaemon>[]): Promise<string> {
  const messages = await Promise.all(
    processes.map(async (child) => {
      if (child.exitCode === null) {
        return `PID ${child.pid} is still running`;
      }
      return `PID ${child.pid} exited ${child.exitCode}: ${await new Response(child.stderr).text()}`;
    }),
  );
  return messages.join("\n");
}

async function waitForHealth(
  socketPath: string,
  processes: ReturnType<typeof spawnDaemon>[],
): Promise<{ pid: number }> {
  const client = createClient({ socketPath });
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      return await client.health();
    } catch {
      await Bun.sleep(20);
    }
  }
  throw new Error(`Daemon did not become healthy:\n${await processError(processes)}`);
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      return await Bun.file(path).text();
    } catch {
      await Bun.sleep(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForExit(child: ReturnType<typeof spawnDaemon>): Promise<number> {
  const result = await Promise.race([child.exited, Bun.sleep(3_000).then(() => undefined)]);
  if (result === undefined) {
    throw new Error(`PID ${child.pid} did not exit`);
  }
  return result;
}

async function cleanup(
  directory: string,
  children: ReturnType<typeof spawnDaemon>[],
): Promise<void> {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
  await Promise.all(children.map((child) => child.exited));
  await rm(directory, { recursive: true, force: true });
}

test("client starts one daemon on demand for concurrent callers", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const previousHome = process.env.WORK_CRAFT_HOME;
  process.env.WORK_CRAFT_HOME = home;
  const paths = resolvePaths();
  const client = createClient();
  let daemonPid: number | undefined;
  try {
    await Promise.all([client.ensureDaemon(), client.ensureDaemon()]);
    daemonPid = (await client.health()).pid;
    expect(isAlive(daemonPid)).toBe(true);

    await client.command({ type: "daemon.stop" });
    const deadline = Date.now() + 3_000;
    while (isAlive(daemonPid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(isAlive(daemonPid)).toBe(false);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    expect(await Bun.file(paths.socketPath).exists()).toBe(false);
  } finally {
    let lockPid: number | undefined;
    try {
      lockPid = Number(await Bun.file(paths.lockPath).text());
    } catch {}
    const ownedPids = new Set([daemonPid, lockPid]);
    for (const pid of ownedPids) {
      if (pid !== undefined && isAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
    const cleanupDeadline = Date.now() + 1_000;
    while (
      [...ownedPids].some((pid) => pid !== undefined && isAlive(pid)) &&
      Date.now() < cleanupDeadline
    ) {
      await Bun.sleep(10);
    }
    if (previousHome === undefined) {
      delete process.env.WORK_CRAFT_HOME;
    } else {
      process.env.WORK_CRAFT_HOME = previousHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("drains the daemon.stop request before force-closing streams", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const serveSpy = spyOn(Bun, "serve");
  const daemon = runDaemon(paths);
  const calls: { force: boolean; pendingRequests: number }[] = [];
  try {
    await waitForHealth(paths.socketPath, []);
    const server = serveSpy.mock.results[0]!.value as Bun.Server<undefined>;
    const stop = server.stop.bind(server);
    Object.defineProperty(server, "stop", {
      configurable: true,
      value(force = false) {
        calls.push({ force, pendingRequests: server.pendingRequests });
        return stop(force);
      },
    });

    expect(
      await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" }),
    ).toMatchObject({ ok: true, result: { stopping: true } });
    await daemon;

    expect(calls[0]?.force).toBe(false);
    expect(calls.at(-1)).toEqual({ force: true, pendingRequests: 0 });
  } finally {
    serveSpy.mockRestore();
    if (await Bun.file(paths.socketPath).exists()) {
      await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    }
    await daemon;
    await rm(home, { recursive: true, force: true });
  }
});

for (const type of ["daemon.stop", "daemon.destroy"] as const) {
  test(`${type} awaits directory scan cleanup before history and SQLite close`, async () => {
    const home = await mkdtemp(join(tmpdir(), "work-craft-discovery-stop-"));
    const { paths } = await seedDirectory(home);
    const held = holdDirectoryInspection();
    let settled = false;
    const stopped = runDaemon(paths).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await waitForHealth(paths.socketPath, []);
      expect(held.inspected).toBe(true);
      const signal = await within(held.entered.promise);
      const revision = held.app!.health().revision;
      expect(await createClient({ socketPath: paths.socketPath }).command({ type })).toMatchObject({
        ok: true,
      });
      expect(signal?.aborted).toBe(true);
      expect(settled).toBe(false);
      expect(held.databaseClosed).toBe(false);
      expect(held.historyClosed).toBe(false);
      held.release.resolve();
      expect(await within(stopped)).toBeNull();
      expect(held.closedTooEarly).toBe(false);
      expect(held.databaseClosed).toBe(true);
      expect(held.historyClosed).toBe(true);
      expect(held.app!.health().revision).toBe(revision);
      expect(await Bun.file(paths.databasePath).exists()).toBe(type !== "daemon.destroy");
      expect(await Bun.file(paths.lockPath).exists()).toBe(false);
      await expect(stat(paths.socketPath)).rejects.toThrow();
    } finally {
      held.release.resolve();
      await held.app?.closeDirectoryRefresh();
      if (existsSync(paths.socketPath)) {
        await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
      }
      await within(stopped);
      held.restore();
      await rm(home, { recursive: true, force: true });
    }
  });
}

test("HTTP startup failure cancels and drains directory discovery before closing SQLite", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-discovery-startup-"));
  const { paths } = await seedDirectory(home);
  const held = holdDirectoryInspection();
  const serve = spyOn(Bun, "serve").mockImplementationOnce(() => {
    throw new Error("discovery test listen failure");
  });
  const stopped = runDaemon(paths).then(
    () => null,
    (error: unknown) => error,
  );
  try {
    const signal = await within(held.entered.promise);
    expect(signal?.aborted).toBe(true);
    expect(held.databaseClosed).toBe(false);
    held.release.resolve();
    const error = await within(stopped);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("discovery test listen failure");
    expect(held.closedTooEarly).toBe(false);
    expect(held.databaseClosed).toBe(true);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    await expect(stat(paths.socketPath)).rejects.toThrow();
  } finally {
    held.release.resolve();
    await held.app?.closeDirectoryRefresh();
    await stopped;
    serve.mockRestore();
    held.restore();
    await rm(home, { recursive: true, force: true });
  }
});

test("two simultaneous starts leave exactly one healthy daemon", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const children = [spawnDaemon(home), spawnDaemon(home)];
  try {
    const health = await waitForHealth(paths.socketPath, children);
    const owner = children.find(({ pid }) => pid === health.pid);
    const loser = children.find(({ pid }) => pid !== health.pid);

    expect(owner).toBeDefined();
    expect(loser).toBeDefined();
    expect(await waitForExit(loser!)).not.toBe(0);
    expect(children.filter(({ pid }) => isAlive(pid))).toEqual([owner!]);

    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    expect(await waitForExit(owner!)).toBe(0);
    expect(children.some(({ pid }) => isAlive(pid))).toBe(false);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    expect(await Bun.file(paths.socketPath).exists()).toBe(false);
  } finally {
    await cleanup(home, children);
  }
});

test("takes over a dead PID lock and removes a stale socket", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  await mkdir(paths.stateDir, { recursive: true, mode: 0o777 });
  await chmod(paths.stateDir, 0o777);
  await writeFile(paths.lockPath, "2147483647\n", { mode: 0o600 });
  await writeFile(paths.socketPath, "stale");
  const child = spawnDaemon(home);
  try {
    expect((await waitForHealth(paths.socketPath, [child])).pid).toBe(child.pid);
    expect((await stat(paths.stateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.lockPath)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.socketPath)).mode & 0o777).toBe(0o600);

    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    expect(await waitForExit(child)).toBe(0);
    expect(isAlive(child.pid)).toBe(false);
  } finally {
    await cleanup(home, [child]);
  }
});

test("daemon.destroy stops runtimes and removes persisted state", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const shellPath = join(home, "test-shell");
  const shellPidPath = join(home, "shell.pid");
  await writeFile(
    shellPath,
    '#!/bin/sh\nprintf "$$" > "$WORK_CRAFT_TEST_SHELL_PID"\nwhile :; do sleep 0.1; done\n',
  );
  await chmod(shellPath, 0o755);
  const child = spawnDaemon(home, {
    SHELL: shellPath,
    WORK_CRAFT_TEST_SHELL_PID: shellPidPath,
  });
  let shellPid: number | undefined;
  try {
    await waitForHealth(paths.socketPath, [child]);
    const client = createClient({ socketPath: paths.socketPath });
    const session = await client.command({ type: "session.create", name: "Main" });
    const workspace = await client.command({
      type: "workspace.create",
      sessionId: session.result.id,
      name: "Work",
    });
    const project = await client.command({
      type: "item.create",
      workspaceId: workspace.result.id,
      category: "design",
      title: "Lifecycle",
    });
    const item = await client.command({
      type: "item.create",
      workspaceId: workspace.result.id,
      category: "design",
      parentId: project.result.id,
      title: "Destroy",
    });
    await client.command({ type: "surface.ensure", itemId: item.result.id, cwd: home });
    shellPid = Number(await waitForFile(shellPidPath));

    expect(await client.command({ type: "daemon.destroy" })).toMatchObject({
      ok: true,
      result: { destroying: true },
    });
    expect(await waitForExit(child)).toBe(0);
    expect(isAlive(shellPid)).toBe(false);
    expect(await Bun.file(paths.databasePath).exists()).toBe(false);
    expect(await Bun.file(`${paths.databasePath}-wal`).exists()).toBe(false);
    expect(await Bun.file(`${paths.databasePath}-shm`).exists()).toBe(false);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    expect(await Bun.file(paths.socketPath).exists()).toBe(false);
  } finally {
    if (shellPid !== undefined && isAlive(shellPid)) {
      process.kill(shellPid, "SIGKILL");
    }
    await cleanup(home, [child]);
  }
});

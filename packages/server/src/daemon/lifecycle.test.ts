import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as appModule from "../application/app.ts";
import { applyCommand } from "../application/commands.ts";
import { inspectDirectory } from "../application/directories.ts";
import { registerDirectory } from "../application/items.ts";
import { createClient } from "../client.ts";
import { openDatabase } from "../persistence/database.ts";
import { runDaemon } from "./lifecycle.ts";
import { resolvePaths } from "./paths.ts";

const ROOT = join(import.meta.dir, "../../../..");
const MAIN_PATH = join(import.meta.dir, "../main.ts");

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

function git(path: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", path, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
}

async function seedDirectory(home: string, repository = false, linked = false) {
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const path = join(home, "target");
  await mkdir(path);
  const canonical = await realpath(path);
  if (repository) {
    git(canonical, "init", "--initial-branch=before");
    git(canonical, "commit", "--allow-empty", "-m", "initial");
    if (linked) {
      git(canonical, "worktree", "add", "-b", "feature", join(await realpath(home), "linked"));
    }
  }
  const db = openDatabase(paths.databasePath);
  try {
    const sessionId = applyCommand(db, { type: "session.create", name: "Main" }).result.id;
    const workspaceId = applyCommand(db, { type: "workspace.create", sessionId, name: "Work" })
      .result.id;
    const rootId = registerDirectory(db, workspaceId, await inspectDirectory(canonical)).itemId;
    return { paths, path: canonical, rootId };
  } finally {
    db.close();
  }
}

function holdDirectoryInspection(unavailableRoot?: string) {
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
        if (path === unavailableRoot) {
          return { path, available: false, reason: "Primary unreachable", git: null };
        }
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

async function openHungRequest(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(
    "POST /command HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
  );
  await Bun.sleep(20);
  return socket;
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

test("rejects lock ownership lost between PID sync and startup", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const displacedPath = `${paths.lockPath}.displaced`;
  const preloadPath = join(home, "replace-lock.ts");
  await writeFile(
    preloadPath,
    `
    import { spyOn } from "bun:test";
    import * as fs from "node:fs";
    const originalFsync = fs.fsyncSync;
    spyOn(fs, "fsyncSync").mockImplementationOnce((fd) => {
      originalFsync(fd);
      fs.renameSync(process.env.WORK_CRAFT_TEST_LOCK_PATH!, process.env.WORK_CRAFT_TEST_DISPLACED_PATH!);
      fs.writeFileSync(process.env.WORK_CRAFT_TEST_LOCK_PATH!, process.pid + "\\n", { mode: 0o600 });
    });
  `,
  );
  const child = Bun.spawn([process.execPath, "--preload", preloadPath, MAIN_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      WORK_CRAFT_HOME: home,
      WORK_CRAFT_TEST_LOCK_PATH: paths.lockPath,
      WORK_CRAFT_TEST_DISPLACED_PATH: displacedPath,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const exitCode = await Promise.race([child.exited, Bun.sleep(1_000).then(() => undefined)]);
    if (exitCode === undefined) {
      child.kill("SIGKILL");
      await child.exited;
    }

    expect(exitCode).not.toBeUndefined();
    expect(exitCode).not.toBe(0);
    expect(await Bun.file(paths.databasePath).exists()).toBe(false);
    expect(await Bun.file(paths.lockPath).text()).toBe(`${child.pid}\n`);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await child.exited;
    await rm(home, { recursive: true, force: true });
  }
});

test("serializes a stale contender paused after classifying the lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const preloadPath = join(home, "pause-stale-contender.ts");
  const pausedPath = join(home, "contender.paused");
  const releasePath = join(home, "contender.release");
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.lockPath, "2147483647\n", { mode: 0o600 });
  await writeFile(
    preloadPath,
    `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs";
      const originalRead = fs.readFileSync;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      let paused = false;
      spyOn(fs, "readFileSync").mockImplementation((path, options) => {
        const value = originalRead(path, options as never);
        if (!paused && path === process.env.WORK_CRAFT_TEST_LOCK_PATH) {
          paused = true;
          fs.writeFileSync(process.env.WORK_CRAFT_TEST_PAUSED_PATH!, "paused");
          while (!fs.existsSync(process.env.WORK_CRAFT_TEST_RELEASE_PATH!)) {
            Atomics.wait(wait, 0, 0, 10);
          }
        }
        return value;
      });
    `,
  );
  const contender = Bun.spawn([process.execPath, "--preload", preloadPath, MAIN_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      WORK_CRAFT_HOME: home,
      WORK_CRAFT_TEST_LOCK_PATH: paths.lockPath,
      WORK_CRAFT_TEST_PAUSED_PATH: pausedPath,
      WORK_CRAFT_TEST_RELEASE_PATH: releasePath,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  let owner: ReturnType<typeof spawnDaemon> | undefined;
  try {
    await waitForFile(pausedPath);
    await rm(paths.lockPath, { force: true });
    owner = spawnDaemon(home);
    const ownerDeadline = Date.now() + 3_000;
    while (Date.now() < ownerDeadline) {
      try {
        if (Number(await Bun.file(paths.lockPath).text()) === owner.pid) {
          break;
        }
      } catch {}
      await Bun.sleep(10);
    }
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(owner.pid);
    await writeFile(releasePath, "release");
    const contenderExit = await Promise.race([
      contender.exited,
      Bun.sleep(3_000).then(() => undefined),
    ]);
    if (contenderExit === undefined) {
      const files = await readdir(paths.stateDir);
      const lockPid = await Bun.file(paths.lockPath).text();
      contender.kill("SIGKILL");
      await contender.exited;
      throw new Error(
        `Contender did not exit; lock=${lockPid.trim()} files=${files.join(",")} stderr=${await new Response(contender.stderr).text()}`,
      );
    }
    expect(contenderExit).not.toBe(0);

    expect((await waitForHealth(paths.socketPath, [owner, contender])).pid).toBe(owner.pid);
    expect(isAlive(owner.pid)).toBe(true);
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(owner.pid);
    expect(
      (await readdir(paths.stateDir)).filter((name) => name.startsWith("daemon.lock.")),
    ).toEqual([]);

    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    expect(await waitForExit(owner)).toBe(0);
  } finally {
    await writeFile(releasePath, "release").catch(() => {});
    await cleanup(home, owner === undefined ? [contender] : [contender, owner]);
  }
});

test("stale claim cleanup cannot remove a concurrent recoverer's claim", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const staleClaimPath = `${paths.lockPath}.takeover-2147483647-stale`;
  const firstPreloadPath = join(home, "pause-stale-claim-cleanup.ts");
  const firstPausedPath = join(home, "first.paused");
  const firstReleasePath = join(home, "first.release");
  const secondPreloadPath = join(home, "pause-published-claim.ts");
  const secondPausedPath = join(home, "second.paused");
  const secondReleasePath = join(home, "second.release");
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.lockPath, "2147483647\n", { mode: 0o600 });
  await writeFile(staleClaimPath, "2147483647\n", { mode: 0o600 });
  await writeFile(
    firstPreloadPath,
    `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs";
      const originalUnlink = fs.unlinkSync;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      let paused = false;
      function pause() {
        if (paused) return;
        paused = true;
        fs.writeFileSync(process.env.WORK_CRAFT_TEST_PAUSED_PATH!, "paused");
        while (!fs.existsSync(process.env.WORK_CRAFT_TEST_RELEASE_PATH!)) {
          Atomics.wait(wait, 0, 0, 10);
        }
      }
      spyOn(fs, "unlinkSync").mockImplementation((path) => {
        if (path === process.env.WORK_CRAFT_TEST_STALE_CLAIM_PATH) pause();
        return originalUnlink(path);
      });
    `,
  );
  await writeFile(
    secondPreloadPath,
    `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs";
      const originalFsync = fs.fsyncSync;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      spyOn(fs, "fsyncSync").mockImplementationOnce((fd) => {
        originalFsync(fd);
        fs.writeFileSync(process.env.WORK_CRAFT_TEST_PAUSED_PATH!, "paused");
        while (!fs.existsSync(process.env.WORK_CRAFT_TEST_RELEASE_PATH!)) {
          Atomics.wait(wait, 0, 0, 10);
        }
      });
    `,
  );
  const first = spawnDaemon(home, {
    BUN_OPTIONS: `--preload=${firstPreloadPath}`,
    WORK_CRAFT_TEST_STALE_CLAIM_PATH: staleClaimPath,
    WORK_CRAFT_TEST_PAUSED_PATH: firstPausedPath,
    WORK_CRAFT_TEST_RELEASE_PATH: firstReleasePath,
  });
  let second: ReturnType<typeof spawnDaemon> | undefined;
  try {
    await waitForFile(firstPausedPath);
    second = spawnDaemon(home, {
      BUN_OPTIONS: `--preload=${secondPreloadPath}`,
      WORK_CRAFT_TEST_PAUSED_PATH: secondPausedPath,
      WORK_CRAFT_TEST_RELEASE_PATH: secondReleasePath,
    });
    await waitForFile(secondPausedPath);

    let secondClaimPath: string | undefined;
    for (const name of await readdir(paths.stateDir)) {
      const path = join(paths.stateDir, name);
      if (
        name.startsWith("daemon.lock.takeover") &&
        (await Bun.file(path).text()).trim() === String(second.pid)
      ) {
        secondClaimPath = path;
        break;
      }
    }
    expect(secondClaimPath).toBeDefined();
    const secondClaim = await stat(secondClaimPath!);
    expect(secondClaim.mode & 0o777).toBe(0o600);

    await writeFile(firstReleasePath, "release");
    expect((await stat(secondClaimPath!)).ino).toBe(secondClaim.ino);
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(2147483647);
    expect(await Bun.file(paths.databasePath).exists()).toBe(false);
    expect(await Bun.file(paths.socketPath).exists()).toBe(false);

    await writeFile(secondReleasePath, "release");
    expect(await waitForExit(second)).not.toBe(0);
    expect((await waitForHealth(paths.socketPath, [first, second])).pid).toBe(first.pid);
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(first.pid);
    expect((await readdir(paths.stateDir)).filter((name) => name.includes(".takeover"))).toEqual(
      [],
    );

    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    expect(await waitForExit(first)).toBe(0);
  } finally {
    await writeFile(firstReleasePath, "release").catch(() => {});
    await writeFile(secondReleasePath, "release").catch(() => {});
    await cleanup(home, second === undefined ? [first] : [first, second]);
  }
});

test("a late equal-time takeover claim cannot replace the elected contender's lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const firstPreloadPath = join(home, "pause-elected-contender.ts");
  const firstPausedPath = join(home, "first.paused");
  const firstReleasePath = join(home, "first.release");
  const firstReplacePath = join(home, "first.replacing");
  const secondPreloadPath = join(home, "force-late-tie.ts");
  const secondWaitingPath = join(home, "second.waiting");
  const secondReplacePath = join(home, "second.replacing");
  const secondReleasePath = join(home, "second.release");
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.lockPath, "2147483647\n", { mode: 0o600 });
  await writeFile(
    firstPreloadPath,
    `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs";
      const originalRead = fs.readFileSync;
      const originalRename = fs.renameSync;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      let paused = false;
      spyOn(fs, "readFileSync").mockImplementation((path, options) => {
        const value = originalRead(path, options as never);
        if (!paused && path === process.env.WORK_CRAFT_TEST_LOCK_PATH) {
          paused = true;
          fs.writeFileSync(process.env.WORK_CRAFT_TEST_PAUSED_PATH!, "paused");
          while (!fs.existsSync(process.env.WORK_CRAFT_TEST_RELEASE_PATH!)) {
            Atomics.wait(wait, 0, 0, 10);
          }
        }
        return value;
      });
      spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
        if (oldPath === process.env.WORK_CRAFT_TEST_LOCK_PATH) {
          fs.writeFileSync(process.env.WORK_CRAFT_TEST_REPLACE_PATH!, "replacing");
        }
        return originalRename(oldPath, newPath);
      });
    `,
  );
  await writeFile(
    secondPreloadPath,
    `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs";
      const originalLocaleCompare = String.prototype.localeCompare;
      const originalReaddir = fs.readdirSync;
      const originalRename = fs.renameSync;
      const originalStat = fs.statSync;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      let scans = 0;
      spyOn(fs, "statSync").mockImplementation((path, options) => {
        const stats = originalStat(path, options as never);
        if (typeof path === "string" && path.startsWith(process.env.WORK_CRAFT_TEST_CLAIM_PREFIX!)) {
          return { ...stats, mtimeNs: 1n } as never;
        }
        return stats;
      });
      String.prototype.localeCompare = function (other, ...args) {
        const left = String(this);
        const right = String(other);
        const prefix = process.env.WORK_CRAFT_TEST_CLAIM_PREFIX!;
        const ownPrefix = prefix + process.pid + "-";
        if (left.startsWith(ownPrefix) && right.startsWith(prefix) && !right.startsWith(ownPrefix)) {
          return -1;
        }
        if (right.startsWith(ownPrefix) && left.startsWith(prefix) && !left.startsWith(ownPrefix)) {
          return 1;
        }
        return originalLocaleCompare.call(left, right, ...args);
      };
      spyOn(fs, "readdirSync").mockImplementation((path, options) => {
        const entries = originalReaddir(path, options as never);
        if (path === process.env.WORK_CRAFT_TEST_STATE_DIR && ++scans === 3) {
          fs.writeFileSync(process.env.WORK_CRAFT_TEST_WAITING_PATH!, "waiting");
        }
        return entries;
      });
      spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
        if (oldPath === process.env.WORK_CRAFT_TEST_LOCK_PATH) {
          fs.writeFileSync(process.env.WORK_CRAFT_TEST_REPLACE_PATH!, "replacing");
          while (!fs.existsSync(process.env.WORK_CRAFT_TEST_RELEASE_PATH!)) {
            Atomics.wait(wait, 0, 0, 10);
          }
        }
        return originalRename(oldPath, newPath);
      });
    `,
  );
  const first = spawnDaemon(home, {
    BUN_OPTIONS: `--preload=${firstPreloadPath}`,
    WORK_CRAFT_TEST_LOCK_PATH: paths.lockPath,
    WORK_CRAFT_TEST_PAUSED_PATH: firstPausedPath,
    WORK_CRAFT_TEST_RELEASE_PATH: firstReleasePath,
    WORK_CRAFT_TEST_REPLACE_PATH: firstReplacePath,
  });
  let second: ReturnType<typeof spawnDaemon> | undefined;
  try {
    await waitForFile(firstPausedPath);
    second = spawnDaemon(home, {
      BUN_OPTIONS: `--preload=${secondPreloadPath}`,
      WORK_CRAFT_TEST_CLAIM_PREFIX: `${paths.lockPath}.takeover-`,
      WORK_CRAFT_TEST_LOCK_PATH: paths.lockPath,
      WORK_CRAFT_TEST_RELEASE_PATH: secondReleasePath,
      WORK_CRAFT_TEST_REPLACE_PATH: secondReplacePath,
      WORK_CRAFT_TEST_STATE_DIR: paths.stateDir,
      WORK_CRAFT_TEST_WAITING_PATH: secondWaitingPath,
    });

    const coordinationDeadline = Date.now() + 3_000;
    while (
      !(await Bun.file(secondReplacePath).exists()) &&
      !(await Bun.file(secondWaitingPath).exists()) &&
      Date.now() < coordinationDeadline
    ) {
      await Bun.sleep(10);
    }
    expect(
      (await Bun.file(secondReplacePath).exists()) || (await Bun.file(secondWaitingPath).exists()),
    ).toBe(true);

    await writeFile(firstReleasePath, "release");
    const lockDeadline = Date.now() + 3_000;
    while (Date.now() < lockDeadline) {
      try {
        if (Number(await Bun.file(paths.lockPath).text()) === first.pid) {
          break;
        }
      } catch {}
      await Bun.sleep(10);
    }
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(first.pid);
    expect(await Bun.file(firstReplacePath).exists()).toBe(true);

    await writeFile(secondReleasePath, "release");
    expect(await waitForExit(second)).not.toBe(0);
    expect((await waitForHealth(paths.socketPath, [first, second])).pid).toBe(first.pid);
    expect(Number(await Bun.file(paths.lockPath).text())).toBe(first.pid);
    expect(await Bun.file(secondReplacePath).exists()).toBe(false);
    expect((await readdir(paths.stateDir)).filter((name) => name.includes(".takeover"))).toEqual(
      [],
    );

    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });
    expect(await waitForExit(first)).toBe(0);
  } finally {
    await writeFile(firstReleasePath, "release").catch(() => {});
    await writeFile(secondReleasePath, "release").catch(() => {});
    await cleanup(home, second === undefined ? [first] : [first, second]);
  }
});

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

test("bounds startup when an existing Unix server never answers health", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  const hanging = Bun.serve({
    unix: paths.socketPath,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  const previousHome = process.env.WORK_CRAFT_HOME;
  process.env.WORK_CRAFT_HOME = home;
  const client = createClient();
  let daemonPid: number | undefined;
  const fallback = setTimeout(() => void hanging.stop(true), 3_300);
  try {
    const startedAt = performance.now();
    await client.ensureDaemon();
    const elapsed = performance.now() - startedAt;
    daemonPid = (await client.health()).pid;

    expect(elapsed).toBeLessThan(3_100);
    expect(daemonPid).not.toBe(process.pid);
    await client.command({ type: "daemon.stop" });
    const deadline = Date.now() + 3_000;
    while (isAlive(daemonPid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(isAlive(daemonPid)).toBe(false);
  } finally {
    clearTimeout(fallback);
    await hanging.stop(true);
    let lockPid: number | undefined;
    try {
      lockPid = Number(await Bun.file(paths.lockPath).text());
    } catch {}
    for (const pid of new Set([daemonPid, lockPid])) {
      if (pid !== undefined && isAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
    if (previousHome === undefined) {
      delete process.env.WORK_CRAFT_HOME;
    } else {
      process.env.WORK_CRAFT_HOME = previousHome;
    }
    await rm(home, { recursive: true, force: true });
  }
}, 10_000);

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

test("bounds graceful shutdown when an unrelated request is hung", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const child = spawnDaemon(home);
  let hung: Socket | undefined;
  try {
    await waitForHealth(paths.socketPath, [child]);
    hung = await openHungRequest(paths.socketPath);
    expect(
      await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" }),
    ).toMatchObject({ ok: true, result: { stopping: true } });

    const exitCode = await Promise.race([child.exited, Bun.sleep(1_000).then(() => undefined)]);
    if (exitCode === undefined) {
      hung.destroy();
      await child.exited;
    }

    expect(exitCode).toBe(0);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    await expect(stat(paths.socketPath)).rejects.toThrow();
  } finally {
    hung?.destroy();
    await cleanup(home, [child]);
  }
});

for (const type of ["daemon.stop", "daemon.destroy"] as const) {
  for (const fallback of [false, true]) {
    test(`${type} awaits ${fallback ? "fallback" : "directory"} scan cleanup before history and SQLite close`, async () => {
      const home = await mkdtemp(join(tmpdir(), "work-craft-discovery-stop-"));
      const { paths, path } = await seedDirectory(home, fallback, fallback);
      const held = holdDirectoryInspection(fallback ? path : undefined);
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
        expect(
          await createClient({ socketPath: paths.socketPath }).command({ type }),
        ).toMatchObject({
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

test("a real daemon discovers external worktrees on its timer without a connected TUI", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-discovery-daemon-"));
  const { paths, path, rootId } = await seedDirectory(home, true);
  git(path, "checkout", "-b", "trunk");
  const child = spawnDaemon(home, { SHELL: "/bin/sh" });
  let observer: Database | undefined;
  try {
    await waitForHealth(paths.socketPath, [child]);
    const client = createClient({ socketPath: paths.socketPath });
    observer = new Database(paths.databasePath, { readonly: true });
    const rootBranch = observer.query<{ branch: string }, [string]>(
      "SELECT json_extract(data_json, '$.branch') AS branch FROM items WHERE id = ?",
    );
    let deadline = Date.now() + 3000;
    while (rootBranch.get(rootId)?.branch !== "trunk" && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(rootBranch.get(rootId)?.branch).toBe("trunk");
    const external = join(await realpath(home), "external");
    git(path, "worktree", "add", "-b", "feature", external);
    const discovered = observer.query<{ id: string }, [string, string]>(
      "SELECT id FROM items WHERE parent_id = ? AND json_extract(data_json, '$.path') = ?",
    );
    deadline = Date.now() + 7000;
    while (discovered.get(rootId, external) === null && Date.now() < deadline) {
      await Bun.sleep(25);
    }
    const item = discovered.get(rootId, external);
    expect(item).not.toBeNull();
    const snapshot = await client.snapshot();
    expect(snapshot.items.find((candidate) => candidate.id === item?.id)).toMatchObject({
      kind: "worktree",
      data: { path: external, branch: "feature", availability: "available" },
    });
    expect(snapshot.surfaces).toEqual([]);
    await client.command({ type: "daemon.stop" });
    expect(await waitForExit(child)).toBe(0);
  } finally {
    observer?.close();
    await cleanup(home, [child]);
  }
}, 15000);

test("SIGTERM escalates an in-progress graceful drain", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const child = spawnDaemon(home);
  let hung: Socket | undefined;
  try {
    await waitForHealth(paths.socketPath, [child]);
    hung = await openHungRequest(paths.socketPath);
    await createClient({ socketPath: paths.socketPath }).command({ type: "daemon.stop" });

    const closed = new Promise<boolean>((resolve) => hung!.once("close", () => resolve(true)));
    child.kill("SIGTERM");
    const escalated = await Promise.race([closed, Bun.sleep(100).then(() => false)]);
    if (!escalated) {
      hung.destroy();
    }
    const exitCode = await waitForExit(child);

    expect(escalated).toBe(true);
    expect(exitCode).toBe(0);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
  } finally {
    hung?.destroy();
    await cleanup(home, [child]);
  }
});

test("SIGTERM during startup uses owned cleanup and does not continue", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  const hanging = Bun.serve({
    unix: paths.socketPath,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  const child = spawnDaemon(home);
  try {
    expect(Number(await waitForFile(paths.lockPath))).toBe(child.pid);
    child.kill("SIGTERM");
    await waitForExit(child);

    expect(isAlive(child.pid)).toBe(false);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    expect((await stat(paths.socketPath)).isSocket()).toBe(true);
    expect(await Bun.file(paths.databasePath).exists()).toBe(false);
  } finally {
    await hanging.stop(true);
    await cleanup(home, [child]);
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

test("daemon.stop flushes final PTY output and releases every owned resource", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-lifecycle-"));
  const paths = resolvePaths({ WORK_CRAFT_HOME: home });
  const shellPath = join(home, "test-shell");
  const shellPidPath = join(home, "shell.pid");
  await writeFile(
    shellPath,
    '#!/bin/sh\nprintf "$$" > "$WORK_CRAFT_TEST_SHELL_PID"\ntrap \'printf shutdown-output; exit 0\' TERM\nwhile :; do sleep 0.1; done\n',
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
      title: "Shutdown",
    });
    const opened = await client.command({
      type: "surface.ensure",
      itemId: item.result.id,
      cwd: home,
    });
    shellPid = Number(await waitForFile(shellPidPath));

    expect(await client.command({ type: "daemon.stop" })).toMatchObject({
      ok: true,
      result: { stopping: true },
    });
    expect(await waitForExit(child)).toBe(0);
    expect(isAlive(child.pid)).toBe(false);
    expect(isAlive(shellPid)).toBe(false);
    expect(await Bun.file(paths.lockPath).exists()).toBe(false);
    expect(await Bun.file(paths.socketPath).exists()).toBe(false);

    const db = openDatabase(paths.databasePath);
    try {
      expect(
        db
          .query<{ status: string }, [string]>(
            "SELECT process_status AS status FROM panes WHERE id = ?",
          )
          .get(opened.result.paneId!)?.status,
      ).toBe("running");
      const output = db
        .query<{ data: Uint8Array }, [string]>(
          "SELECT data FROM terminal_chunks WHERE pane_id = ? ORDER BY cursor_start, id",
        )
        .all(opened.result.paneId!)
        .map(({ data }) => data);
      expect(new TextDecoder().decode(Buffer.concat(output))).toContain("shutdown-output");
    } finally {
      db.close();
    }
  } finally {
    if (shellPid !== undefined && isAlive(shellPid)) {
      process.kill(shellPid, "SIGKILL");
    }
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

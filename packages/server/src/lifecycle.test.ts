import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "./client.ts";
import { openDatabase } from "./database.ts";
import { resolvePaths } from "./paths.ts";

const MAIN_PATH = join(import.meta.dir, "main.ts");

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
    cwd: join(import.meta.dir, "../../.."),
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
      type: "project.create",
      workspaceId: workspace.result.id,
      category: "implementation",
      name: "Lifecycle",
    });
    const item = await client.command({
      type: "item.create",
      projectId: project.result.id,
      kind: "surface",
      title: "Shutdown",
    });
    const opened = await client.command({
      type: "surface.open",
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

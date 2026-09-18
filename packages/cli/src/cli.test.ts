import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type WorkCraftClient } from "@work-craft/server/client";
import { USAGE } from "./args.ts";
import { readStatus } from "./format.ts";

const ROOT = join(import.meta.dir, "../../..");
const CLI_PATH = join(import.meta.dir, "main.ts");
const SERVER_COMMAND = `${process.execPath} ${join(ROOT, "packages/server/src/main.ts")}`;
const CLEANUP_TIMEOUT = 3_000;
const PROBE_TIMEOUT = 100;

type CliResult = { exitCode: number; stdout: string; stderr: string };

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "work-craft-cli-"));
}

async function runCli(
  home: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env, WORK_CRAFT_HOME: home, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function runJson(home: string, args: string[], env: Record<string, string> = {}) {
  const result = await runCli(home, [...args, "--json"], env);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function seedItems(home: string): Promise<{ first: string; second: string }> {
  const client = createClient({ socketPath: join(home, "work-craft.sock") });
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
    name: "Work Craft",
  });
  const first = await client.command({
    type: "item.create",
    projectId: project.result.id,
    kind: "surface",
    title: "CLI JSON",
  });
  const second = await client.command({
    type: "item.create",
    projectId: project.result.id,
    kind: "surface",
    title: "CLI Plain",
  });
  return { first: first.result.id, second: second.result.id };
}

async function waitForOwnedFiles(home: string, timeout = 3_000): Promise<boolean> {
  return waitForOwnedFilesUntil(home, Date.now() + timeout);
}

async function waitForOwnedFilesUntil(home: string, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    const [lock, socket] = await Promise.all([
      Bun.file(join(home, "daemon.lock")).exists(),
      Bun.file(join(home, "work-craft.sock")).exists(),
    ]);
    if (!lock && !socket) {
      return true;
    }
    await Bun.sleep(20);
  }
  return false;
}

async function readLockPid(home: string): Promise<number | undefined> {
  let value: string;
  try {
    value = await Bun.file(join(home, "daemon.lock")).text();
  } catch {
    return undefined;
  }
  if (!/^[1-9]\d*\n?$/.test(value)) {
    return undefined;
  }
  const pid = Number(value.trim());
  return Number.isSafeInteger(pid) ? pid : undefined;
}

type ProcessObservation =
  | { status: "matching"; command: string }
  | { status: "absent" }
  | { status: "mismatch"; command: string }
  | { status: "error"; reason: string };

type ObserverProcess = {
  exited: Promise<number>;
  exitCode: number | null;
  stdout: ReadableStream<Uint8Array>;
  kill(signal?: NodeJS.Signals | number): void;
};

function spawnProcessObserver(pid: number): ObserverProcess {
  return Bun.spawn(["ps", "-p", String(pid), "-o", "command="], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
}

async function processCommand(
  pid: number,
  expectedCommand: string,
  options: { timeout?: number; spawn?: () => ObserverProcess } = {},
): Promise<ProcessObservation> {
  const child = (options.spawn ?? (() => spawnProcessObserver(pid)))();
  const output = new Response(child.stdout).text();
  const completed = await Promise.race([
    Promise.all([child.exited, output]),
    Bun.sleep(options.timeout ?? PROBE_TIMEOUT).then(() => undefined),
  ]);
  if (completed === undefined) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await child.exited;
    await output.catch(() => "");
    return { status: "error", reason: "process observer timed out" };
  }

  const [exitCode, rawOutput] = completed;
  const command = rawOutput.trim();
  if (exitCode === 1) {
    return command === ""
      ? { status: "absent" }
      : { status: "error", reason: "ps reported absence with output" };
  }
  if (exitCode !== 0) {
    return { status: "error", reason: `unexpected ps exit ${exitCode}` };
  }
  if (command === "" || command.includes("\n")) {
    return { status: "error", reason: "malformed ps output" };
  }
  return command === expectedCommand
    ? { status: "matching", command }
    : { status: "mismatch", command };
}

type ProcessObserver = typeof processCommand;

async function waitForProcessExit(
  pid: number,
  expectedCommand: string,
  deadline: number,
  observeProcess: ProcessObserver = processCommand,
): Promise<void> {
  while (Date.now() < deadline) {
    const observation = await observeProcess(pid, expectedCommand, {
      timeout: Math.max(1, Math.min(PROBE_TIMEOUT, deadline - Date.now())),
    });
    if (observation.status === "absent") {
      return;
    }
    if (observation.status !== "matching") {
      throw new Error(
        observation.status === "error"
          ? observation.reason
          : `process command changed to ${observation.command}`,
      );
    }
    await Bun.sleep(20);
  }
  throw new Error(`PID ${pid} did not exit before cleanup deadline`);
}

function cleanupError(home: string, cause?: unknown): Error {
  return new Error(
    `Work Craft cleanup could not confirm shutdown; preserved ${home} (lock: ${join(home, "daemon.lock")}, socket: ${join(home, "work-craft.sock")})`,
    cause === undefined ? undefined : { cause },
  );
}

function cleanupSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(PROBE_TIMEOUT, deadline - Date.now())));
}

async function cleanupRequest(
  socketPath: string,
  path: string,
  deadline: number,
  init?: RequestInit,
): Promise<unknown> {
  if (Date.now() >= deadline) {
    throw new Error("cleanup deadline exceeded");
  }
  const response = await fetch(`http://localhost${path}`, {
    ...init,
    unix: socketPath,
    signal: cleanupSignal(deadline),
  });
  if (!response.ok) {
    throw new Error(`cleanup request failed with status ${response.status}`);
  }
  return response.json();
}

async function cleanupHealth(
  socketPath: string,
  deadline: number,
): Promise<{ epoch: string; pid: number } | undefined> {
  try {
    const value = await cleanupRequest(socketPath, "/health", deadline);
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const health = value as Record<string, unknown>;
    if (
      typeof health.epoch !== "string" ||
      !Number.isSafeInteger(health.pid) ||
      (health.pid as number) <= 0
    ) {
      return undefined;
    }
    return { epoch: health.epoch, pid: health.pid as number };
  } catch {
    return undefined;
  }
}

async function cleanup(
  home: string,
  observeProcess: ProcessObserver = processCommand,
): Promise<void> {
  const lockPath = join(home, "daemon.lock");
  const socketPath = join(home, "work-craft.sock");
  const deadline = Date.now() + CLEANUP_TIMEOUT;
  try {
    await cleanupRequest(socketPath, "/command", deadline, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "daemon.stop" }),
    });
  } catch {}

  if (await waitForOwnedFilesUntil(home, Math.min(deadline, Date.now() + 1_000))) {
    await rm(home, { recursive: true, force: true });
    return;
  }

  const health = await cleanupHealth(socketPath, deadline);
  const pid = await readLockPid(home);
  const confirmed = await cleanupHealth(socketPath, deadline);
  if (
    pid !== undefined &&
    health?.pid === pid &&
    confirmed?.pid === pid &&
    health.epoch === confirmed.epoch
  ) {
    const observation = await observeProcess(pid, SERVER_COMMAND, {
      timeout: Math.max(1, Math.min(PROBE_TIMEOUT, deadline - Date.now())),
    });
    const finalHealth = await cleanupHealth(socketPath, deadline);
    if (
      observation.status === "matching" &&
      finalHealth?.pid === pid &&
      finalHealth.epoch === health.epoch
    ) {
      process.kill(pid, "SIGKILL");
      try {
        await waitForProcessExit(pid, observation.command, deadline, observeProcess);
      } catch (cause) {
        throw cleanupError(home, cause);
      }
      await rm(lockPath, { force: true });
      await rm(socketPath, { force: true });
      if (!(await waitForOwnedFilesUntil(home, Math.min(deadline, Date.now() + 100)))) {
        throw cleanupError(home);
      }
      await rm(home, { recursive: true, force: true });
      return;
    }
  }

  if (await waitForOwnedFilesUntil(home, deadline)) {
    await rm(home, { recursive: true, force: true });
    return;
  }
  throw cleanupError(home);
}

test("creates resources and controls surfaces through canonical commands", async () => {
  const home = await tempHome();
  try {
    const session = await runJson(home, ["session", "create", "--name", "Main"]);
    const workspace = await runJson(home, [
      "workspace",
      "create",
      "--session",
      String(session.id),
      "--name",
      "Work",
    ]);
    const project = await runJson(home, [
      "project",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "implementation",
      "--name",
      "Work Craft",
    ]);
    const item = await runJson(home, [
      "item",
      "create",
      "--project",
      String(project.id),
      "--kind",
      "surface",
      "--title",
      "CLI Seed",
      "--data",
      '{"source":"cli"}',
    ]);
    const ensured = await runJson(home, [
      "surface",
      "ensure",
      "--item",
      String(item.id),
      "--cwd",
      home,
    ]);
    const tab = await runJson(home, [
      "tab",
      "create",
      "--surface",
      String(ensured.surfaceId),
      "--title",
      "Second",
    ]);
    await runJson(home, ["surface", "select-tab", String(ensured.surfaceId), String(tab.tabId)]);
    const split = await runJson(home, [
      "pane",
      "split",
      String(tab.paneId),
      "--direction",
      "vertical",
      "--cwd",
      home,
    ]);
    await runJson(home, ["pane", "restart", String(split.paneId)]);
    const projectSurface = await runJson(home, [
      "surface",
      "ensure",
      "--project",
      String(project.id),
    ]);
    const snapshot = await runJson(home, ["snapshot"]);

    const sessions = snapshot.sessions as Array<Record<string, unknown>>;
    const workspaces = snapshot.workspaces as Array<Record<string, unknown>>;
    const sessionWorkspaces = snapshot.sessionWorkspaces as Array<Record<string, unknown>>;
    const projects = snapshot.projects as Array<Record<string, unknown>>;
    const items = snapshot.items as Array<Record<string, unknown>>;
    const surfaces = snapshot.surfaces as Array<Record<string, unknown>>;
    const tabs = snapshot.tabs as Array<Record<string, unknown>>;

    expect(sessions).toContainEqual(expect.objectContaining({ id: session.id, name: "Main" }));
    expect(workspaces).toContainEqual(expect.objectContaining({ id: workspace.id, name: "Work" }));
    expect(sessionWorkspaces).toContainEqual({
      sessionId: session.id,
      workspaceId: workspace.id,
      position: 0,
    });
    expect(projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        workspaceId: workspace.id,
        category: "implementation",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ id: item.id, projectId: project.id, data: { source: "cli" } }),
    );
    expect(surfaces).toContainEqual(
      expect.objectContaining({ id: ensured.surfaceId, itemId: item.id, activeTabId: tab.tabId }),
    );
    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: tab.tabId,
        layout: expect.objectContaining({ type: "split", direction: "vertical" }),
      }),
    );
    expect(surfaces).toContainEqual(expect.objectContaining({ id: projectSurface.surfaceId }));
    const projectTerminal = items.find(
      ({ data }) => (data as Record<string, unknown>).scope === "project-terminal",
    );
    expect(projectTerminal?.id).toBe(projectSurface.itemId);

    const status = await runJson(home, ["daemon", "status"]);
    expect(status).toEqual(
      expect.objectContaining({
        running: true,
        pid: expect.any(Number),
        counts: expect.any(Object),
      }),
    );
    expect(await runJson(home, ["daemon", "stop"])).toEqual({ id: "daemon", stopping: true });
    expect(await waitForOwnedFiles(home)).toBe(true);

    expect(await runCli(home, ["daemon", "stop"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Stopped Work Craft\n",
    });
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("prints representative mutation and snapshot output", async () => {
  const home = await tempHome();
  try {
    const createdSession = await runCli(home, ["session", "create", "--name", "Main"]);
    expect(createdSession.exitCode).toBe(0);
    expect(createdSession.stderr).toBe("");
    expect(createdSession.stdout).toMatch(/^ID: .+\n$/);
    const sessionId = createdSession.stdout.slice("ID: ".length).trim();
    const workspace = await runJson(home, [
      "workspace",
      "create",
      "--session",
      sessionId,
      "--name",
      "Work",
    ]);
    const project = await runJson(home, [
      "project",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "implementation",
      "--name",
      "Work Craft",
    ]);
    const item = await runJson(home, [
      "item",
      "create",
      "--project",
      String(project.id),
      "--kind",
      "surface",
      "--title",
      "CLI Plain",
    ]);

    const ensured = await runCli(home, ["surface", "ensure", "--item", String(item.id)]);
    expect(ensured.exitCode).toBe(0);
    expect(ensured.stderr).toBe("");
    expect(ensured.stdout).toMatch(new RegExp(`^Item: ${item.id}\\nSurface: [0-9a-f-]+\\n$`));

    expect(await runCli(home, ["snapshot"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout:
        `Main\n` +
        `  Work\n` +
        `    Inbox\n` +
        `    Today\n` +
        `    Design\n` +
        `    Implementation\n` +
        `      Work Craft\n` +
        `        CLI Plain [${item.id}]\n` +
        `    Collaboration\n` +
        `    Operations\n`,
    });
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("rejects invalid invocation with usage and exit 2", async () => {
  const home = await tempHome();
  try {
    expect(await runCli(home, ["list"])).toEqual({ exitCode: 2, stdout: "", stderr: USAGE });
  } finally {
    await cleanup(home);
  }
});

test("destroy removes stopped state without restoring panes", async () => {
  const home = await tempHome();
  const shellPath = join(home, "test-shell");
  const startedPath = join(home, "shell-started");
  const env = { SHELL: shellPath, WORK_CRAFT_TEST_STARTED: startedPath };
  await writeFile(
    shellPath,
    "#!/bin/sh\nprintf started > \"$WORK_CRAFT_TEST_STARTED\"\ntrap 'exit 0' TERM\nwhile :; do sleep 0.1; done\n",
    { mode: 0o755 },
  );
  try {
    await runCli(home, ["daemon", "status"], env);
    const items = await seedItems(home);
    expect((await runCli(home, ["surface", "ensure", "--item", items.first], env)).exitCode).toBe(
      0,
    );
    await waitForPath(startedPath);
    expect((await runCli(home, ["daemon", "stop"], env)).exitCode).toBe(0);
    await rm(startedPath, { force: true });

    expect(await runCli(home, ["daemon", "destroy", "--force"], env)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Destroyed Work Craft\n",
    });
    expect(await Bun.file(startedPath).exists()).toBe(false);
    expect(await Bun.file(shellPath).exists()).toBe(true);
    expect(await Bun.file(join(home, "work-craft.sqlite")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sqlite-wal")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sqlite-shm")).exists()).toBe(false);
    expect(await Bun.file(join(home, "daemon.lock")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sock")).exists()).toBe(false);
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("destroy removes corrupt persisted state", async () => {
  const home = await tempHome();
  await writeFile(join(home, "work-craft.sqlite"), new Uint8Array(16));
  try {
    expect(await runCli(home, ["daemon", "destroy", "--force"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Destroyed Work Craft\n",
    });
    expect(await Bun.file(join(home, "work-craft.sqlite")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sqlite-wal")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sqlite-shm")).exists()).toBe(false);
    expect(await Bun.file(join(home, "daemon.lock")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sock")).exists()).toBe(false);
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("requires force before starting daemon or deleting persisted state", async () => {
  const home = await tempHome();
  const databasePath = join(home, "work-craft.sqlite");
  await writeFile(databasePath, "keep");
  try {
    expect(await runCli(home, ["daemon", "destroy"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: USAGE,
    });
    expect(await Bun.file(databasePath).text()).toBe("keep");
    expect(await Bun.file(join(home, "daemon.lock")).exists()).toBe(false);
    expect(await Bun.file(join(home, "work-craft.sock")).exists()).toBe(false);
  } finally {
    await cleanup(home);
  }
});

test("reports command failures without usage or a stack", async () => {
  const home = await tempHome();
  try {
    expect(await runCli(home, ["surface", "ensure", "--item", "missing-item"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "item not found\n",
    });
  } finally {
    await cleanup(home);
  }
}, 10_000);

test("reports runtime startup failures while preserving pane state", async () => {
  const home = await tempHome();
  const shellPath = join(home, "missing-shell");
  const env = { SHELL: shellPath };
  try {
    await runCli(home, ["daemon", "status"], env);
    const items = await seedItems(home);

    expect(await runCli(home, ["surface", "ensure", "--item", items.first], env)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Shell executable not found: ${shellPath}\n`,
    });

    const snapshot = await createClient({ socketPath: join(home, "work-craft.sock") }).snapshot();
    expect(snapshot.panes).toContainEqual(
      expect.objectContaining({
        processStatus: "failed",
        errorText: `Shell executable not found: ${shellPath}`,
      }),
    );
  } finally {
    await cleanup(home);
  }
}, 10_000);

test("cleanup never signals PIDs from empty, malformed, or stale locks", async () => {
  const kill = spyOn(process, "kill").mockImplementation(() => {
    throw new Error("signal blocked by test");
  });
  const homes: string[] = [];
  try {
    for (const contents of ["", "not-a-pid\n", `${process.pid}\n`]) {
      const home = await tempHome();
      homes.push(home);
      await writeFile(join(home, "daemon.lock"), contents);
    }
    await Promise.all(
      homes.map((home) =>
        expect(cleanup(home)).rejects.toThrow(
          `Work Craft cleanup could not confirm shutdown; preserved ${home}`,
        ),
      ),
    );
    expect(kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
    await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
  }
}, 10_000);

test("cleanup preserves the home when shutdown cannot be confirmed", async () => {
  const home = await tempHome();
  const lockPath = join(home, "daemon.lock");
  const socketPath = join(home, "work-craft.sock");
  await writeFile(lockPath, `${process.pid}\n`);
  let server: Bun.Server<undefined>;
  server = Bun.serve({
    unix: socketPath,
    fetch(request) {
      if (new URL(request.url).pathname === "/command") {
        setTimeout(() => {
          void (async () => {
            await server.stop(true);
            if (!(await Bun.file(socketPath).exists())) {
              await writeFile(socketPath, "stale");
            }
          })();
        }, 0);
        return Response.json({
          ok: true,
          revision: 0,
          result: { id: "daemon", stopping: true },
        });
      }
      return Response.json({ epoch: "test", revision: 0, pid: process.pid });
    },
  });
  const kill = spyOn(process, "kill").mockImplementation(() => {
    throw new Error("signal blocked by test");
  });
  try {
    await expect(cleanup(home)).rejects.toThrow(
      `Work Craft cleanup could not confirm shutdown; preserved ${home} (lock: ${lockPath}, socket: ${socketPath})`,
    );
    expect(kill).not.toHaveBeenCalled();
    expect((await stat(home)).isDirectory()).toBe(true);
    expect(await Bun.file(lockPath).exists()).toBe(true);
    expect(await Bun.file(socketPath).exists()).toBe(true);
  } finally {
    kill.mockRestore();
    await server.stop(true);
    await rm(home, { recursive: true, force: true });
  }
});

test("cleanup bounds non-responsive HTTP and preserves the home", async () => {
  const home = await tempHome();
  const lockPath = join(home, "daemon.lock");
  const socketPath = join(home, "work-craft.sock");
  await writeFile(lockPath, `${process.pid}\n`);
  const server = Bun.serve({
    unix: socketPath,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  const kill = spyOn(process, "kill").mockImplementation(() => {
    throw new Error("signal blocked by test");
  });
  const startedAt = performance.now();
  const result = cleanup(home).then(
    () => ({ status: "resolved" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  try {
    const settled = await Promise.race([
      result,
      Bun.sleep(3_500).then(() => ({ status: "timed-out" as const })),
    ]);
    expect(settled.status).toBe("rejected");
    expect(performance.now() - startedAt).toBeLessThan(3_500);
    expect(kill).not.toHaveBeenCalled();
    expect((await stat(home)).isDirectory()).toBe(true);
    expect(await Bun.file(lockPath).exists()).toBe(true);
    expect((await stat(socketPath)).isSocket()).toBe(true);
  } finally {
    kill.mockRestore();
    await server.stop(true);
    await result;
    await rm(home, { recursive: true, force: true });
  }
}, 10_000);

test("process observer distinguishes timeout, errors, absence, and mismatch", async () => {
  let timeoutChild: ObserverProcess | undefined;
  try {
    const timeout = await processCommand(42, "expected", {
      timeout: 50,
      spawn: () =>
        (timeoutChild = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10_000)"], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        })),
    });
    const unexpectedExit = await processCommand(42, "expected", {
      timeout: 100,
      spawn: () =>
        Bun.spawn([process.execPath, "-e", "process.exit(2)"], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        }),
    });
    const malformedAbsence = await processCommand(42, "expected", {
      timeout: 100,
      spawn: () =>
        Bun.spawn([process.execPath, "-e", 'process.stdout.write("noise"); process.exit(1)'], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        }),
    });
    const absent = await processCommand(42, "expected", {
      timeout: 100,
      spawn: () =>
        Bun.spawn([process.execPath, "-e", "process.exit(1)"], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        }),
    });
    const mismatch = await processCommand(42, "expected", {
      timeout: 100,
      spawn: () =>
        Bun.spawn([process.execPath, "-e", 'process.stdout.write("other\\n")'], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        }),
    });

    expect(timeout).toEqual({ status: "error", reason: "process observer timed out" });
    expect(
      await Promise.race([timeoutChild!.exited.then(() => true), Bun.sleep(100).then(() => false)]),
    ).toBe(true);
    expect(unexpectedExit).toEqual({ status: "error", reason: "unexpected ps exit 2" });
    expect(malformedAbsence).toEqual({
      status: "error",
      reason: "ps reported absence with output",
    });
    expect(absent).toEqual({ status: "absent" });
    expect(mismatch).toEqual({ status: "mismatch", command: "other" });
  } finally {
    if (timeoutChild?.exitCode === null) {
      timeoutChild.kill("SIGKILL");
      await timeoutChild.exited;
    }
  }
});

test("cleanup preserves owned files when post-kill observation is uncertain", async () => {
  const outcomes: ProcessObservation[] = [
    { status: "error", reason: "process observer timed out" },
    { status: "error", reason: "unexpected ps exit 2" },
    { status: "mismatch", command: "other" },
  ];
  const reasons = [
    "process observer timed out",
    "unexpected ps exit 2",
    "process command changed to other",
  ];
  const cases: Array<{
    home: string;
    lockPath: string;
    socketPath: string;
    server: Bun.Server<undefined>;
    result: Promise<{ status: "resolved" } | { status: "rejected"; error: unknown }>;
  }> = [];
  const kill = spyOn(process, "kill").mockImplementation(() => true);

  try {
    for (const [index, outcome] of outcomes.entries()) {
      const home = await tempHome();
      const lockPath = join(home, "daemon.lock");
      const socketPath = join(home, "work-craft.sock");
      await writeFile(lockPath, `${process.pid}\n`);
      const server = Bun.serve({
        unix: socketPath,
        fetch(request) {
          if (new URL(request.url).pathname === "/command") {
            return Response.json({
              ok: true,
              revision: 0,
              result: { id: "daemon", stopping: true },
            });
          }
          return Response.json({ epoch: `test-${index}`, revision: 0, pid: process.pid });
        },
      });
      let observations = 0;
      const result = cleanup(home, async (_pid, expectedCommand) => {
        observations += 1;
        return observations === 1 ? { status: "matching", command: expectedCommand } : outcome;
      }).then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      cases.push({ home, lockPath, socketPath, server, result });
    }

    const settled = await Promise.all(
      cases.map(({ result }) =>
        Promise.race([result, Bun.sleep(3_500).then(() => ({ status: "timed-out" as const }))]),
      ),
    );
    for (const [index, result] of settled.entries()) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.error).toBeInstanceOf(Error);
        const error = result.error as Error;
        expect(error.message).toBe(cleanupError(cases[index]!.home).message);
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as Error).message).toBe(reasons[index]);
      }
      expect((await stat(cases[index]!.home)).isDirectory()).toBe(true);
      expect(await Bun.file(cases[index]!.lockPath).exists()).toBe(true);
      expect((await stat(cases[index]!.socketPath)).isSocket()).toBe(true);
    }
    expect(kill.mock.calls).toEqual(outcomes.map(() => [process.pid, "SIGKILL"]));
  } finally {
    kill.mockRestore();
    await Promise.all(cases.map(({ server }) => server.stop(true)));
    await Promise.all(cases.map(({ result }) => result));
    await Promise.all(cases.map(({ home }) => rm(home, { recursive: true, force: true })));
  }
}, 10_000);

test("retries status reads until snapshot and health revisions match", async () => {
  const emptySnapshot = {
    epoch: "epoch",
    revision: 1,
    sessions: [],
    workspaces: [],
    sessionWorkspaces: [],
    categories: [],
    projects: [],
    items: [],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
  };
  const snapshots = [
    emptySnapshot,
    {
      ...emptySnapshot,
      revision: 2,
      sessions: [{ id: "session", name: "Main", position: 0 }],
    },
  ];
  let snapshotCalls = 0;
  let healthCalls = 0;
  const client = {
    async snapshot() {
      return snapshots[snapshotCalls++]!;
    },
    async health() {
      healthCalls += 1;
      return { epoch: "epoch", revision: 2, pid: 42 };
    },
  } satisfies Pick<WorkCraftClient, "health" | "snapshot">;

  expect(await readStatus(client)).toEqual({
    running: true,
    pid: 42,
    epoch: "epoch",
    revision: 2,
    counts: {
      sessions: 1,
      workspaces: 0,
      categories: 0,
      projects: 0,
      items: 0,
      surfaces: 0,
      tabs: 0,
      panes: 0,
    },
  });
  expect([snapshotCalls, healthCalls]).toEqual([2, 2]);
});

test("bounds incoherent status reads", async () => {
  let calls = 0;
  const client = {
    async snapshot() {
      calls += 1;
      return {
        epoch: "old",
        revision: calls,
        sessions: [],
        workspaces: [],
        sessionWorkspaces: [],
        categories: [],
        projects: [],
        items: [],
        surfaces: [],
        tabs: [],
        panes: [],
        terminalHistories: [],
      };
    },
    async health() {
      return { epoch: "new", revision: calls, pid: 42 };
    },
  } satisfies Pick<WorkCraftClient, "health" | "snapshot">;

  await expect(readStatus(client)).rejects.toThrow("could not read coherent daemon status");
  expect(calls).toBe(3);
});

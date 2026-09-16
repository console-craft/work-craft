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

async function runCli(home: string, args: string[]): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: ROOT,
    env: { ...process.env, WORK_CRAFT_HOME: home, NO_COLOR: "1" },
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

async function waitForProcessExit(
  pid: number,
  expectedCommand: string,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const observation = await processCommand(pid, expectedCommand, {
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

async function cleanup(home: string): Promise<void> {
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
    const observation = await processCommand(pid, SERVER_COMMAND, {
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
        await waitForProcessExit(pid, observation.command, deadline);
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

test("starts, lists, opens, reports status, and stops", async () => {
  const home = await tempHome();
  try {
    const initialStatus = await runCli(home, ["status", "--json"]);
    expect(initialStatus.exitCode).toBe(0);
    expect(initialStatus.stderr).toBe("");
    expect(JSON.parse(initialStatus.stdout)).toEqual({
      running: true,
      pid: expect.any(Number),
      epoch: expect.any(String),
      revision: 0,
      counts: {
        sessions: 0,
        workspaces: 0,
        categories: 0,
        projects: 0,
        items: 0,
        surfaces: 0,
        tabs: 0,
        panes: 0,
      },
    });

    const items = await seedItems(home);
    const client = createClient({ socketPath: join(home, "work-craft.sock") });
    const expectedSnapshot = await client.snapshot();
    const listedJson = await runCli(home, ["list", "--json"]);
    expect(listedJson.exitCode).toBe(0);
    expect(listedJson.stderr).toBe("");
    expect(JSON.parse(listedJson.stdout)).toEqual(expectedSnapshot);
    expect(Object.keys(expectedSnapshot)).toEqual([
      "epoch",
      "revision",
      "sessions",
      "workspaces",
      "categories",
      "projects",
      "items",
      "surfaces",
      "tabs",
      "panes",
      "terminalHistories",
    ]);

    const listed = await runCli(home, ["list"]);
    expect(listed).toEqual({
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
        `        CLI JSON [${items.first}]\n` +
        `        CLI Plain [${items.second}]\n` +
        `    Collaboration\n` +
        `    Operations\n`,
    });

    const openedJson = await runCli(home, ["open", items.first, "--cwd", home, "--json"]);
    expect(openedJson.exitCode).toBe(0);
    expect(openedJson.stderr).toBe("");
    const openResult = JSON.parse(openedJson.stdout);
    expect(openResult).toEqual({
      id: expect.any(String),
      itemId: items.first,
      surfaceId: expect.any(String),
      tabId: expect.any(String),
      paneId: expect.any(String),
    });
    expect((await client.snapshot()).panes.find(({ id }) => id === openResult.paneId)?.cwd).toBe(
      home,
    );
    expect(await runCli(home, ["open", items.first])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Surface: ${openResult.surfaceId}\nPane: ${openResult.paneId}\n`,
    });

    const opened = await runCli(home, ["open", items.second]);
    expect(opened.exitCode).toBe(0);
    expect(opened.stderr).toBe("");
    expect(opened.stdout).toMatch(/^Surface: [0-9a-f-]+\nPane: [0-9a-f-]+\n$/);

    const statusJson = JSON.parse((await runCli(home, ["status", "--json"])).stdout);
    const status = await runCli(home, ["status"]);
    expect(status).toEqual({
      exitCode: 0,
      stderr: "",
      stdout:
        `Running: true\n` +
        `PID: ${statusJson.pid}\n` +
        `Epoch: ${statusJson.epoch}\n` +
        `Revision: ${statusJson.revision}\n` +
        `Sessions: ${statusJson.counts.sessions}\n` +
        `Workspaces: ${statusJson.counts.workspaces}\n` +
        `Categories: ${statusJson.counts.categories}\n` +
        `Projects: ${statusJson.counts.projects}\n` +
        `Items: ${statusJson.counts.items}\n` +
        `Surfaces: ${statusJson.counts.surfaces}\n` +
        `Tabs: ${statusJson.counts.tabs}\n` +
        `Panes: ${statusJson.counts.panes}\n`,
    });

    const stoppedJson = await runCli(home, ["stop", "--json"]);
    expect(stoppedJson).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: '{"id":"daemon","stopping":true}\n',
    });
    expect(await waitForOwnedFiles(home)).toBe(true);

    expect(await runCli(home, ["stop"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Stopped Work Craft\n",
    });
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("rejects malformed command lines with usage and exit 2", async () => {
  const home = await tempHome();
  const cases = [
    [],
    ["unknown"],
    ["--json", "list"],
    ["list", "extra"],
    ["list", "--cwd", "/tmp"],
    ["list", "--json", "--json"],
    ["status", "extra"],
    ["status", "--json", "--json"],
    ["stop", "extra"],
    ["stop", "--json", "--json"],
    ["open"],
    ["open", "--json"],
    ["open", "item", "extra"],
    ["open", "item", "--unknown"],
    ["open", "item", "--json", "--json"],
    ["open", "item", "--cwd"],
    ["open", "item", "--cwd", "one", "--cwd", "two"],
    ["open", "item", "--cwd", "one", "extra"],
  ];
  try {
    for (const args of cases) {
      expect(await runCli(home, args)).toEqual({ exitCode: 2, stdout: "", stderr: USAGE });
    }
  } finally {
    await cleanup(home);
  }
}, 20_000);

test("reports command failures without usage or a stack", async () => {
  const home = await tempHome();
  try {
    expect(await runCli(home, ["open", "missing-item"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "item not found\n",
    });
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

test("retries status reads until snapshot and health revisions match", async () => {
  const emptySnapshot = {
    epoch: "epoch",
    revision: 1,
    sessions: [],
    workspaces: [],
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

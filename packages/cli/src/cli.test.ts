import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, decodeBytes, type WorkCraftClient } from "@work-craft/server/client";

import { sendTerminalInput } from "../../../scripts/test-support/terminal-input.ts";
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
  cwd = ROOT,
): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
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
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "design",
    title: "Work Craft",
  });
  const first = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "design",
    parentId: project.result.id,
    title: "CLI JSON",
  });
  const second = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "design",
    parentId: project.result.id,
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
      "item",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "design",
      "--title",
      "Work Craft",
    ]);
    const item = await runJson(home, [
      "item",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "design",
      "--parent",
      String(project.id),
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
    const legacySelection = await runCli(home, [
      "surface",
      "select-tab",
      String(ensured.surfaceId),
      String(tab.tabId),
    ]);
    expect(legacySelection.exitCode).not.toBe(0);
    expect(legacySelection.stderr).toContain("session select <session-id> --tab <id>");
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
    const projectSurface = await runJson(home, ["surface", "ensure", "--item", String(project.id)]);
    const snapshot = await runJson(home, ["snapshot"]);

    const sessions = snapshot.sessions as Array<Record<string, unknown>>;
    const workspaces = snapshot.workspaces as Array<Record<string, unknown>>;
    const sessionWorkspaces = snapshot.sessionWorkspaces as Array<Record<string, unknown>>;
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
    expect(items).toContainEqual(
      expect.objectContaining({
        id: project.id,
        workspaceId: workspace.id,
        category: "design",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ id: item.id, parentId: project.id, data: { source: "cli" } }),
    );
    expect(surfaces).toContainEqual(
      expect.objectContaining({ id: ensured.surfaceId, itemId: item.id }),
    );
    expect(tabs).toContainEqual(
      expect.objectContaining({
        id: tab.tabId,
        layout: expect.objectContaining({ type: "split", direction: "vertical" }),
      }),
    );
    expect(surfaces).toContainEqual(expect.objectContaining({ id: projectSurface.surfaceId }));
    expect(projectSurface.itemId).toBe(project.id);
    expect(items).toHaveLength(2);

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

test("split text and JSON preserve shape, inherit live cwd and validate client-relative overrides", async () => {
  const home = await realpath(await tempHome());
  const live = join(home, "live cwd 雪");
  const override = join(home, "override");
  await mkdir(live);
  await mkdir(override);
  const client = createClient({ socketPath: join(home, "work-craft.sock") });
  let stream: Awaited<ReturnType<WorkCraftClient["stream"]>> | undefined;
  try {
    expect((await runCli(home, ["daemon", "status"], { SHELL: "/bin/sh" })).exitCode).toBe(0);
    const items = await seedItems(home);
    const opened = await runJson(home, ["surface", "ensure", "--item", items.first, "--cwd", home]);
    const sourceId = String(opened.paneId);
    stream = await client.stream({ onMessage() {} });
    await sendTerminalInput(
      client,
      stream,
      sourceId,
      new TextEncoder().encode(`cd '${live}'; printf 'CLI-%s\\n' ready\n`),
    );
    await waitForOutput(sourceId, "CLI-ready");
    const plain = await runCli(home, ["pane", "split", sourceId, "--direction", "vertical"]);
    const afterPlain = await client.snapshot();
    const inherited = afterPlain.panes.find(({ id }) => id !== sourceId)!;
    expect(plain).toEqual({ exitCode: 0, stderr: "", stdout: `Pane: ${inherited.id}\n` });
    expect(inherited.cwd).toBe(live);
    await sendTerminalInput(
      client,
      stream,
      inherited.id,
      new TextEncoder().encode("printf 'INHERITED-%s\\n' \"$(pwd)\"\n"),
    );
    await waitForOutput(inherited.id, `INHERITED-${live}`);

    const json = await runCli(
      home,
      ["pane", "split", sourceId, "--direction", "horizontal", "--cwd", "override", "--json"],
      {},
      home,
    );
    expect(json.exitCode).toBe(0);
    expect(json.stderr).toBe("");
    const afterJson = await client.snapshot();
    const overridden = afterJson.panes.find(
      ({ id }) => !afterPlain.panes.some((pane) => pane.id === id),
    )!;
    expect(JSON.parse(json.stdout)).toEqual({
      id: overridden.id,
      paneId: overridden.id,
      surfaceId: opened.surfaceId,
      tabId: opened.tabId,
    });
    expect(overridden.cwd).toBe(override);
    await sendTerminalInput(
      client,
      stream,
      overridden.id,
      new TextEncoder().encode("printf 'OVERRIDE-%s\\n' \"$(pwd)\"\n"),
    );
    await waitForOutput(overridden.id, `OVERRIDE-${override}`);

    await writeFile(join(home, "not-directory"), "not a directory");
    for (const cwd of ["missing", "not-directory"]) {
      const before = await client.snapshot();
      const rejected = await runCli(
        home,
        ["pane", "split", sourceId, "--direction", "vertical", "--cwd", cwd],
        {},
        home,
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stdout).toBe("");
      expect(rejected.stderr).toContain("unavailable");
      const after = await client.snapshot();
      expect(after.panes).toEqual(before.panes);
      expect(after.tabs).toEqual(before.tabs);
      expect(after.revision).toBe(before.revision);
    }
    await sendTerminalInput(client, stream, sourceId, new TextEncoder().encode("exit\n"));
    const deadline = Date.now() + 3_000;
    let stopped = await client.snapshot();
    while (
      stopped.panes.find(({ id }) => id === sourceId)?.processStatus !== "exited" &&
      Date.now() < deadline
    ) {
      await Bun.sleep(20);
      stopped = await client.snapshot();
    }
    expect(stopped.panes.find(({ id }) => id === sourceId)?.processStatus).toBe("exited");
    const unavailable = await runCli(home, ["pane", "split", sourceId, "--direction", "vertical"]);
    expect(unavailable.exitCode).toBe(1);
    expect(unavailable.stdout).toBe("");
    expect(unavailable.stderr).toContain("live runtime");
    const after = await client.snapshot();
    expect(after.panes).toEqual(stopped.panes);
    expect(after.tabs).toEqual(stopped.tabs);
    expect(after.revision).toBe(stopped.revision);

    async function waitForOutput(paneId: string, text: string): Promise<void> {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const snapshot = await client.snapshot();
        const history = snapshot.terminalHistories.find((entry) => entry.paneId === paneId);
        if (new TextDecoder().decode(decodeBytes(history?.data ?? "")).includes(text)) {
          return;
        }
        await Bun.sleep(20);
      }
      throw new Error(`Timed out waiting for ${text} in ${paneId}`);
    }
  } finally {
    stream?.close();
    await cleanup(home);
  }
}, 20000);

test("registration resolves relative to client not daemon and archive restore have text and JSON parity", async () => {
  const home = await tempHome();
  try {
    const session = await runJson(home, ["session", "create", "--name", "Main"], {
      SHELL: "/bin/sh",
    });
    const workspace = await runJson(home, [
      "workspace",
      "create",
      "--session",
      String(session.id),
      "--name",
      "Work",
    ]);
    const target = join(home, " checkout ");
    const external = join(home, "external tree");
    await mkdir(target);
    function git(...args: string[]): void {
      const result = Bun.spawnSync(["git", "-C", target, ...args], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      });
      expect(result.stderr.toString() + result.exitCode).not.toContain("fatal:");
      expect(result.success).toBe(true);
    }
    git("init", "--initial-branch=trunk");
    git("commit", "--allow-empty", "-m", "initial");
    git("worktree", "add", "-b", "feature", external);
    const registration = await runCli(
      home,
      [
        "directory",
        "register",
        "--workspace",
        String(workspace.id),
        "--path",
        "external tree",
        "--json",
      ],
      {},
      home,
    );
    expect(registration.exitCode).toBe(0);
    expect(registration.stderr).toBe("");
    const linked = JSON.parse(registration.stdout) as {
      id: string;
      itemId: string;
      rootItemId: string;
    };
    expect(linked.id).toBe(linked.itemId);
    expect(linked.rootItemId).toEqual(expect.any(String));
    expect(linked.id).not.toBe(linked.rootItemId);
    const root = { id: linked.rootItemId };
    const client = createClient({ socketPath: join(home, "work-craft.sock") });
    let snapshot = await client.snapshot();
    expect(snapshot.items.find((item) => item.id === root.id)).toMatchObject({
      kind: "directory",
      title: " checkout ",
      data: { path: await realpath(target), branch: "trunk" },
    });
    const child = snapshot.items.find((item) => item.parentId === root.id)!;
    expect(child.id).toBe(linked.id);
    expect(child).toMatchObject({
      kind: "worktree",
      data: { path: await realpath(external), branch: "feature" },
    });
    expect(snapshot.surfaces).toEqual([]);
    expect(
      await runJson(home, [
        "directory",
        "register",
        "--workspace",
        String(workspace.id),
        "--path",
        target,
      ]),
    ).toEqual({ id: root.id, itemId: root.id, rootItemId: root.id });
    const repeatedLinked = await runJson(home, [
      "directory",
      "register",
      "--workspace",
      String(workspace.id),
      "--path",
      external,
    ]);
    expect(repeatedLinked).toEqual(linked);
    expect(
      await runCli(home, [
        "directory",
        "register",
        "--workspace",
        String(workspace.id),
        "--path",
        external,
      ]),
    ).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `ID: ${child.id}\nRoot: ${root.id}\n`,
    });
    const repeatedSnapshot = await client.snapshot();
    expect(repeatedSnapshot.revision).toBe(snapshot.revision);
    expect(repeatedSnapshot.items).toHaveLength(2);
    expect(repeatedSnapshot.surfaces).toEqual([]);
    expect(repeatedSnapshot.panes).toEqual([]);
    const opened = await runJson(home, ["surface", "ensure", "--item", child.id]);
    const repeatedOpened = await runJson(home, [
      "surface",
      "ensure",
      "--item",
      String(repeatedLinked.id),
    ]);
    expect(opened.surfaceId).toBe(repeatedOpened.surfaceId);
    const tab = await runJson(home, [
      "tab",
      "create",
      "--surface",
      String(opened.surfaceId),
      "--title",
      "New",
    ]);
    snapshot = await client.snapshot();
    expect(snapshot.panes.find((pane) => pane.id === tab.paneId)?.cwd).toBe(
      await realpath(external),
    );
    expect(await runCli(home, ["item", "archive", child.id])).toMatchObject({
      exitCode: 0,
      stdout: `ID: ${child.id}\n`,
    });
    expect((await runCli(home, ["snapshot"])).stdout).toContain(
      `"external tree" [${child.id}] [archived]`,
    );
    expect((await client.snapshot()).items.find((item) => item.id === child.id)?.archived).toBe(
      true,
    );
    expect(await runJson(home, ["item", "restore", child.id])).toEqual({
      id: child.id,
      itemId: child.id,
    });
    expect((await client.snapshot()).items.find((item) => item.id === child.id)?.archived).toBe(
      false,
    );
    expect((await runJson(home, ["surface", "ensure", "--item", child.id])).surfaceId).toBe(
      opened.surfaceId,
    );
    expect(await runCli(home, ["item", "archive", root.id])).toMatchObject({ exitCode: 0 });
    expect(
      (
        await runCli(home, [
          "directory",
          "register",
          "--workspace",
          String(workspace.id),
          "--path",
          target,
        ])
      ).stderr,
    ).toContain("Restore");
    for (const args of [
      [
        "project",
        "create",
        "--workspace",
        String(workspace.id),
        "--category",
        "implementation",
        "--name",
        "No",
      ],
      ["surface", "ensure", "--project", root.id],
      ["item", "create", "--project", root.id, "--kind", "surface", "--title", "No"],
    ]) {
      expect((await runCli(home, args)).exitCode).toBe(2);
    }
  } finally {
    await cleanup(home);
  }
}, 20000);

test("manages session profiles and shared workspace memberships", async () => {
  const home = await tempHome();
  try {
    const work = await runJson(home, ["session", "create", "--name", "Work"]);
    const consulting = await runJson(home, ["session", "create", "--name", "Consulting"]);
    const workspace = await runJson(home, [
      "workspace",
      "create",
      "--session",
      String(work.id),
      "--name",
      "Client A",
    ]);

    expect(
      await runCli(home, [
        "session",
        "add-workspace",
        String(consulting.id),
        "--workspace",
        String(workspace.id),
      ]),
    ).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Session: ${consulting.id}\nAdded workspace: ${workspace.id}\n`,
    });
    expect(
      await runJson(home, [
        "session",
        "add-workspace",
        String(consulting.id),
        "--workspace",
        String(workspace.id),
      ]),
    ).toEqual({ id: workspace.id, sessionId: consulting.id, workspaceId: workspace.id });
    expect(
      await runCli(home, [
        "session",
        "update",
        String(consulting.id),
        "--name",
        "Clients",
        "--position",
        "0",
      ]),
    ).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Updated session: ${consulting.id}\n`,
    });

    const snapshot = (await runJson(home, ["snapshot"])) as {
      sessions: Array<Record<string, unknown>>;
      workspaces: Array<Record<string, unknown>>;
      sessionWorkspaces: Array<Record<string, unknown>>;
    };
    expect(snapshot.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, name: "Client A" }),
    ]);
    expect(snapshot.sessionWorkspaces).toHaveLength(2);
    expect(snapshot.sessionWorkspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: work.id, workspaceId: workspace.id }),
        expect.objectContaining({ sessionId: consulting.id, workspaceId: workspace.id }),
      ]),
    );
    expect(snapshot.sessions[0]).toEqual(
      expect.objectContaining({ id: consulting.id, name: "Clients", position: 0 }),
    );

    expect(
      await runCli(home, [
        "session",
        "remove-workspace",
        String(work.id),
        "--workspace",
        String(workspace.id),
      ]),
    ).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Session: ${work.id}\nRemoved workspace: ${workspace.id}\n`,
    });
    expect(
      await runJson(home, [
        "session",
        "remove-workspace",
        String(work.id),
        "--workspace",
        String(workspace.id),
      ]),
    ).toEqual({ id: workspace.id, sessionId: work.id, workspaceId: workspace.id });
    expect(await runCli(home, ["session", "delete", String(work.id)])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Deleted session: ${work.id}\n`,
    });

    const finalSnapshot = (await runJson(home, ["snapshot"])) as {
      sessions: Array<Record<string, unknown>>;
      workspaces: Array<Record<string, unknown>>;
      sessionWorkspaces: Array<Record<string, unknown>>;
    };
    expect(finalSnapshot.sessions).toEqual([
      expect.objectContaining({ id: consulting.id, name: "Clients", position: 0 }),
    ]);
    expect(finalSnapshot.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, name: "Client A" }),
    ]);
    expect(finalSnapshot.sessionWorkspaces).toEqual([
      expect.objectContaining({ sessionId: consulting.id, workspaceId: workspace.id }),
    ]);
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
      "item",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "design",
      "--title",
      "Work Craft",
    ]);
    const item = await runJson(home, [
      "item",
      "create",
      "--workspace",
      String(workspace.id),
      "--category",
      "design",
      "--parent",
      String(project.id),
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
        `  Session: ${sessionId}\n` +
        `  Workspace: ${workspace.id}\n` +
        `  Category: inbox\n  Item: -\n  Tab: -\n  Pane: -\n` +
        `  Work\n` +
        `    Inbox\n` +
        `    Today\n` +
        `    Design\n` +
        `      "Work Craft" [${project.id}]\n` +
        `        "CLI Plain" [${item.id}]\n` +
        `    Implementation\n` +
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

test("session CLI navigation keeps shared resources but independent selections and returns their authoritative cursor", async () => {
  const home = await tempHome();
  try {
    const first = await runJson(home, ["session", "create", "--name", "First"]);
    const second = await runJson(home, ["session", "create", "--name", "Second"]);
    const client = createClient({ socketPath: join(home, "work-craft.sock") });
    const a = String(first.id);
    const b = String(second.id);
    const workspace = await client.command({
      type: "workspace.create",
      sessionId: a,
      name: "Shared",
    });
    const workspaceId = workspace.result.id;
    await client.command({ type: "session.workspace.add", sessionId: b, workspaceId });
    const root = await client.command({
      type: "item.create",
      workspaceId,
      category: "design",
      title: "Root",
    });
    const item = await client.command({
      type: "item.create",
      workspaceId,
      category: "design",
      parentId: root.result.id,
      title: "Line\n\x1b[31m",
    });
    const opened = await client.command({
      type: "surface.ensure",
      itemId: item.result.id,
      cwd: home,
    });
    const tab = await client.command({
      type: "tab.create",
      surfaceId: opened.result.surfaceId!,
      title: "Other",
    });
    const before = await client.snapshot();
    for (const [flag, target] of [
      ["workspace", workspaceId],
      ["category", "design"],
      ["item", item.result.id],
      ["tab", tab.result.tabId!],
      ["pane", tab.result.paneId!],
    ]) {
      const result = await runJson(home, ["session", "select", a, `--${flag}`, target!]);
      expect(result.navigation).toEqual(
        (await client.snapshot()).navigation.find(({ sessionId }) => sessionId === a),
      );
    }
    const other = await runJson(home, ["session", "open-item", b, "--item", item.result.id]);
    expect(other.navigation).toMatchObject({
      sessionId: b,
      tabId: opened.result.tabId,
      paneId: opened.result.paneId,
    });
    for (const direction of ["next", "previous"]) {
      const result = await runJson(home, [
        "session",
        "step",
        b,
        "--level",
        "tab",
        "--direction",
        direction,
      ]);
      expect(result.navigation).toMatchObject({
        tabId: direction === "next" ? tab.result.tabId : opened.result.tabId,
      });
    }
    const snapshot = await client.snapshot();
    expect(snapshot.navigation.find(({ sessionId }) => sessionId === a)?.tabId).toBe(
      tab.result.tabId!,
    );
    expect(snapshot.navigation.find(({ sessionId }) => sessionId === b)?.tabId).toBe(
      opened.result.tabId!,
    );
    expect(snapshot.panes.map(({ id, startedAt }) => ({ id, startedAt }))).toEqual(
      before.panes.map(({ id, startedAt }) => ({ id, startedAt })),
    );
    const text = await runCli(home, ["snapshot"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(`Tab: ${tab.result.tabId}`);
    expect(text.stdout).toContain(`Tab: ${opened.result.tabId}`);
    expect(text.stdout).toContain('"Line\\n\\u001b[31m"');
    expect(text.stdout).not.toContain("\x1b");
    const plain = await runCli(home, ["session", "select", a, "--category", "operations"]);
    expect(plain).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `Session: ${a}\nWorkspace: ${workspaceId}\nCategory: operations\nItem: -\nTab: -\nPane: -\n`,
    });

    const fresh = await client.command({
      type: "item.create",
      workspaceId,
      category: "design",
      title: "Fresh",
    });
    await mkdir(join(home, "client cwd"));
    const relative = await runCli(
      home,
      ["session", "open-item", a, "--item", fresh.result.id, "--cwd", "client cwd", "--json"],
      {},
      home,
    );
    expect(relative.exitCode).toBe(0);
    const selected = JSON.parse(relative.stdout) as { paneId: string };
    expect((await client.snapshot()).panes.find(({ id }) => id === selected.paneId)?.cwd).toBe(
      join(await realpath(home), "client cwd"),
    );

    const foreign = await client.command({ type: "workspace.create", sessionId: b, name: "Other" });
    const invalid = await runCli(home, ["session", "select", a, "--workspace", foreign.result.id]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).not.toContain("Usage:");
    expect(
      (await client.snapshot()).navigation.find(({ sessionId }) => sessionId === a)?.paneId,
    ).toBe(selected.paneId);
    const failed = await client.command({
      type: "item.create",
      workspaceId,
      category: "design",
      title: "Failed",
    });
    const failure = await client.command({
      type: "surface.ensure",
      itemId: failed.result.id,
      cwd: join(home, "missing"),
    });
    const selectFailed = await runCli(home, [
      "session",
      "select",
      a,
      "--pane",
      failure.result.paneId!,
      "--json",
    ]);
    expect(selectFailed.exitCode).toBe(0);
    expect(JSON.parse(selectFailed.stdout).navigation.paneId).toBe(failure.result.paneId!);
  } finally {
    await cleanup(home);
  }
}, 20000);

test("invalid session navigation exits with usage before starting a daemon", async () => {
  const home = await tempHome();
  try {
    for (const args of [
      ["session", "select", "s"],
      ["session", "select", "s", "--tab", "t", "--pane", "p"],
      ["session", "select", "s", "--tab", "t", "--tab", "t"],
      ["session", "select", "s", "--category", "wrong"],
      ["session", "step", "s", "--level", "pane", "--direction", "next"],
      ["session", "step", "s", "--level", "tab", "--direction", "up"],
      ["session", "open-item", "s", "extra", "--item", "i"],
      ["surface", "select-tab", "surface", "tab"],
    ]) {
      const result = await runCli(home, args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Usage:");
      if (args[0] === "surface") {
        expect(result.stderr).toContain("session select <session-id> --tab <id>");
      }
    }
    expect(await Bun.file(join(home, "daemon.lock")).exists()).toBe(false);
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
    navigation: [],
    geometry: { sequence: 0, tabs: [], panes: [] },
    epoch: "epoch",
    revision: 1,
    sessions: [],
    workspaces: [],
    sessionWorkspaces: [],
    categories: [],
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
        navigation: [],
        geometry: { sequence: 0, tabs: [], panes: [] },
        revision: calls,
        sessions: [],
        workspaces: [],
        sessionWorkspaces: [],
        categories: [],
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

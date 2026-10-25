import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, decodeBytes, type WorkCraftClient } from "@work-craft/server/client";

import { sendTerminalInput } from "../../../../scripts/test-support/terminal-input.ts";
import { startHttpServer } from "../../../server/src/api/http.ts";
import { createApp } from "../../../server/src/application/app.ts";
import { openDatabase } from "../../../server/src/persistence/database.ts";
import { USAGE } from "../args.ts";
import { readStatus } from "../format.ts";

const ROOT = join(import.meta.dir, "../../../..");
const CLI_PATH = join(import.meta.dir, "../main.ts");
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

test("checks committed pane failures without reading history and keeps explicit snapshots full", async () => {
  const home = await tempHome();
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  const server = startHttpServer(app, join(home, "work-craft.sock"));
  const reads = spyOn(app.history, "read").mockImplementation(() => {
    throw new Error("Terminal history must not be read for metadata checks");
  });
  try {
    const session = await app.execute({ type: "session.create", name: "Main" });
    const workspace = await app.execute({
      type: "workspace.create",
      sessionId: session.result.id,
      name: "Work",
    });
    const item = await app.execute({
      type: "item.create",
      workspaceId: workspace.result.id,
      category: "design",
      title: "Failed",
    });
    const cwd = join(home, "missing");
    expect(
      await runCli(home, ["surface", "ensure", "--item", item.result.id, "--cwd", cwd, "--json"]),
    ).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Working directory does not exist: ${cwd}\n`,
    });
    const [pane] = app.controlSnapshot().panes;
    expect(pane).toMatchObject({ processStatus: "failed", cwd });

    reads.mockRestore();
    const snapshot = await runJson(home, ["snapshot"]);
    expect(snapshot.terminalHistories).toEqual([expect.objectContaining({ paneId: pane!.id })]);
  } finally {
    reads.mockRestore();
    await server.stop(true);
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("retries history-free status reads until epoch and revision match", async () => {
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
    terminalStates: [],
  };
  const snapshots = [
    { ...emptySnapshot, epoch: "previous", revision: 2 },
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
      throw new Error("Status must not fetch terminal history");
    },
    async controlSnapshot() {
      return snapshots[snapshotCalls++]!;
    },
    async health() {
      healthCalls += 1;
      return { epoch: "epoch", revision: 2, pid: 42, protocol: "work-craft-projection-preview/1" };
    },
  } satisfies Pick<WorkCraftClient, "health" | "snapshot" | "controlSnapshot">;

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
  expect([snapshotCalls, healthCalls]).toEqual([3, 3]);
});

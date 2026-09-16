import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@work-craft/server/client";
import { USAGE } from "./args.ts";

const ROOT = join(import.meta.dir, "../../..");
const CLI_PATH = join(import.meta.dir, "main.ts");

type CliResult = { exitCode: number; stdout: string; stderr: string };

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (isAlive(pid) && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  if (isAlive(pid)) {
    throw new Error(`PID ${pid} did not exit`);
  }
}

async function cleanup(home: string): Promise<void> {
  const lockPath = join(home, "daemon.lock");
  let pid: number | undefined;
  try {
    pid = Number((await Bun.file(lockPath).text()).trim());
  } catch {}

  if (pid !== undefined && isAlive(pid)) {
    const client = createClient({ socketPath: join(home, "work-craft.sock") });
    await client.command({ type: "daemon.stop" }).catch(() => {});
    const deadline = Date.now() + 1_000;
    while (isAlive(pid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    if (isAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
    await waitForExit(pid);
  }
  await rm(home, { recursive: true, force: true });
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
    await waitForExit(statusJson.pid);

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

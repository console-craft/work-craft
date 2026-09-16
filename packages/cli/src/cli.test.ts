import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type WorkCraftClient } from "@work-craft/server/client";
import { USAGE } from "./args.ts";
import { readStatus } from "./format.ts";

const ROOT = join(import.meta.dir, "../../..");
const CLI_PATH = join(import.meta.dir, "main.ts");

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
  const deadline = Date.now() + timeout;
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

async function cleanup(home: string): Promise<void> {
  const client = createClient({ socketPath: join(home, "work-craft.sock") });
  let stopAccepted = false;
  try {
    await client.command({ type: "daemon.stop" });
    stopAccepted = true;
  } catch {}

  if (!stopAccepted || !(await waitForOwnedFiles(home, 1_000))) {
    const health = await client.health().catch(() => undefined);
    const pid = await readLockPid(home);
    const confirmed = await client.health().catch(() => undefined);
    if (
      pid !== undefined &&
      health?.pid === pid &&
      confirmed?.pid === pid &&
      health.epoch === confirmed.epoch
    ) {
      process.kill(pid, "SIGKILL");
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        if ((await client.health().catch(() => undefined)) === undefined) {
          break;
        }
        await Bun.sleep(20);
      }
      if ((await client.health().catch(() => undefined)) !== undefined) {
        throw new Error(`PID ${pid} did not stop`);
      }
    }
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
  try {
    for (const contents of ["", "not-a-pid\n", `${process.pid}\n`]) {
      const home = await tempHome();
      await writeFile(join(home, "daemon.lock"), contents);
      await cleanup(home);
    }
    expect(kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
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

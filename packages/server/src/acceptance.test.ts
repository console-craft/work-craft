import { expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type StreamConnection } from "./client.ts";
import { resolvePaths } from "./daemon/paths.ts";
import { decodeBytes, type Snapshot } from "./api/protocol.ts";

const ROOT = join(import.meta.dir, "../../..");
const MAIN_PATH = join(import.meta.dir, "main.ts");
const CLI_PATH = join(ROOT, "packages/cli/src/main.ts");
const WAIT_MS = 3_000;

function spawnDaemon(home: string, shellPath: string, shellPidsPath: string) {
  return Bun.spawn([process.execPath, MAIN_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      SHELL: shellPath,
      WORK_CRAFT_HOME: home,
      WORK_CRAFT_TEST_SHELL_PIDS: shellPidsPath,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

type Daemon = ReturnType<typeof spawnDaemon>;

async function within<T>(promise: Promise<T>, description: string, ms = WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  ready: (value: T) => boolean,
  description: string,
): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let value = await read();
  while (!ready(value) && Date.now() < deadline) {
    await Bun.sleep(20);
    value = await read();
  }
  if (!ready(value)) {
    throw new Error(`Timed out waiting for ${description}`);
  }
  return value;
}

async function waitForHealth(home: string, daemon: Daemon): Promise<void> {
  const client = createClient({ socketPath: resolvePaths({ WORK_CRAFT_HOME: home }).socketPath });
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const health = await client.health();
      if (health.pid === daemon.pid) {
        return;
      }
    } catch {}
    if (daemon.exitCode !== null) {
      throw new Error(
        `Daemon ${daemon.pid} exited ${daemon.exitCode}: ${await new Response(daemon.stderr).text()}`,
      );
    }
    await Bun.sleep(20);
  }
  throw new Error(`Daemon ${daemon.pid} did not become healthy`);
}

function history(snapshot: Snapshot, paneId: string): string {
  const entry = snapshot.terminalHistories.find((candidate) => candidate.paneId === paneId);
  return entry === undefined ? "" : new TextDecoder().decode(decodeBytes(entry.data));
}

async function readShellPids(path: string): Promise<number[]> {
  try {
    const contents = (await readFile(path, "utf8")).trim();
    if (contents === "") {
      return [];
    }
    return [...new Set(contents.split("\n").map(Number))].filter(
      (pid) => Number.isSafeInteger(pid) && pid > 0,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
  await waitFor(
    () => pids.filter(isAlive),
    (alive) => alive.length === 0,
    `shell PIDs to exit: ${pids.join(", ")}`,
  );
}

test.serial("cleanup tolerates a process exiting before SIGKILL", async () => {
  let firstProbe = true;
  const kill = spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0 && firstProbe) {
      firstProbe = false;
      return true;
    }
    throw Object.assign(new Error("process exited"), { code: "ESRCH" });
  });
  try {
    await expect(stopPids([12345])).resolves.toBeUndefined();
  } finally {
    kill.mockRestore();
  }
});

async function stopDaemon(daemon: Daemon): Promise<void> {
  if (daemon.exitCode !== null) {
    return;
  }
  daemon.kill("SIGTERM");
  try {
    await within(daemon.exited, `daemon ${daemon.pid} to stop`, 1_000);
  } catch {
    daemon.kill("SIGKILL");
    await daemon.exited;
  }
}

type CliResult = { exitCode: number; stdout: string; stderr: string };

async function runCli(home: string, args: string[]): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: ROOT,
    env: { ...process.env, WORK_CRAFT_HOME: home, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  try {
    const [exitCode, stdout, stderr] = await within(result, `CLI ${args[0]}`, WAIT_MS);
    return { exitCode, stdout, stderr };
  } catch (error) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await child.exited;
    await result;
    throw error;
  }
}

test.serial(
  "proves the first vertical slice end to end",
  async () => {
    const daemons: Daemon[] = [];
    const streams: StreamConnection[] = [];
    let failure: unknown;
    const home = await mkdtemp(join(tmpdir(), "work-craft-acceptance-"));
    try {
      const paths = resolvePaths({ WORK_CRAFT_HOME: home });
      const shellPath = join(home, "acceptance-shell");
      const shellPidsPath = join(home, "shell.pids");
      await writeFile(
        shellPath,
        '#!/bin/sh\nprintf "%s\\n" "$$" >> "$WORK_CRAFT_TEST_SHELL_PIDS"\nexec /bin/sh\n',
      );
      await chmod(shellPath, 0o755);

      const firstDaemon = spawnDaemon(home, shellPath, shellPidsPath);
      daemons.push(firstDaemon);
      await waitForHealth(home, firstDaemon);

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
        name: "Work Craft",
      });
      const item = await client.command({
        type: "item.create",
        projectId: project.result.id,
        kind: "surface",
        title: "Acceptance",
      });
      const opened = await client.command({
        type: "surface.ensure",
        itemId: item.result.id,
        cwd: home,
      });
      const paneId = opened.result.paneId!;
      const split = await client.command({
        type: "pane.split",
        paneId,
        direction: "horizontal",
      });
      const expectedLayout = {
        type: "split" as const,
        direction: "horizontal" as const,
        ratio: 0.5,
        first: { type: "pane" as const, paneId },
        second: { type: "pane" as const, paneId: split.result.paneId! },
      };
      const firstShellPids = await waitFor(
        () => readShellPids(shellPidsPath),
        (pids) => pids.length === 2,
        "both initial shells",
      );

      let closed!: () => void;
      const disconnected = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const stream = await client.stream({ onMessage() {}, onClose: closed });
      streams.push(stream);
      stream.sendInput(paneId, new TextEncoder().encode("printf 'acceptance-%s' marker\n"));
      await waitFor(
        () => client.snapshot(),
        (snapshot) => history(snapshot, paneId).includes("acceptance-marker"),
        "acceptance marker",
      );
      await Bun.sleep(150);
      stream.close();
      await within(disconnected, "client disconnect");

      const reconnected = await client.streamOnce();
      expect(reconnected.type).toBe("snapshot");
      if (reconnected.type !== "snapshot") {
        throw new Error("Reconnect did not receive a snapshot");
      }
      expect(history(reconnected.snapshot, paneId)).toContain("acceptance-marker");
      expect(
        reconnected.snapshot.tabs.find(({ id }) => id === opened.result.tabId)?.layout,
      ).toEqual(expectedLayout);

      firstDaemon.kill("SIGKILL");
      await firstDaemon.exited;
      await stopPids(firstShellPids);

      const secondDaemon = spawnDaemon(home, shellPath, shellPidsPath);
      daemons.push(secondDaemon);
      await waitForHealth(home, secondDaemon);
      const restored = await waitFor(
        () => client.snapshot(),
        (snapshot) =>
          snapshot.panes.filter(({ id }) => [paneId, split.result.paneId].includes(id)).length ===
            2 &&
          snapshot.panes
            .filter(({ id }) => [paneId, split.result.paneId].includes(id))
            .every(({ processStatus }) => processStatus === "running") &&
          history(snapshot, paneId).includes("daemon restarted; shell restored"),
        "cold recovery",
      );

      expect(restored.panes.find(({ id }) => id === paneId)).toMatchObject({
        id: paneId,
        processStatus: "running",
      });
      expect(restored.tabs.find(({ id }) => id === opened.result.tabId)?.layout).toEqual(
        expectedLayout,
      );
      expect(history(restored, paneId)).toContain("acceptance-marker");
      expect(history(restored, paneId)).toContain(
        "\r\n[work-craft: daemon restarted; shell restored]\r\n",
      );
      await waitFor(
        () => readShellPids(shellPidsPath),
        (pids) => pids.length === 4,
        "one restored shell per pane",
      );

      expect(await runCli(home, ["list"])).toEqual({
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
          `        Acceptance [${item.result.id}]\n` +
          `    Collaboration\n` +
          `    Operations\n`,
      });
      const status = await runCli(home, ["status", "--json"]);
      expect(status.exitCode).toBe(0);
      expect(status.stderr).toBe("");
      expect(JSON.parse(status.stdout)).toMatchObject({
        running: true,
        pid: secondDaemon.pid,
        counts: {
          sessions: 1,
          workspaces: 1,
          categories: 6,
          projects: 1,
          items: 1,
          surfaces: 1,
          tabs: 1,
          panes: 2,
        },
      });
      expect(await runCli(home, ["stop"])).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: "Stopped Work Craft\n",
      });
      expect(await within(secondDaemon.exited, "CLI-stopped daemon")).toBe(0);
      await waitFor(
        async () => [
          await Bun.file(paths.socketPath).exists(),
          await Bun.file(paths.lockPath).exists(),
        ],
        (ownedFiles) => ownedFiles.every((exists) => !exists),
        "socket and lock cleanup",
      );
      await waitFor(
        async () => (await readShellPids(shellPidsPath)).filter(isAlive),
        (alive) => alive.length === 0,
        "CLI-stopped shells",
      );
    } catch (error) {
      failure = error;
    } finally {
      for (const stream of streams) {
        stream.close();
      }
      const cleanupErrors: unknown[] = [];
      const stopped = await Promise.allSettled(daemons.map(stopDaemon));
      for (const result of stopped) {
        if (result.status === "rejected") {
          cleanupErrors.push(result.reason);
        }
      }
      try {
        await stopPids(await readShellPids(join(home, "shell.pids")));
      } catch (error) {
        cleanupErrors.push(error);
      }
      await rm(home, { recursive: true, force: true });
      if (cleanupErrors.length > 0) {
        failure = new AggregateError(
          failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
          "Acceptance cleanup failed",
        );
      }
    }
    if (failure !== undefined) {
      throw failure;
    }
  },
  20_000,
);

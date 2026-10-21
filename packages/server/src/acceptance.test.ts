import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sendTerminalInput } from "../../../scripts/test-support/terminal-input.ts";
import { decodeBytes, type Snapshot } from "./api/protocol.ts";
import { createClient, type StreamConnection } from "./client.ts";
import { resolvePaths } from "./daemon/paths.ts";

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
  "linked-first registration returns the requested checkout and stays metadata-only through the daemon",
  async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-group-acceptance-")));
    const primary = join(home, "primary");
    const linked = join(home, "linked");
    const shellPath = join(home, "shell");
    const shellPidsPath = join(home, "shell.pids");
    let daemon: Daemon | undefined;
    try {
      await mkdir(primary);
      for (const args of [
        ["init", "--initial-branch=trunk"],
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=t@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ],
        ["worktree", "add", "-b", "feature", linked],
      ]) {
        const result = Bun.spawnSync(["git", "-C", primary, ...args]);
        expect(result.exitCode).toBe(0);
      }
      await writeFile(
        shellPath,
        '#!/bin/sh\nprintf "%s\\n" "$$" >> "$WORK_CRAFT_TEST_SHELL_PIDS"\nexec /bin/sh\n',
        { mode: 0o755 },
      );
      daemon = spawnDaemon(home, shellPath, shellPidsPath);
      await waitForHealth(home, daemon);
      const client = createClient({
        socketPath: resolvePaths({ WORK_CRAFT_HOME: home }).socketPath,
      });
      const sessionId = (await client.command({ type: "session.create", name: "Main" })).result.id;
      const workspaceId = (
        await client.command({ type: "workspace.create", sessionId, name: "Work" })
      ).result.id;
      const first = await client.command({ type: "directory.register", workspaceId, path: linked });
      const root = await client.command({ type: "directory.register", workspaceId, path: primary });
      const repeated = await client.command({
        type: "directory.register",
        workspaceId,
        path: linked,
      });
      expect(first.result.id).toBe(first.result.itemId!);
      expect(first.result.id).not.toBe(first.result.rootItemId);
      expect(root.result).toEqual({
        id: first.result.rootItemId!,
        itemId: first.result.rootItemId!,
        rootItemId: first.result.rootItemId!,
      });
      expect(repeated.result).toEqual(first.result);
      expect(repeated.revision).toBe(first.revision);
      const snapshot = await client.snapshot();
      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.items.find((item) => item.id === first.result.id)).toMatchObject({
        parentId: root.result.id,
        kind: "worktree",
        data: { path: linked },
      });
      expect(snapshot.items.find((item) => item.id === root.result.id)).toMatchObject({
        parentId: null,
        kind: "directory",
        data: { path: primary, branch: "trunk" },
      });
      expect(snapshot.surfaces).toEqual([]);
      expect(snapshot.panes).toEqual([]);
      expect(await readShellPids(shellPidsPath)).toEqual([]);
      expect(
        await runCli(home, ["directory", "register", "--workspace", workspaceId, "--path", linked]),
      ).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: `ID: ${first.result.id}\nRoot: ${root.result.id}\n`,
      });
      const json = await runCli(home, [
        "directory",
        "register",
        "--workspace",
        workspaceId,
        "--path",
        linked,
        "--json",
      ]);
      expect(json.exitCode).toBe(0);
      expect(json.stderr).toBe("");
      expect(JSON.parse(json.stdout)).toEqual(first.result);
      const afterCli = await client.snapshot();
      expect(afterCli.revision).toBe(snapshot.revision);
      expect(afterCli.items).toEqual(snapshot.items);
      expect(afterCli.surfaces).toEqual([]);
      expect(afterCli.panes).toEqual([]);
      expect(await readShellPids(shellPidsPath)).toEqual([]);
    } finally {
      if (daemon !== undefined) {
        await stopDaemon(daemon);
      }
      await stopPids(await readShellPids(shellPidsPath));
      await rm(home, { recursive: true, force: true });
    }
  },
  15_000,
);

test.serial(
  "live shell cd feeds both split directions and equalizes only its tab without restarting shells",
  async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-split-acceptance-")));
    const target = join(home, "live cwd 雪");
    const shellPath = join(home, "shell");
    const shellPidsPath = join(home, "shell.pids");
    let daemon: Daemon | undefined;
    let stream: StreamConnection | undefined;
    try {
      await mkdir(target);
      await writeFile(
        shellPath,
        '#!/bin/sh\nprintf "%s\\n" "$$" >> "$WORK_CRAFT_TEST_SHELL_PIDS"\nexec /bin/sh\n',
        { mode: 0o755 },
      );
      daemon = spawnDaemon(home, shellPath, shellPidsPath);
      await waitForHealth(home, daemon);
      const client = createClient({
        socketPath: resolvePaths({ WORK_CRAFT_HOME: home }).socketPath,
      });
      const sessionId = (await client.command({ type: "session.create", name: "Main" })).result.id;
      const workspaceId = (
        await client.command({ type: "workspace.create", sessionId, name: "Work" })
      ).result.id;
      const itemId = (
        await client.command({
          type: "item.create",
          workspaceId,
          category: "design",
          title: "Splits",
        })
      ).result.id;
      const opened = (await client.command({ type: "surface.ensure", itemId, cwd: home })).result;
      const other = (
        await client.command({
          type: "tab.create",
          surfaceId: opened.surfaceId!,
          title: "Untouched",
        })
      ).result;
      const before = await client.snapshot();
      const originalPids = await waitFor(
        () => readShellPids(shellPidsPath),
        (pids) => pids.length === 2,
        "original shells",
      );
      stream = await client.stream({ onMessage() {} });
      await sendTerminalInput(
        client,
        stream,
        opened.paneId!,
        new TextEncoder().encode(`cd '${target}'; printf 'cwd-ready-PID-%s\\n' "$$"\n`),
      );
      const source = await waitFor(
        () => client.snapshot(),
        (snapshot) => /cwd-ready-PID-\d+/.test(history(snapshot, opened.paneId!)),
        "source shell cd",
      );
      const sourcePid = history(source, opened.paneId!).match(/cwd-ready-PID-(\d+)/)![1]!;
      expect(originalPids).toContain(Number(sourcePid));

      const vertical = (
        await client.command({ type: "pane.split", paneId: opened.paneId!, direction: "vertical" })
      ).result;
      const third = (
        await client.command({
          type: "pane.split",
          paneId: vertical.paneId!,
          direction: "vertical",
        })
      ).result;
      const horizontal = (
        await client.command({
          type: "pane.split",
          paneId: opened.paneId!,
          direction: "horizontal",
        })
      ).result;
      for (const [index, paneId] of [
        vertical.paneId!,
        third.paneId!,
        horizontal.paneId!,
      ].entries()) {
        await sendTerminalInput(
          client,
          stream,
          paneId,
          new TextEncoder().encode(`printf '\\nnew-${index}-%s\\n' "$(pwd)"\n`),
        );
        await waitFor(
          () => client.snapshot(),
          (snapshot) => history(snapshot, paneId).includes(`new-${index}-${target}`),
          `new shell ${index} actual pwd`,
        );
      }
      const after = await client.snapshot();
      expect(after.panes.find(({ id }) => id === opened.paneId)?.cwd).toBe(home);
      expect(
        after.panes
          .filter(({ id }) => [vertical.paneId, third.paneId, horizontal.paneId].includes(id))
          .every(({ cwd }) => cwd === target),
      ).toBe(true);
      expect(after.tabs.find(({ id }) => id === other.tabId)).toEqual(
        before.tabs.find(({ id }) => id === other.tabId),
      );
      expect(after.surfaces).toEqual(before.surfaces);
      expect(after.tabs.find(({ id }) => id === opened.tabId)?.layout).toEqual({
        type: "split",
        direction: "vertical",
        ratio: 1 / 3,
        first: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "pane", paneId: opened.paneId! },
          second: { type: "pane", paneId: horizontal.paneId! },
        },
        second: {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "pane", paneId: vertical.paneId! },
          second: { type: "pane", paneId: third.paneId! },
        },
      });
      expect(await readShellPids(shellPidsPath)).toHaveLength(5);
      expect(originalPids.every(isAlive)).toBe(true);
      expect((await client.health()).pid).toBe(daemon.pid);
      await sendTerminalInput(
        client,
        stream,
        opened.paneId!,
        new TextEncoder().encode("printf 'retained-PID-%s\\n' \"$$\"\n"),
      );
      const retained = await waitFor(
        () => client.snapshot(),
        (snapshot) => history(snapshot, opened.paneId!).includes(`retained-PID-${sourcePid}`),
        "same source shell after repeated and mixed splits",
      );
      expect(history(retained, opened.paneId!)).toContain(`cwd-ready-PID-${sourcePid}`);

      await sendTerminalInput(client, stream, opened.paneId!, new TextEncoder().encode("exit\n"));
      const stopped = await waitFor(
        () => client.snapshot(),
        (snapshot) =>
          snapshot.panes.find(({ id }) => id === opened.paneId)?.processStatus === "exited",
        "source exit",
      );
      await expect(
        client.command({ type: "pane.split", paneId: opened.paneId!, direction: "vertical" }),
      ).rejects.toThrow(/live runtime/);
      await expect(
        client.command({
          type: "pane.split",
          paneId: vertical.paneId!,
          direction: "vertical",
          cwd: join(home, "missing"),
        }),
      ).rejects.toThrow(/unavailable/);
      const rejected = await client.snapshot();
      expect(rejected.panes).toEqual(stopped.panes);
      expect(rejected.tabs).toEqual(stopped.tabs);
      expect(rejected.revision).toBe(stopped.revision);
      const override = await client.command({
        type: "pane.split",
        paneId: opened.paneId!,
        direction: "horizontal",
        cwd: home,
      });
      await sendTerminalInput(
        client,
        stream,
        override.result.paneId!,
        new TextEncoder().encode("printf '\\noverride-%s\\n' \"$(pwd)\"\n"),
      );
      await waitFor(
        () => client.snapshot(),
        (snapshot) => history(snapshot, override.result.paneId!).includes(`override-${home}`),
        "explicit override actual pwd",
      );
    } finally {
      stream?.close();
      if (daemon !== undefined) {
        await stopDaemon(daemon);
      }
      await stopPids(await readShellPids(shellPidsPath));
      await rm(home, { recursive: true, force: true });
    }
  },
  20_000,
);

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
      const secondSession = await client.command({ type: "session.create", name: "Focused" });
      await client.command({
        type: "session.workspace.add",
        sessionId: secondSession.result.id,
        workspaceId: workspace.result.id,
      });
      const project = await client.command({
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        title: "Work Craft",
      });
      const item = await client.command({
        type: "item.create",
        workspaceId: workspace.result.id,
        category: "design",
        parentId: project.result.id,
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
      await sendTerminalInput(
        client,
        stream,
        paneId,
        new TextEncoder().encode("printf 'acceptance-%s' marker\n"),
      );
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
      expect(reconnected.snapshot.workspaces).toEqual([{ id: workspace.result.id, name: "Work" }]);
      expect(reconnected.snapshot.sessionWorkspaces).toEqual(
        expect.arrayContaining([
          { sessionId: session.result.id, workspaceId: workspace.result.id, position: 0 },
          { sessionId: secondSession.result.id, workspaceId: workspace.result.id, position: 0 },
        ]),
      );
      expect(reconnected.snapshot.sessionWorkspaces).toHaveLength(2);
      expect(reconnected.snapshot.panes).toHaveLength(2);
      expect(
        reconnected.snapshot.panes.every(({ processStatus }) => processStatus === "running"),
      ).toBe(true);

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
      expect(restored.workspaces).toEqual([{ id: workspace.result.id, name: "Work" }]);
      expect(restored.sessionWorkspaces).toEqual(
        expect.arrayContaining([
          { sessionId: session.result.id, workspaceId: workspace.result.id, position: 0 },
          { sessionId: secondSession.result.id, workspaceId: workspace.result.id, position: 0 },
        ]),
      );
      expect(restored.sessionWorkspaces).toHaveLength(2);
      expect(restored.panes).toHaveLength(2);
      const shellPidsAfterRestore = await waitFor(
        () => readShellPids(shellPidsPath),
        (pids) => pids.length === 4,
        "one restored shell per pane",
      );
      const restoredShellPids = shellPidsAfterRestore.filter(
        (pid) => !firstShellPids.includes(pid),
      );
      expect(restoredShellPids).toHaveLength(2);

      await client.command({ type: "session.delete", sessionId: session.result.id });
      const afterDelete = await client.snapshot();
      expect(afterDelete.sessions).toEqual([
        { id: secondSession.result.id, name: "Focused", position: 0 },
      ]);
      expect(afterDelete.sessionWorkspaces).toEqual([
        { sessionId: secondSession.result.id, workspaceId: workspace.result.id, position: 0 },
      ]);
      expect(afterDelete.panes).toHaveLength(2);
      expect(afterDelete.panes.every(({ processStatus }) => processStatus === "running")).toBe(
        true,
      );
      expect(history(afterDelete, paneId)).toContain("acceptance-marker");
      expect(restoredShellPids.every(isAlive)).toBe(true);

      expect(await runCli(home, ["snapshot"])).toEqual({
        exitCode: 0,
        stderr: "",
        stdout:
          `Focused\n` +
          `  Work\n` +
          `    Inbox\n` +
          `    Today\n` +
          `    Design\n` +
          `      "Work Craft" [${project.result.id}]\n` +
          `        "Acceptance" [${item.result.id}]\n` +
          `    Implementation\n` +
          `    Collaboration\n` +
          `    Operations\n`,
      });
      const status = await runCli(home, ["daemon", "status", "--json"]);
      expect(status.exitCode).toBe(0);
      expect(status.stderr).toBe("");
      expect(JSON.parse(status.stdout)).toMatchObject({
        running: true,
        pid: secondDaemon.pid,
        counts: {
          sessions: 1,
          workspaces: 1,
          categories: 6,
          items: 2,
          surfaces: 1,
          tabs: 1,
          panes: 2,
        },
      });
      expect(await runCli(home, ["daemon", "stop"])).toEqual({
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

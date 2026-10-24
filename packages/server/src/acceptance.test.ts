import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sendTerminalInput } from "../../../scripts/test-support/terminal-input.ts";
import { decodeBytes, type Snapshot } from "./api/protocol.ts";
import { createClient, type StreamConnection } from "./client.ts";
import { resolvePaths } from "./daemon/paths.ts";

const ROOT = join(import.meta.dir, "../../..");
const MAIN_PATH = join(import.meta.dir, "main.ts");
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

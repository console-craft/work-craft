import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../persistence/database.ts";
import { TerminalHistory } from "./history.ts";
import type { PaneStatus } from "../api/protocol.ts";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";
import { RuntimeRegistry, type RuntimeCallbacks } from "./runtime.ts";

const runtimes: RuntimeRegistry[] = [];

function shellPane(
  id: string,
  cwd: string,
  executable = "/bin/sh",
  args: string[] = [],
): RuntimePane {
  return { id, cwd, restorePolicy: { type: "shell", executable, args } };
}

function runtime(callbacks: Partial<RuntimeCallbacks> = {}): RuntimeRegistry {
  const registry = new RuntimeRegistry({
    onOutput: callbacks.onOutput ?? (() => {}),
    onStatus: callbacks.onStatus ?? (() => {}),
  });
  runtimes.push(registry);
  return registry;
}

async function readPid(path: string): Promise<number> {
  const pid = Number(await Bun.file(path).text());
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`Invalid child PID: ${pid}`);
  }
  return pid;
}

function processIsRunning(pid: number): boolean {
  const result = Bun.spawnSync(["ps", "-o", "state=", "-p", String(pid)], { stderr: "ignore" });
  const state = result.stdout.toString().trim();
  return result.success && state !== "" && !state.startsWith("Z");
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((registry) => registry.stopAll()));
});

test("resolves a persisted shell policy and preserves empty arguments", () => {
  expect(resolveShellSpawn(shellPane("pane-1", "/tmp", "/bin/sh", ["-c", ""]))).toEqual({
    cmd: ["/bin/sh", "-c", ""],
    cwd: "/tmp",
    env: expect.objectContaining({ TERM: "xterm-256color" }),
  });
});

test("rejects a missing working directory", () => {
  const cwd = join(tmpdir(), `work-craft-missing-${crypto.randomUUID()}`);
  expect(() => resolveShellSpawn(shellPane("pane-1", cwd))).toThrow(cwd);
});

test("rejects a working directory path that is not a directory", () => {
  expect(() => resolveShellSpawn(shellPane("pane-1", import.meta.path))).toThrow(import.meta.path);
});

test("rejects a missing shell executable", () => {
  const executable = join(tmpdir(), `work-craft-missing-${crypto.randomUUID()}`);
  expect(() => resolveShellSpawn(shellPane("pane-1", "/tmp", executable))).toThrow(executable);
});

test("runs a shell through Bun.Terminal and emits its lifecycle", async () => {
  const output: Uint8Array[] = [];
  const statuses: PaneStatus[] = [];
  const registry = runtime({
    onOutput: (_paneId, data) => output.push(data),
    onStatus: (_paneId, status) => statuses.push(status),
  });

  await registry.start(shellPane("pane-1", process.cwd()));
  registry.resize("pane-1", 100, 30);
  registry.write("pane-1", new TextEncoder().encode("printf work-craft-pty; exit\n"));

  expect(await registry.waitForExit("pane-1")).toBe(0);
  expect(new TextDecoder().decode(Buffer.concat(output))).toContain("work-craft-pty");
  expect(statuses).toEqual(["starting", "running", "exited"]);
  expect(registry.isLive("pane-1")).toBe(false);
});

test("refuses a duplicate live runtime for one pane ID", async () => {
  const registry = runtime();
  const pane = shellPane("pane-1", process.cwd());
  await registry.start(pane);

  await expect(registry.start(pane)).rejects.toThrow("pane-1");
  expect(registry.isLive("pane-1")).toBe(true);
});

test("waits for a fast shell after it has already exited", async () => {
  let markExited: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    markExited = resolve;
  });
  const registry = runtime({
    onStatus: (_paneId, status) => {
      if (status === "exited") {
        markExited();
      }
    },
  });
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "exit 7"]));
  await exited;

  expect(registry.isLive("pane-1")).toBe(false);
  expect(await registry.waitForExit("pane-1")).toBe(7);
});

test("an exiting runtime cannot overwrite its replacement status", async () => {
  const statuses: PaneStatus[] = [];
  const registry = runtime({
    onStatus: (_paneId, status) => statuses.push(status),
  });
  const paneId = "pane-1";
  await registry.start(shellPane(paneId, process.cwd(), "/bin/sh", ["-c", "sleep 0.1 &"]));
  const firstRuntime = (
    registry as unknown as {
      runtimes: Map<string, { process: Bun.Subprocess; exited: Promise<number> }>;
    }
  ).runtimes.get(paneId)!;
  await firstRuntime.process.exited;

  await registry.start(shellPane(paneId, process.cwd()));
  await firstRuntime.exited;

  expect(statuses.at(-1)).toBe("running");
  expect(registry.isLive(paneId)).toBe(true);
});

test("cleans up and reports a synchronous spawn failure", async () => {
  const statuses: { status: PaneStatus; error?: string }[] = [];
  const registry = runtime({
    onStatus: (_paneId, status, error) => statuses.push({ status, error }),
  });

  await expect(
    registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["\0"])),
  ).rejects.toThrow();
  expect(registry.isLive("pane-1")).toBe(false);
  expect(statuses.map(({ status }) => status)).toEqual(["starting", "failed"]);
  expect(statuses[1]?.error).toBeTruthy();
});

test("terminates a spawned shell when the running callback throws", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-runtime-failure-"));
  const pidPath = join(directory, "pid");
  const stoppedPath = join(directory, "stopped");
  let pid: number | undefined;
  const statuses: PaneStatus[] = [];
  const registry = runtime({
    onStatus: (_paneId, status) => {
      statuses.push(status);
      if (status !== "running") {
        return;
      }
      const deadline = Date.now() + 1_000;
      while (!existsSync(pidPath) && Date.now() < deadline) {}
      if (!existsSync(pidPath)) {
        throw new Error("shell did not start");
      }
      throw new Error("running status failed");
    },
  });

  try {
    await expect(
      registry.start(
        shellPane("pane-1", process.cwd(), "/bin/sh", [
          "-c",
          'trap "" HUP; trap \'printf stopped > "$2"; exit 0\' TERM; printf "$$" > "$1"; while :; do sleep 0.1; done',
          "runtime-test",
          pidPath,
          stoppedPath,
        ]),
      ),
    ).rejects.toThrow("running status failed");
    pid = await readPid(pidPath);

    expect(() => process.kill(pid!, 0)).toThrow();
    expect(await Bun.file(stoppedPath).text()).toBe("stopped");
    expect(registry.isLive("pane-1")).toBe(false);
    expect(statuses).toEqual(["starting", "running", "failed"]);
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("stops all live runtimes", async () => {
  const registry = runtime();
  await registry.start(shellPane("pane-1", process.cwd()));
  await registry.start(shellPane("pane-2", process.cwd()));

  await registry.stopAll();

  expect(registry.isLive("pane-1")).toBe(false);
  expect(registry.isLive("pane-2")).toBe(false);
});

test("stops background descendants that outlive their shell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-runtime-tree-"));
  const pidPath = join(directory, "child.pid");
  const registry = runtime();
  let childPid: number | undefined;
  try {
    await registry.start(
      shellPane("pane-1", directory, "/bin/sh", [
        "-c",
        'trap "" TERM HUP; sleep 30 </dev/null >/dev/null 2>&1 & printf "$!" > "$1"; wait',
        "runtime-tree-test",
        pidPath,
      ]),
    );
    for (let attempt = 0; attempt < 100 && !existsSync(pidPath); attempt += 1) {
      await Bun.sleep(10);
    }
    childPid = await readPid(pidPath);

    await registry.stopAll({ preserveStatus: true });

    expect(processIsRunning(childPid)).toBe(false);
  } finally {
    if (childPid !== undefined) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("gives descendants the full grace period after their shell exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-runtime-grace-"));
  const pidPath = join(directory, "child.pid");
  const gracefulPath = join(directory, "graceful");
  const registry = runtime();
  let childPid: number | undefined;
  try {
    await registry.start(
      shellPane("pane-1", directory, "/bin/sh", [
        "-c",
        `trap 'exit 0' TERM; /bin/sh -c 'trap "" HUP; trap "sleep 0.1; printf graceful > $2; exit 0" TERM; printf "$$" > "$1"; while :; do sleep 1; done' runtime-child "$1" "$2" </dev/null >/dev/null 2>&1 & wait`,
        "runtime-grace-test",
        pidPath,
        gracefulPath,
      ]),
    );
    for (let attempt = 0; attempt < 100 && !existsSync(pidPath); attempt += 1) {
      await Bun.sleep(10);
    }
    childPid = await readPid(pidPath);

    await registry.stopAll({ preserveStatus: true });

    expect(await Bun.file(gracefulPath).text()).toBe("graceful");
  } finally {
    if (childPid !== undefined) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("escalates to SIGKILL when a shell ignores SIGTERM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-runtime-stop-"));
  const pidPath = join(directory, "pid");
  const statuses: PaneStatus[] = [];
  const registry = runtime({
    onStatus: (_paneId, status) => statuses.push(status),
  });
  let pid: number | undefined;
  let stopping: Promise<void> | undefined;
  try {
    await registry.start(
      shellPane("pane-1", directory, "/bin/sh", [
        "-c",
        'trap "" TERM; printf "$$" > "$1"; while :; do sleep 0.1; done',
        "runtime-stop-test",
        pidPath,
      ]),
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (existsSync(pidPath)) {
        break;
      }
      await Bun.sleep(10);
    }
    pid = await readPid(pidPath);

    stopping = registry.stopAll({ preserveStatus: true });
    const stopped = await Promise.race([
      stopping.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (!stopped && isFinite(pid)) {
      process.kill(pid, "SIGKILL");
      await stopping;
    }

    expect(stopped).toBe(true);
    expect(() => process.kill(pid!, 0)).toThrow();
    expect(statuses).toEqual(["starting", "running"]);
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await stopping?.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserving shutdown still publishes a natural exit", async () => {
  const statuses: PaneStatus[] = [];
  let publishExit = true;
  let killed = false;
  const registry = runtime();
  const runtimes = (
    registry as unknown as {
      runtimes: Map<string, unknown>;
    }
  ).runtimes;
  runtimes.set("pane-1", {
    process: {
      exitCode: 0,
      kill() {
        killed = true;
      },
    },
    exited: Promise.resolve(0).then((code) => {
      if (publishExit) {
        statuses.push("exited");
      }
      return code;
    }),
    preserveStatus() {
      publishExit = false;
    },
  });

  await registry.stopAll({ preserveStatus: true });

  expect(killed).toBe(false);
  expect(statuses).toEqual(["exited"]);
});

test("persists shell output after the process exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-runtime-"));
  const path = join(directory, "work-craft.db");
  const db = openDatabase(path);
  db.exec(`
    INSERT INTO sessions VALUES ('session-1', 'Main', 0);
    INSERT INTO workspaces VALUES ('workspace-1', 'session-1', 'Work', 0);
    INSERT INTO projects VALUES ('project-1', 'workspace-1', 'implementation', 'Work Craft', 0);
    INSERT INTO items VALUES ('item-1', 'project-1', 'surface', 'Build', 0, '{}', NULL);
    INSERT INTO surfaces VALUES ('surface-1', 'item-1', NULL);
    INSERT INTO panes VALUES ('pane-1', 'surface-1', 'terminal', 'Shell', '/tmp', '{"type":"shell","executable":"/bin/sh","args":[]}', 'running', NULL, NULL, NULL);
  `);
  const history = new TerminalHistory(db);
  const registry = runtime({
    onOutput: (paneId, bytes) => {
      history.append(paneId, bytes);
    },
  });

  try {
    await registry.start(
      shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf persisted-output"]),
    );
    expect(await registry.waitForExit("pane-1")).toBe(0);
    await history.flush();
    db.close();

    const reopened = openDatabase(path);
    const persisted = new TerminalHistory(reopened).read("pane-1");
    expect(new TextDecoder().decode(persisted.data)).toContain("persisted-output");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

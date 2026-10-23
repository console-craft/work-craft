import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PaneStatus } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { TerminalHistory } from "./history.ts";
import type { HistoryReplay } from "./history.ts";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";
import { type RuntimeCallbacks, RuntimeRegistry } from "./runtime.ts";

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

function coldHistory(): HistoryReplay {
  const data = new TextEncoder().encode("retained\r\n");
  return {
    paneId: "pane-1",
    data,
    cursor: data.length,
    startCursor: 0,
    prefixBytes: 0,
    truncated: false,
    initialSize: { cols: 80, rows: 24 },
    initialGridSequence: null,
    resizes: [],
    starts: [],
  };
}

test("a pending cold start owns its pane before native reconstruction yields", async () => {
  const registry = runtime();
  const starting = registry.start(shellPane("pane-1", process.cwd()), undefined, coldHistory());
  try {
    await expect(
      registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "exit 0"])),
    ).rejects.toThrow(/already/);
    expect(registry.generation("pane-1")).toBe(1);
  } finally {
    await starting;
  }
});

test("manual preparation is admitted once after spawn validation and owned through shutdown", async () => {
  const registry = runtime();
  let preparations = 0;
  const gate = Promise.withResolvers<void>();
  const prepare = async () => {
    preparations++;
    await gate.promise;
    return coldHistory();
  };
  await expect(
    registry.start(shellPane("invalid", "/missing-work-craft-cwd"), undefined, prepare),
  ).rejects.toThrow(/directory/);
  expect(preparations).toBe(0);
  const start = registry.start(shellPane("pane-1", process.cwd()), undefined, prepare);
  await expect(
    registry.start(shellPane("pane-1", process.cwd()), undefined, prepare),
  ).rejects.toThrow(/already/);
  const stop = registry.stopAll();
  gate.resolve();
  await Promise.all([start, stop]);
  expect(preparations).toBe(1);
  expect(registry.isLive("pane-1")).toBe(false);
});

test("replacement waits for final old output and cleanup before advancing generation", async () => {
  const output: string[] = [];
  const registry = runtime({
    onOutput: (_id, bytes) => output.push(new TextDecoder().decode(bytes)),
  });
  const spawn = spyOn(Bun, "spawn");
  const sleep = Bun.sleep;
  const gate = Promise.withResolvers<void>();
  let held = false;
  const sleeper = spyOn(Bun, "sleep").mockImplementation((ms) => {
    if (ms === 0 && !held) {
      held = true;
      return gate.promise;
    }
    return sleep(ms);
  });
  try {
    await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf OLD"]));
    while (!held) {
      await sleep(5);
    }
    const options = spawn.mock.calls.at(-1)![1]!;
    const child = spawn.mock.results.at(-1)!.value as Bun.Subprocess;
    const data = (options.terminal as Bun.TerminalOptions).data!;
    let prepared = false;
    const next = registry.start(
      shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf NEW"]),
      undefined,
      async () => {
        prepared = true;
        return undefined;
      },
    );
    expect(registry.generation("pane-1")).toBe(1);
    expect(prepared).toBe(false);
    data(child.terminal!, new TextEncoder().encode("FINAL-OLD"));
    gate.resolve();
    await next;
    await registry.waitForExit("pane-1");
    expect(output.join("")).toContain("FINAL-OLD");
    expect(output.join("")).toContain("NEW");
    expect(prepared).toBe(true);
  } finally {
    gate.resolve();
    sleeper.mockRestore();
    spawn.mockRestore();
  }
});

test("shutdown waits for pending cold capture cleanup and prevents a late child spawn", async () => {
  const statuses: PaneStatus[] = [];
  const registry = runtime({ onStatus: (_id, status) => statuses.push(status) });
  const starting = registry.start(shellPane("pane-1", process.cwd()), undefined, coldHistory());
  const stopping = registry.stopAll({ preserveStatus: true });
  await expect(
    registry.start(shellPane("other", process.cwd(), "/bin/sh", ["-c", "exit 0"])),
  ).rejects.toThrow(/stopping/);
  await stopping;
  await starting;
  expect(registry.isLive("pane-1")).toBe(false);
  expect(statuses).toEqual(["starting"]);
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "exit 0"]));
  await registry.waitForExit("pane-1");
  expect(registry.generation("pane-1")).toBe(2);
});

test("runtime generation increments before callbacks and survives exit and failed startup", async () => {
  const events: { status: PaneStatus; generation: number; current: number }[] = [];
  const outputs: number[] = [];
  const registry = runtime({
    onStatus: (_id, status, generation) =>
      events.push({ status, generation, current: registry.generation("pane-1") }),
    onOutput: (_id, _bytes, generation) => outputs.push(generation),
  });
  expect(registry.generation("pane-1")).toBe(0);
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf first"]));
  await registry.waitForExit("pane-1");
  expect(events).toEqual(
    (["starting", "running", "exited"] as const).map((status) => ({
      status,
      generation: 1,
      current: 1,
    })),
  );
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.every((generation) => generation === 1)).toBe(true);
  await expect(registry.start(shellPane("pane-1", "/missing-work-craft-cwd"))).rejects.toThrow();
  expect(events.slice(-2)).toEqual(
    (["starting", "failed"] as const).map((status) => ({ status, generation: 2, current: 2 })),
  );
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "exit 0"]));
  await registry.waitForExit("pane-1");
  expect(registry.generation("pane-1")).toBe(3);
});

test("a late PTY output callback from a replaced child is rejected instead of relabelled", async () => {
  const output: string[] = [];
  const registry = runtime({
    onOutput: (_id, bytes) => output.push(new TextDecoder().decode(bytes)),
  });
  const spawn = spyOn(Bun, "spawn");
  try {
    await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf first"]));
    const options = spawn.mock.calls.at(-1)?.[1];
    const spawned = spawn.mock.results.at(-1)?.value;
    if (
      !options ||
      typeof options.terminal !== "object" ||
      !("data" in options.terminal) ||
      !options.terminal.data ||
      !spawned ||
      typeof spawned !== "object" ||
      !("terminal" in spawned) ||
      !(spawned.terminal instanceof Bun.Terminal)
    ) {
      throw new Error("missing real PTY data callback");
    }
    const firstOutput = options.terminal.data;
    const terminal = spawned.terminal;
    await registry.waitForExit("pane-1");
    await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "printf second"]));
    firstOutput(terminal, new TextEncoder().encode("STALE"));
    await registry.waitForExit("pane-1");
    expect(output.join("")).toContain("first");
    expect(output.join("")).toContain("second");
    expect(output.join("")).not.toContain("STALE");
    expect(registry.generation("pane-1")).toBe(2);
  } finally {
    spawn.mockRestore();
  }
});

test("live cwd follows shell cd, not foreground child cd", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "work-craft-runtime-cwd-")));
  let output = "";
  const registry = runtime({
    onOutput: (_id, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  async function waitForOutput(sentinel: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!output.includes(sentinel) && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    expect(output).toContain(sentinel);
  }
  try {
    const pane = shellPane("pane-1", root);
    await registry.start(pane);
    for (const [index, name] of ["ordinary space ü ", "back\\slash", "new\nline"].entries()) {
      const path = join(root, name);
      await mkdir(path);
      registry.write("pane-1", Buffer.from(`cd ${quote(path)}; printf 'cwd-%s-ready' ${index}\n`));
      await waitForOutput(`cwd-${index}-ready`);
      expect(await registry.currentDirectory("pane-1")).toBe(path);
    }
    registry.write("pane-1", Buffer.from(`sh -c 'cd /; printf child-%s-ready cwd; sleep 30'\n`));
    await waitForOutput("child-cwd-ready");
    expect(await registry.currentDirectory("pane-1")).toBe(join(root, "new\nline"));
    expect(pane.cwd).toBe(root);
  } finally {
    await registry.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("resizing a shell PTY notifies its nested application without requiring input", async () => {
  let output = "";
  const registry = runtime({
    onOutput: (_id, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const code = `process.on("SIGWINCH", () => {
    const size = Bun.spawnSync(["stty", "size"], { stdin: "inherit" });
    console.log("child-resized=" + new TextDecoder().decode(size.stdout).trim());
  }); console.log("child-ready"); setInterval(() => {}, 1000);`;
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  await registry.start(
    shellPane("pane-1", process.cwd(), "/bin/sh", [
      "-c",
      `${quote(process.execPath)} -e ${quote(code)}; :`,
    ]),
  );
  async function waitFor(text: string): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!output.includes(text) && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    expect(output).toContain(text);
  }
  await waitFor("child-ready");
  registry.resize("pane-1", 100, 30);
  await waitFor("child-resized=30 100");
});

test("current directory rejects missing and exited runtimes", async () => {
  const registry = runtime();
  await expect(registry.currentDirectory("missing")).rejects.toThrow("no live runtime");
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "exit 0"]));
  await registry.waitForExit("pane-1");
  await expect(registry.currentDirectory("pane-1")).rejects.toThrow("no live runtime");
});

test("current directory rejects a signal-terminated runtime", async () => {
  const registry = runtime();
  await registry.start(shellPane("pane-1", process.cwd(), "/bin/sh", ["-c", "kill -KILL $$"]));
  await registry.waitForExit("pane-1");
  await expect(registry.currentDirectory("pane-1")).rejects.toThrow("no live runtime");
  expect(registry.isLive("pane-1")).toBe(false);
});

test("a replaced runtime cannot supply a stale cwd", async () => {
  const cwd = await import("./cwd.ts");
  const registry = runtime();
  await registry.start(shellPane("pane-1", process.cwd()));
  let complete!: (path: string) => void;
  const probe = spyOn(cwd, "readProcessCwd").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  try {
    const pending = registry.currentDirectory("pane-1");
    await registry.stopAll();
    await registry.start(shellPane("pane-1", process.cwd()));
    complete(process.cwd());
    await expect(pending).rejects.toThrow("runtime changed");
    expect(registry.isLive("pane-1")).toBe(true);
  } finally {
    probe.mockRestore();
  }
});

test("an exiting runtime cannot supply cwd after validation", async () => {
  const cwd = await import("./cwd.ts");
  const registry = runtime();
  await registry.start(shellPane("pane-1", process.cwd()));
  let complete!: (path: string) => void;
  let validating!: () => void;
  const started = new Promise<void>((resolve) => {
    validating = resolve;
  });
  const validate = spyOn(cwd, "validateSplitCwd").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
        validating();
      }),
  );
  try {
    const pending = registry.currentDirectory("pane-1");
    await started;
    registry.write("pane-1", Buffer.from("exit\n"));
    await registry.waitForExit("pane-1");
    complete(process.cwd());
    await expect(pending).rejects.toThrow("runtime changed");
  } finally {
    validate.mockRestore();
  }
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
    onStatus: (_paneId, status, _generation, error) => statuses.push({ status, error }),
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
    projection: { parser: null, sequence: 0 },
    pendingBytes: 0,
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
    INSERT INTO workspaces VALUES ('workspace-1', 'Work');
    INSERT INTO session_workspaces VALUES ('session-1', 'workspace-1', 0);
    INSERT INTO items VALUES ('item-1', 'workspace-1', 'design', NULL, 'generic', 'Build', 0, 0, '{}');
    INSERT INTO surfaces VALUES ('surface-1', 'item-1');
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

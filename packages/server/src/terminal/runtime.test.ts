import { afterEach, expect, spyOn, test } from "bun:test";
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

test("stops all live runtimes", async () => {
  const registry = runtime();
  await registry.start(shellPane("pane-1", process.cwd()));
  await registry.start(shellPane("pane-2", process.cwd()));

  await registry.stopAll();

  expect(registry.isLive("pane-1")).toBe(false);
  expect(registry.isLive("pane-2")).toBe(false);
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

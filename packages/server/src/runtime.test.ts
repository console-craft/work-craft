import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.ts";
import { TerminalHistory } from "./history.ts";
import type { PaneStatus } from "./protocol.ts";
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

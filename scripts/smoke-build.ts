import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defaultTheme } from "@/ui/theming/themes/default.ts";

import { createClient, decodeBytes } from "../packages/server/src/client.ts";
import { sendTerminalInput } from "./test-support/terminal-input.ts";

if (process.argv.includes("--self-test")) {
  assert.equal(
    shellPid("printf 'COMPILED-PID-%s\\n' \"$$\"\r\nCOMPILED-PID-123\r\n", "COMPILED"),
    "123",
  );
  assert.equal(shellPid("COMPILED-PID-nope\r\n", "COMPILED"), undefined);
  assert.equal(shellPid("echo COMPILED-PID-123\r\n", "COMPILED"), undefined);
  assert.equal(shellPid("RETAINED-PID-456\n", "RETAINED"), "456");
  assert.equal(shellPid("COMPILED-PID-123\n", "RETAINED"), undefined);
  console.log("compiled smoke PID self-checks passed (5 assertions)");
  process.exit(0);
}

function shellPid(output: string, marker: "COMPILED" | "RETAINED"): string | undefined {
  return output.match(new RegExp(`(?:^|\\n)${marker}-PID-([1-9]\\d*)\\r?\\n`))?.[1];
}

const root = resolve(import.meta.dir, "..");
const executable = join(root, "dist", "work-craft");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "work-craft-build-"));
const installDirectory = join(temporaryDirectory, "install");
const installedExecutable = join(installDirectory, "work-craft");
const home = join(temporaryDirectory, "state");
const socketPath = join(home, "work-craft.sock");

function colorChannels(color: string): number[] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const dimmedConnectedColor = `38;2;${colorChannels(defaultTheme.colors.success)
  .map((channel) => Math.round(channel * 0.35))
  .join(";")}m`;

await mkdir(installDirectory);
await copyFile(executable, installedExecutable);
await chmod(installedExecutable, 0o755);

async function run(args: string[]): Promise<string> {
  console.log("compiled smoke command:", args.join(" "));
  const child = Bun.spawn([installedExecutable, ...args], {
    cwd: installDirectory,
    env: { ...process.env, WORK_CRAFT_HOME: home, SHELL: "/bin/sh" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited.finally(() => clearTimeout(timeout)),
  ]);
  if (timedOut) {
    throw new Error(`${args.join(" ")} timed out`);
  }
  if (exitCode !== 0) {
    throw new Error(`${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  }
  return stdout;
}

async function smokeTui(): Promise<void> {
  let output = "";
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data: (_terminal, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const child = Bun.spawn([installedExecutable], {
    cwd: installDirectory,
    detached: true,
    env: { ...process.env, WORK_CRAFT_HOME: home },
    terminal,
  });

  try {
    const deadline = Date.now() + 3_000;
    while (
      !output.includes(dimmedConnectedColor) &&
      child.exitCode === null &&
      Date.now() < deadline
    ) {
      await Bun.sleep(20);
    }
    if (!output.includes(dimmedConnectedColor)) {
      throw new Error(`compiled TUI did not connect: ${output.trim()}`);
    }
  } finally {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The TUI and its process group already exited.
      }
      await Promise.race([child.exited, Bun.sleep(500)]);
    }
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The TUI and its process group exited after SIGTERM.
      }
    }
    await child.exited;
    terminal.close();
  }
}

async function waitForSocketRemoval(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (existsSync(socketPath) && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  if (existsSync(socketPath)) {
    throw new Error("compiled daemon did not remove its socket after stopping");
  }
}

try {
  const status = JSON.parse(await run(["daemon", "status", "--json"])) as { running?: unknown };
  if (status.running !== true) {
    throw new Error("compiled status did not report a running daemon");
  }
  await smokeCoding();
  await smokeTui();
  await run(["daemon", "stop", "--json"]);
  await waitForSocketRemoval();
} finally {
  if (existsSync(socketPath)) {
    try {
      await createClient({ socketPath }).command({ type: "daemon.stop" });
      await waitForSocketRemoval();
    } catch {
      // Preserve the smoke-test failure; temporary state is removed below.
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function smokeCoding(): Promise<void> {
  const expectedCwd = await realpath(installDirectory);
  const session = JSON.parse(await run(["session", "create", "--name", "Compiled", "--json"])) as {
    id: string;
  };
  const workspace = JSON.parse(
    await run(["workspace", "create", "--session", session.id, "--name", "Smoke", "--json"]),
  ) as { id: string };
  const registered = JSON.parse(
    await run([
      "directory",
      "register",
      "--workspace",
      workspace.id,
      "--path",
      installDirectory,
      "--json",
    ]),
  ) as { id: string; itemId: string; rootItemId: string };
  const duplicate = JSON.parse(
    await run([
      "directory",
      "register",
      "--workspace",
      workspace.id,
      "--path",
      installDirectory,
      "--json",
    ]),
  ) as { id: string; itemId: string; rootItemId: string };
  const client = createClient({ socketPath });
  const metadata = await client.snapshot();
  if (
    registered.itemId !== registered.id ||
    registered.rootItemId !== registered.id ||
    duplicate.id !== registered.id ||
    duplicate.itemId !== registered.id ||
    duplicate.rootItemId !== registered.id ||
    metadata.items.length !== 1 ||
    metadata.items[0]?.id !== registered.id ||
    metadata.items[0]?.parentId !== null ||
    metadata.surfaces.length !== 0 ||
    metadata.tabs.length !== 0 ||
    metadata.panes.length !== 0
  ) {
    throw new Error("compiled duplicate registration lost root identity or opened a surface");
  }
  const opened = JSON.parse(
    await run(["surface", "ensure", "--item", registered.id, "--json"]),
  ) as { surfaceId: string; paneId: string };
  const selected = JSON.parse(
    await run(["session", "open-item", session.id, "--item", registered.id, "--json"]),
  );
  assert.equal(selected.paneId, opened.paneId, "compiled Open duplicated the runtime");
  const selectedPane = JSON.parse(
    await run(["session", "select", session.id, "--pane", opened.paneId, "--json"]),
  );
  assert.equal(selectedPane.navigation.paneId, opened.paneId);
  const stepped = JSON.parse(
    await run(["session", "step", session.id, "--level", "tab", "--direction", "next", "--json"]),
  );
  assert.deepEqual(
    stepped.navigation,
    selectedPane.navigation,
    "compiled single-tab step changed selection",
  );
  const stream = await client.stream({ onMessage() {} });
  try {
    await sendTerminalInput(
      client,
      stream,
      opened.paneId,
      new TextEncoder().encode('printf \'COMPILED-CWD-%s\\nCOMPILED-PID-%s\\n\' "$(pwd)" "$$"\r'),
    );
    const deadline = Date.now() + 3000;
    let snapshot = await client.snapshot();
    function output(paneId = opened.paneId): string {
      return new TextDecoder().decode(
        decodeBytes(
          snapshot.terminalHistories.find((history) => history.paneId === paneId)?.data ?? "",
        ),
      );
    }
    while (
      (!output().includes(`COMPILED-CWD-${expectedCwd}`) || !shellPid(output(), "COMPILED")) &&
      Date.now() < deadline
    ) {
      await Bun.sleep(20);
      snapshot = await client.snapshot();
    }
    if (!output().includes(`COMPILED-CWD-${expectedCwd}`) || !shellPid(output(), "COMPILED")) {
      throw new Error("compiled Coding terminal did not start in the registered directory");
    }
    const originalPid = shellPid(output(), "COMPILED")!;
    console.log("compiled smoke source PID:", originalPid);
    const liveCwd = join(expectedCwd, "live cwd 雪");
    await mkdir(liveCwd);
    await sendTerminalInput(
      client,
      stream,
      opened.paneId,
      new TextEncoder().encode(`cd '${liveCwd}'; printf 'LIVE-%s\\n' ready\r`),
    );
    await waitForOutput(opened.paneId, (text) => text.includes("LIVE-ready"), "source shell cd");
    console.log("compiled smoke live cwd:", liveCwd);
    const split = JSON.parse(
      await run(["pane", "split", opened.paneId, "--direction", "vertical", "--json"]),
    ) as { paneId: string };
    await sendTerminalInput(
      client,
      stream,
      split.paneId,
      new TextEncoder().encode("printf 'SPLIT-CWD-%s\\n' \"$(pwd)\"\r"),
    );
    await waitForOutput(
      split.paneId,
      (text) => text.includes(`SPLIT-CWD-${liveCwd}`),
      "new shell live cwd",
    );
    await sendTerminalInput(
      client,
      stream,
      opened.paneId,
      new TextEncoder().encode("printf 'RETAINED-PID-%s\\n' \"$$\"\r"),
    );
    await waitForOutput(
      opened.paneId,
      (text) => shellPid(text, "RETAINED") !== undefined,
      "retained source PID",
    );
    assert.equal(
      shellPid(output(), "RETAINED"),
      originalPid,
      "compiled split restarted the source shell",
    );
    assert.ok(
      output().includes(`COMPILED-CWD-${expectedCwd}`),
      "compiled split lost source output",
    );

    async function waitForOutput(
      paneId: string,
      ready: (text: string) => boolean,
      description: string,
    ): Promise<void> {
      const deadline = Date.now() + 3_000;
      snapshot = await client.snapshot();
      while (!ready(output(paneId)) && Date.now() < deadline) {
        await Bun.sleep(20);
        snapshot = await client.snapshot();
      }
      assert.ok(ready(output(paneId)), `compiled smoke timed out waiting for ${description}`);
    }
    await run(["item", "archive", registered.id]);
    await run(["item", "restore", registered.id]);
    const reopened = JSON.parse(
      await run(["surface", "ensure", "--item", registered.id, "--json"]),
    ) as { surfaceId: string; paneId: string };
    const retained = await client.snapshot();
    const originalPane = snapshot.panes.find((pane) => pane.id === opened.paneId);
    const retainedPane = retained.panes.find((pane) => pane.id === opened.paneId);
    if (
      reopened.surfaceId !== opened.surfaceId ||
      !retainedPane ||
      retainedPane.startedAt !== originalPane?.startedAt ||
      retainedPane.processStatus !== "running"
    ) {
      throw new Error("compiled Coding open did not retain its runtime");
    }
    await run(["session", "delete", session.id]);
  } finally {
    stream.close();
  }
}

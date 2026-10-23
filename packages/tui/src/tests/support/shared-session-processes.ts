import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createClient, type WorkCraftClient } from "@work-craft/server/client";

import { flushProfileProbes } from "@/tests/support/output-profile-trace";
import { createTerminalObservation } from "@/tests/support/terminal-observation";

const ROOT = resolve(import.meta.dir, "../../../../..");

export type SharedTuiProcess = {
  child: Bun.Subprocess;
  terminal: Bun.Terminal;
  output(): string;
  frame(): string;
  cursor(): { x: number; y: number; visible: boolean };
  outputStats(): { rawBytes: number; parseMs: number };
};

export type SharedSessionFixture = {
  home: string;
  client: WorkCraftClient;
  tuis: [SharedTuiProcess, SharedTuiProcess];
  sessionId: string;
  workspaceId: string;
  itemId: string;
  paneId: string;
  tabId: string;
  startTui(cols: number, rows: number): SharedTuiProcess;
  stopTui(tui: SharedTuiProcess): Promise<void>;
  resizeTui(tui: SharedTuiProcess, cols: number, rows: number): Promise<void>;
  restartDaemon(): Promise<void>;
  crashDaemon(): Promise<void>;
  pauseDaemon(): () => void;
  cli(args: string[]): Promise<Record<string, unknown>>;
  flushDiagnostics(): Promise<void>;
  close(): Promise<void>;
};

export async function sharedWait(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  details: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for ${message}\n${details()}`);
}

async function stopGroup(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    await Promise.race([child.exited, Bun.sleep(500)]);
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  }
  await child.exited;
}

export function sharedWrite(tui: SharedTuiProcess, text: string): void {
  tui.terminal.write(new TextEncoder().encode(text));
}

/** Only confirmed group absence makes failed fixture cleanup harmless. */
export async function killSharedProcessGroup(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      // A dying macOS group can briefly reject even an existence probe.
      const deadline = Date.now() + 250;
      while (Date.now() < deadline) {
        try {
          process.kill(-pid, 0);
          break;
        } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code === "ESRCH") {
            return;
          }
          if ((probe as NodeJS.ErrnoException).code !== "EPERM") {
            break;
          }
        }
        await Bun.sleep(10);
      }
    }
    throw error;
  }
}

export async function waitForSharedTerminalInput(
  tui: SharedTuiProcess,
  afterBytes: number,
): Promise<void> {
  const ready = () => {
    const added = tui.outputStats().rawBytes - afterBytes;
    if (added <= 0) {
      return false;
    }
    const output = Buffer.from(tui.output()).subarray(-added).toString();
    return output.lastIndexOf("\x1b[?25h") > output.lastIndexOf("\x1b[?25l");
  };
  await sharedWait(ready, "native workbench input", tui.frame);
}

export async function focusSharedTerminal(tui: SharedTuiProcess, tabColumn = 70): Promise<void> {
  const start = tui.outputStats().rawBytes;
  sharedWrite(tui, `\x1b[<0;${tabColumn};4M`);
  await sharedWait(() => !tui.cursor().visible, "tab press to withdraw terminal focus", tui.frame);
  // Release already enters the tab; Return can cancel that still-pending handoff.
  sharedWrite(tui, `\x1b[<0;${tabColumn};4m`);
  await waitForSharedTerminalInput(tui, start);
}

export async function startSharedSessionFixture(
  options: { profileDirectory?: string; boundedObservation?: boolean } = {},
): Promise<SharedSessionFixture> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-shared-")));
  const client = createClient({ socketPath: join(home, "work-craft.sock") });
  const shell = join(home, "shell");
  await writeFile(shell, `#!/bin/sh\nprintf '%s\\n' "$$" >> '${home}/shell-pids'\nexec /bin/sh\n`);
  await chmod(shell, 0o755);
  const profileDirectory =
    options.profileDirectory ?? process.env.WORK_CRAFT_OUTPUT_PROFILE_DIR ?? "";
  const environment = {
    ...process.env,
    WORK_CRAFT_HOME: home,
    SHELL: shell,
    WORK_CRAFT_OUTPUT_PROFILE_DIR: profileDirectory,
  };
  function spawnDaemon() {
    return Bun.spawn([process.execPath, join(ROOT, "packages/server/src/main.ts")], {
      cwd: ROOT,
      env: { ...environment, WORK_CRAFT_OUTPUT_PROFILE_ROLE: "daemon" },
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
  }
  let daemon = spawnDaemon();
  const display = await createTestRenderer({ width: 200, height: 60, exitOnCtrlC: false });
  const processes = new Map<SharedTuiProcess, EmbeddedTerminalRenderable>();
  let nextTuiId = 0;
  const fixture = {
    home,
    client,
    async flushDiagnostics(): Promise<void> {
      if (!profileDirectory) {
        return;
      }
      const live = [daemon, ...Array.from(processes.keys(), (tui) => tui.child)].filter(
        (child) => child.exitCode === null && child.signalCode === null,
      );
      await flushProfileProbes(
        profileDirectory,
        live.map((child) => child.pid),
      );
    },
    startTui(cols: number, rows: number): SharedTuiProcess {
      let output = "";
      const decoder = new TextDecoder();
      let terminal: Bun.Terminal | undefined;
      const screen = new EmbeddedTerminalRenderable(display.renderer, {
        id: `outer-${nextTuiId++}`,
        cols,
        rows,
        width: cols,
        height: rows,
        position: "absolute",
        flexShrink: 0,
      });
      display.renderer.root.add(screen);
      const observation = options.boundedObservation
        ? createTerminalObservation(screen)
        : undefined;
      terminal = new Bun.Terminal({
        cols,
        rows,
        data: (_terminal, bytes) => {
          if (observation) {
            observation.write(bytes);
          } else {
            output += decoder.decode(bytes, { stream: true });
            screen.write(bytes);
          }
        },
      });
      const child = Bun.spawn([process.execPath, "run", "tui"], {
        cwd: ROOT,
        env: { ...environment, WORK_CRAFT_OUTPUT_PROFILE_ROLE: "tui" },
        detached: true,
        terminal,
      });
      const tui = {
        child,
        terminal,
        output: () => (observation ? new TextDecoder().decode(observation.retained()) : output),
        frame: () => screen.screen().text,
        cursor: () => screen.screen().cursor,
        outputStats: () => ({
          rawBytes: observation?.bytes() ?? Buffer.byteLength(output),
          parseMs: observation?.parseMs() ?? 0,
        }),
      };
      processes.set(tui, screen);
      return tui;
    },
    async stopTui(tui: SharedTuiProcess): Promise<void> {
      await stopGroup(tui.child);
      tui.terminal.close();
      processes.get(tui)?.destroy();
      processes.delete(tui);
    },
    async resizeTui(tui: SharedTuiProcess, cols: number, rows: number): Promise<void> {
      const screen = processes.get(tui)!;
      screen.width = cols;
      screen.height = rows;
      await display.flush();
      tui.terminal.resize(cols, rows);
      // Bun's script wrapper does not forward terminal resize signals to the TUI.
      process.kill(-tui.child.pid, "SIGWINCH");
    },
    async restartDaemon(): Promise<void> {
      await client.command({ type: "daemon.stop" });
      await daemon.exited;
      daemon = spawnDaemon();
      await ready();
    },
    async crashDaemon(): Promise<void> {
      const pids = (await readFile(join(home, "shell-pids"), "utf8"))
        .trim()
        .split("\n")
        .map(Number);
      daemon.kill("SIGKILL");
      await daemon.exited;
      for (const pid of pids) {
        await killSharedProcessGroup(pid);
      }
      await sharedWait(
        () =>
          pids.every((pid) => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          }),
        "owned pre-crash shells reaped",
      );
      daemon = spawnDaemon();
      await ready();
    },
    pauseDaemon(): () => void {
      const owned = daemon;
      if (owned.exitCode !== null || owned.signalCode !== null) {
        throw new Error("The fixture daemon has exited");
      }
      process.kill(owned.pid, "SIGSTOP");
      return () => {
        if (owned.exitCode === null && owned.signalCode === null) {
          process.kill(owned.pid, "SIGCONT");
        }
      };
    },
    async cli(args: string[]): Promise<Record<string, unknown>> {
      const child = Bun.spawn(
        [process.execPath, join(ROOT, "packages/cli/src/main.ts"), ...args, "--json"],
        {
          cwd: ROOT,
          env: environment,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, out, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) {
        throw new Error(`CLI ${args.join(" ")}: ${error}`);
      }
      return JSON.parse(out) as Record<string, unknown>;
    },
    async close(): Promise<void> {
      try {
        if (profileDirectory) {
          await fixture.flushDiagnostics().catch(async (error) => {
            await writeFile(
              join(profileDirectory, "flush-failure.json"),
              JSON.stringify({ error: String(error) }),
            ).catch(() => {});
          });
        }
        for (const tui of processes.keys()) {
          await fixture.stopTui(tui);
        }
        if (daemon.exitCode === null) {
          await client.command({ type: "daemon.stop" }).catch(() => {});
          await stopGroup(daemon);
        }
      } finally {
        display.renderer.destroy();
        await rm(home, { recursive: true, force: true });
      }
    },
  };
  async function ready(): Promise<void> {
    await sharedWait(async () => {
      try {
        return (await client.health()).pid === daemon.pid;
      } catch {
        return false;
      }
    }, "isolated daemon");
  }
  try {
    await ready();
    const session = await client.command({ type: "session.create", name: "Shared Session" });
    const workspace = await client.command({
      type: "workspace.create",
      sessionId: session.result.id,
      name: "Shared Workspace",
    });
    const root = await client.command({
      type: "item.create",
      workspaceId: workspace.result.id,
      category: "design",
      title: "Shared Root",
    });
    const item = await client.command({
      type: "item.create",
      workspaceId: workspace.result.id,
      category: "design",
      parentId: root.result.id,
      title: "Shared Child",
    });
    const opened = await fixture.cli([
      "session",
      "open-item",
      session.result.id,
      "--item",
      item.result.id,
      "--cwd",
      home,
    ]);
    const tuis: [SharedTuiProcess, SharedTuiProcess] = [
      fixture.startTui(160, 45),
      fixture.startTui(100, 32),
    ];
    await sharedWait(
      () => tuis.every((tui) => tui.frame().includes("Shared Session")),
      "both normal TUI attachments",
      () => tuis.map((tui) => tui.frame()).join("\n"),
    );
    return {
      ...fixture,
      tuis,
      sessionId: session.result.id,
      workspaceId: workspace.result.id,
      itemId: item.result.id,
      paneId: String(opened.paneId),
      tabId: String(opened.tabId),
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

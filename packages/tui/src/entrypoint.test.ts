import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient, type WorkCraftClient } from "@work-craft/server/client";

const ROOT = resolve(import.meta.dir, "../../..");

async function waitFor(
  predicate: () => boolean,
  message: string,
  details: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  if (!predicate()) {
    throw new Error(`Timed out waiting for ${message}${details()}`);
  }
}

async function stopProcessGroup(child: Bun.Subprocess, terminal: Bun.Terminal): Promise<void> {
  if (child.exitCode === null) {
    terminal.write(Uint8Array.of(3));
    await Promise.race([child.exited, Bun.sleep(500)]);
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The command and all of its children exited from Ctrl-C.
  }
  await child.exited;
}

function startTui(home: string): {
  child: Bun.Subprocess;
  output(): string;
  terminal: Bun.Terminal;
} {
  let output = "";
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data: (_terminal, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const child = Bun.spawn([process.execPath, "run", "tui"], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, WORK_CRAFT_HOME: home },
    terminal,
  });
  return { child, output: () => output, terminal };
}

async function stopDaemon(client: WorkCraftClient, socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) {
    return;
  }
  try {
    await client.command({ type: "daemon.stop" });
    await waitFor(() => !existsSync(socketPath), "the daemon to stop");
  } catch {
    // The daemon may already be exiting with the TUI process.
  }
}

async function startDaemon(client: WorkCraftClient, home: string): Promise<void> {
  const previousHome = process.env.WORK_CRAFT_HOME;
  process.env.WORK_CRAFT_HOME = home;
  try {
    await client.ensureDaemon({ recover: false });
  } finally {
    if (previousHome === undefined) {
      delete process.env.WORK_CRAFT_HOME;
    } else {
      process.env.WORK_CRAFT_HOME = previousHome;
    }
  }
}

test("an empty installation offers session creation from the chooser", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  const tui = startTui(home);

  try {
    await waitFor(
      () => tui.output().includes("sessions.") && tui.output().includes("create"),
      "the empty session chooser",
      () => `\n${tui.output()}`,
    );
    tui.terminal.write(new TextEncoder().encode("n"));
    await waitFor(
      () => tui.output().includes("session name"),
      "the session prompt",
      () => `\n${tui.output()}`,
    );
    expect(tui.output()).toContain("session name");
  } finally {
    await stopProcessGroup(tui.child, tui.terminal);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("one session is selected automatically and deletion returns to the chooser", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Main" });
  const tui = startTui(home);

  try {
    await waitFor(
      () => tui.output().includes("Main") && tui.output().includes("connected"),
      "the only session to be selected",
      () => `\n${tui.output()}`,
    );
    const outputLength = tui.output().length;
    await client.command({ type: "session.delete", sessionId: session.result.id });
    await waitFor(() => tui.output().slice(outputLength).includes("choose"), "the session chooser");
  } finally {
    await stopProcessGroup(tui.child, tui.terminal);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("session selection remains local to each TUI client", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  await client.command({ type: "session.create", name: "First" });
  await client.command({ type: "session.create", name: "Second" });
  const first = startTui(home);
  const second = startTui(home);
  const input = new TextEncoder();

  try {
    await waitFor(
      () => first.output().includes("n:") && second.output().includes("n:"),
      "both session choosers",
      () => `\nFirst:\n${first.output()}\nSecond:\n${second.output()}`,
    );
    const firstOutputLength = first.output().length;
    const secondOutputLength = second.output().length;
    first.terminal.write(input.encode("\r"));
    second.terminal.write(input.encode("\u001b[B"));
    await waitFor(
      () => second.output().length > secondOutputLength,
      "the second chooser selection to move",
    );
    const secondSelectionOutputLength = second.output().length;
    second.terminal.write(input.encode("\r"));
    await waitFor(
      () => first.output().slice(firstOutputLength).includes("First"),
      "the first TUI selection",
      () => `\n${first.output().slice(firstOutputLength)}`,
    );
    await waitFor(
      () => {
        const update = second.output().slice(secondSelectionOutputLength);
        return update.includes("Sec") && update.includes("nd");
      },
      "the second TUI selection",
      () => `\n${second.output().slice(secondSelectionOutputLength)}`,
    );
  } finally {
    await Promise.all([
      stopProcessGroup(first.child, first.terminal),
      stopProcessGroup(second.child, second.terminal),
    ]);
    first.terminal.close();
    second.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient, type WorkCraftClient } from "@work-craft/server/client";

const ROOT = resolve(import.meta.dir, "../../..");
const CONNECTED_COLOR = "38;2;34;197;94m";

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

async function stopProcessGroup(child: Bun.Subprocess): Promise<void> {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The command and all of its children already exited.
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
      () =>
        tui.output().includes("sessions.") &&
        tui.output().includes("create") &&
        tui.output().includes(CONNECTED_COLOR),
      "the empty session chooser",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);
    tui.terminal.write(new TextEncoder().encode("n"));
    await waitFor(
      () => tui.output().includes("session name"),
      "the session prompt",
      () => `\n${tui.output()}`,
    );
    expect(tui.output()).toContain("session name");
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("the switch key makes the chooser authoritative", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  await client.command({ type: "session.create", name: "First" });
  await client.command({ type: "session.create", name: "Second" });
  const tui = startTui(home);

  try {
    await waitFor(
      () =>
        tui.output().includes("Session: choose") &&
        tui.output().includes("Sessions") &&
        tui.output().includes(CONNECTED_COLOR),
      "the initial session chooser",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);
    const selectionOutputLength = tui.output().length;
    tui.terminal.write(new TextEncoder().encode("\r"));
    await waitFor(() => {
      const update = tui.output().slice(selectionOutputLength);
      return update.includes("Fir");
    }, "the first session to be selected");
    await Bun.sleep(100);
    const outputLength = tui.output().length;
    tui.terminal.write(new TextEncoder().encode("\x1b[115;17u"));
    await waitFor(
      () => {
        const update = tui.output().slice(outputLength);
        return update.includes("Sessions") && update.includes("n:");
      },
      "the explicit session chooser",
      () => `\n${tui.output().slice(outputLength)}`,
    );
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("deleting the active session replaces an open prompt with the chooser", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Main" });
  const tui = startTui(home);

  try {
    await waitFor(
      () => tui.output().includes("Mai") && tui.output().includes(CONNECTED_COLOR),
      "the only session to be selected",
      () => `\n${tui.output()}`,
    );
    const focusOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(11));
    await waitFor(() => tui.output().length > focusOutputLength, "workspace focus");
    tui.terminal.write(new TextEncoder().encode("n"));
    await waitFor(() => tui.output().includes("workspace name"), "the workspace prompt");
    const outputLength = tui.output().length;
    await client.command({ type: "session.delete", sessionId: session.result.id });
    await waitFor(
      () => {
        const update = tui.output().slice(outputLength);
        return update.includes("choose") && update.includes("No sessions.");
      },
      "the chooser to replace the prompt",
      () => `\n${tui.output().slice(outputLength)}`,
    );
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("an automatically selected session remains active when another session is created", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const first = await client.command({ type: "session.create", name: "First" });
  const tui = startTui(home);

  try {
    await waitFor(
      () => tui.output().includes("Fir") && tui.output().includes(CONNECTED_COLOR),
      "the only session to be selected",
      () => `\n${tui.output()}`,
    );
    const outputLength = tui.output().length;
    await client.command({ type: "session.create", name: "Second" });
    await client.command({ type: "session.update", sessionId: first.result.id, name: "Primary" });
    await waitFor(
      () => tui.output().slice(outputLength).includes("Primary"),
      "the later session update",
    );
    expect(tui.output().slice(outputLength)).not.toContain("choose");

    const focusOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(11));
    await waitFor(() => tui.output().length > focusOutputLength, "workspace focus");
    tui.terminal.write(new TextEncoder().encode("n"));
    await waitFor(() => tui.output().includes("workspace name"), "the workspace prompt");
  } finally {
    await stopProcessGroup(tui.child);
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
      () =>
        first.output().includes("Session: choose") &&
        first.output().includes("Sessions") &&
        first.output().includes(CONNECTED_COLOR) &&
        second.output().includes("Session: choose") &&
        second.output().includes("Sessions") &&
        second.output().includes(CONNECTED_COLOR),
      "both session choosers",
      () => `\nFirst:\n${first.output()}\nSecond:\n${second.output()}`,
    );
    await Bun.sleep(100);
    const firstOutputLength = first.output().length;
    const secondOutputLength = second.output().length;
    first.terminal.write(input.encode("\r"));
    await waitFor(
      () => first.output().slice(firstOutputLength).includes("Fir"),
      "the first TUI selection",
      () => `\n${first.output().slice(firstOutputLength)}`,
    );
    second.terminal.write(input.encode("\u001b[B"));
    await waitFor(
      () => second.output().length > secondOutputLength,
      "the second chooser selection to move",
    );
    await Bun.sleep(50);
    const secondSelectionOutputLength = second.output().length;
    second.terminal.write(input.encode("\r"));
    await waitFor(
      () => {
        const update = second.output().slice(secondSelectionOutputLength);
        return update.includes("Sec") && update.includes("nd");
      },
      "the second TUI selection",
      () => `\n${second.output().slice(secondSelectionOutputLength)}`,
    );
  } finally {
    await Promise.all([stopProcessGroup(first.child), stopProcessGroup(second.child)]);
    first.terminal.close();
    second.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
});

test("raw stage 1 key sequences drive the shell", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Keys" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workbench",
  });
  const project = await client.command({
    type: "project.create",
    workspaceId: workspace.result.id,
    category: "implementation",
    name: "Input Project",
  });
  const item = await client.command({
    type: "item.create",
    projectId: project.result.id,
    kind: "surface",
    title: "Input Item",
  });
  await client.command({ type: "surface.ensure", itemId: item.result.id });
  const tui = startTui(home);
  const input = new TextEncoder();

  try {
    await waitFor(
      () => tui.output().includes("Keys") && tui.output().includes(CONNECTED_COLOR),
      "the populated shell",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);

    tui.terminal.write(input.encode("\x1b[104;17u"));
    tui.terminal.write(input.encode("\x1b[108;17u"));
    await waitFor(() => tui.output().includes("Today"), "the next category");
    tui.terminal.write(input.encode("\x1b[108;17u"));
    await waitFor(() => tui.output().includes("Design"), "the design category");
    tui.terminal.write(input.encode("\x1b[108;17u"));
    await waitFor(() => tui.output().includes("Implementation"), "the project category");

    tui.terminal.write(Uint8Array.of(12));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("l"));
    await waitFor(() => tui.output().includes("Input Item"), "the expanded project");
    tui.terminal.write(input.encode("j"));
    await Bun.sleep(50);
    expect(tui.output()).not.toContain("Main");
    tui.terminal.write(input.encode("\r"));
    await waitFor(() => tui.output().includes("Main"), "item activation");

    tui.terminal.write(Uint8Array.of(12));
    await Bun.sleep(50);
    const leaderOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(0));
    await waitFor(() => tui.output().slice(leaderOutputLength).includes("LEADER"), "leader mode");
    await Bun.sleep(450);
    const passthroughOutputLength = tui.output().length;
    tui.terminal.write(input.encode("x"));
    await waitFor(
      () => tui.output().slice(passthroughOutputLength).includes("x"),
      "expired leader passthrough",
    );

    tui.terminal.write(Uint8Array.of(0));
    await waitFor(() => tui.output().slice(passthroughOutputLength).includes("LEADER"), "leader");
    tui.terminal.write(input.encode("b"));
    await Bun.sleep(50);
    const restoreOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(0));
    await Bun.sleep(20);
    tui.terminal.write(input.encode("b"));
    await waitFor(
      () => tui.output().slice(restoreOutputLength).includes("Input"),
      "navigator restoration",
    );

    const chooserOutputLength = tui.output().length;
    tui.terminal.write(input.encode("\x1b[115;17u"));
    await waitFor(
      () => tui.output().slice(chooserOutputLength).includes("Sessions"),
      "the session chooser",
    );
    tui.terminal.write(input.encode("\x1b"));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("\x1b[113;17u"));
    await waitFor(() => tui.child.exitCode !== null, "Hyper+q to quit");
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);

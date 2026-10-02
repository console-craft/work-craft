import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RGBA } from "@opentui/core";
import {
  createClient,
  decodeBytes,
  type Snapshot,
  type WorkCraftClient,
} from "@work-craft/server/client";

import { defaultTheme } from "@/ui/themes/default.ts";

const ROOT = resolve(import.meta.dir, "../../..");

function foregroundSequence(color: string, background = color, opacity = 1): string {
  const foreground = RGBA.fromHex(color).toInts();
  const backdrop = RGBA.fromHex(background).toInts();
  const channels = foreground
    .slice(0, 3)
    .map((channel, index) => Math.floor(channel * opacity + backdrop[index]! * (1 - opacity)));
  return `38;2;${channels.join(";")}m`;
}

const CONNECTED_COLOR = foregroundSequence(defaultTheme.colors.success);
const DIMMED_CONNECTED_COLOR = foregroundSequence(
  defaultTheme.colors.success,
  defaultTheme.colors.background,
  0.5,
);
const CONNECTING_COLOR = foregroundSequence(defaultTheme.colors.warning);
const kitty = {
  hyper(keyCode: number): string {
    return `\x1b[${keyCode};15u`;
  },
};

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
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // The command and all of its children already exited.
    }
    await Promise.race([child.exited, Bun.sleep(500)]);
  }
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The command and all of its children exited after SIGTERM.
    }
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

async function waitForSnapshot(
  client: WorkCraftClient,
  predicate: (snapshot: Snapshot) => boolean,
  message: string,
): Promise<Snapshot> {
  const deadline = Date.now() + 3_000;
  let snapshot = await client.snapshot();
  while (!predicate(snapshot) && Date.now() < deadline) {
    await Bun.sleep(20);
    snapshot = await client.snapshot();
  }
  if (!predicate(snapshot)) {
    throw new Error(`Timed out waiting for ${message}`);
  }
  return snapshot;
}

function terminalText(snapshot: Snapshot, paneId: string): string {
  const data = snapshot.terminalHistories.find((history) => history.paneId === paneId)?.data ?? "";
  return new TextDecoder().decode(decodeBytes(data));
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
        tui.output().includes(DIMMED_CONNECTED_COLOR),
      "the empty session chooser",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);
    tui.terminal.write(new TextEncoder().encode("\r"));
    await waitFor(
      () => tui.output().includes("session name"),
      "the session prompt",
      () => `\n${tui.output()}`,
    );
    expect(tui.output()).toContain("session name");
    expect(tui.output()).toContain("HINTS");
    expect(tui.output()).toContain("Inbox");
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
        tui.output().includes(DIMMED_CONNECTED_COLOR),
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
    tui.terminal.write(new TextEncoder().encode(kitty.hyper(115)));
    await waitFor(
      () => {
        const update = tui.output().slice(outputLength);
        return update.includes("Sessions") && update.includes("New session");
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
    expect(tui.output()).toContain("HINTS");
    expect(tui.output()).toContain("Inbox");
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
        first.output().includes(DIMMED_CONNECTED_COLOR) &&
        second.output().includes("Session: choose") &&
        second.output().includes("Sessions") &&
        second.output().includes(DIMMED_CONNECTED_COLOR),
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
  const ensured = await client.command({ type: "surface.ensure", itemId: item.result.id });
  const secondTab = await client.command({
    type: "tab.create",
    surfaceId: ensured.result.surfaceId!,
    title: "Second",
  });
  const paneId = ensured.result.paneId!;
  let focusedPaneId = paneId;
  const firstTabId = ensured.result.tabId!;
  const tui = startTui(home);
  const input = new TextEncoder();

  try {
    await waitFor(
      () => tui.output().includes("Keys") && tui.output().includes(CONNECTED_COLOR),
      "the populated shell",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);

    tui.terminal.write(input.encode(kitty.hyper(104)));
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("Today"), "the next category");
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("Design"), "the design category");
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("Implementation"), "the project category");

    tui.terminal.write(input.encode("\r"));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("l"));
    await waitFor(() => tui.output().includes("Input Item"), "the expanded project");
    tui.terminal.write(input.encode("j"));
    await Bun.sleep(50);
    expect(tui.output()).not.toContain("Second");
    tui.terminal.write(input.encode("\r"));
    await waitFor(() => tui.output().includes("Second"), "item activation");
    await Bun.sleep(50);
    tui.terminal.write(input.encode("printf 'ENTER-%s\\n' \"$((3*7))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, secondTab.result.paneId!).includes("ENTER-21"),
      "item Enter handing input directly to its active pane",
    );

    tui.terminal.write(input.encode(kitty.hyper(93)));
    await Bun.sleep(100);
    expect(
      (await client.snapshot()).surfaces.find(({ id }) => id === ensured.result.surfaceId)
        ?.activeTabId,
    ).toBe(secondTab.result.tabId);
    tui.terminal.write(input.encode(kitty.hyper(91)));
    await waitForSnapshot(
      client,
      (snapshot) =>
        snapshot.surfaces.find(({ id }) => id === ensured.result.surfaceId)?.activeTabId ===
        firstTabId,
      "previous tab selection",
    );
    tui.terminal.write(input.encode(kitty.hyper(91)));
    await Bun.sleep(100);
    expect(
      (await client.snapshot()).surfaces.find(({ id }) => id === ensured.result.surfaceId)
        ?.activeTabId,
    ).toBe(firstTabId);

    tui.terminal.write(Uint8Array.of(10));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("printf 'WC-%s\\n' \"$((6*7))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("WC-42"),
      "printable terminal output",
    );

    tui.terminal.write(
      input.encode(
        "stty -icanon -echo; printf 'WC-%s\\n' TAB-READY; " +
          "b=$(dd bs=1 count=1 2>/dev/null | od -An -tx1); " +
          "stty sane; printf 'TAB-%s\\n' \"$b\"\r",
      ),
    );
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("WC-TAB-READY"),
      "raw tab reader",
    );
    tui.terminal.write(input.encode("\t"));
    // od pads differently on macOS and Linux; require exactly the child-read bytes.
    await waitForSnapshot(
      client,
      (snapshot) => /(?:^|\n)TAB-[ \t]+09[ \t]*\r?\n/.test(terminalText(snapshot, paneId)),
      "Tab byte reaching the child",
    );

    tui.terminal.write(
      input.encode(
        "stty -icanon -echo; printf 'WC-%s\\n' BACKTAB-READY; " +
          "b=$(dd bs=1 count=3 2>/dev/null | od -An -tx1); " +
          "stty sane; printf 'BACKTAB-%s\\n' \"$b\"\r",
      ),
    );
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("WC-BACKTAB-READY"),
      "raw backtab reader",
    );
    tui.terminal.write(input.encode("\x1b[Z"));
    await waitForSnapshot(
      client,
      (snapshot) =>
        /(?:^|\n)BACKTAB-[ \t]+1b[ \t]+5b[ \t]+5a[ \t]*\r?\n/.test(terminalText(snapshot, paneId)),
      "Shift+Tab bytes reaching the child",
    );

    const horizontalOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(0));
    await waitFor(
      () => tui.output().slice(horizontalOutputLength).includes("LEADER"),
      "horizontal split leader",
    );
    tui.terminal.write(input.encode("s"));
    await waitForSnapshot(client, (snapshot) => snapshot.panes.length === 3, "horizontal split");

    const verticalOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(0));
    await waitFor(
      () => tui.output().slice(verticalOutputLength).includes("LEADER"),
      "vertical split leader",
    );
    tui.terminal.write(input.encode("v"));
    const splitSnapshot = await waitForSnapshot(
      client,
      (snapshot) => snapshot.panes.length === 4,
      "vertical split",
    );
    const layout = splitSnapshot.tabs.find(({ id }) => id === firstTabId)?.layout;
    expect(JSON.stringify(layout)).toContain('"direction":"horizontal"');
    expect(JSON.stringify(layout)).toContain('"direction":"vertical"');

    tui.terminal.write(Uint8Array.of(8));
    await Bun.sleep(50);
    const reloadOutputLength = tui.output().length;
    tui.terminal.write(input.encode(kitty.hyper(114)));
    await waitFor(
      () => {
        const update = tui.output().slice(reloadOutputLength);
        return update.includes(CONNECTING_COLOR) && update.includes(CONNECTED_COLOR);
      },
      "reload to reconnect",
      () => `\n${tui.output().slice(reloadOutputLength)}`,
    );
    tui.terminal.write(Uint8Array.of(12));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("printf 'REL-%s\\n' \"$((5*5))\"\r"));
    const reloadedSnapshot = await waitForSnapshot(
      client,
      (snapshot) => snapshot.panes.some(({ id }) => terminalText(snapshot, id).includes("REL-25")),
      "terminal output after reload",
    );
    focusedPaneId = reloadedSnapshot.panes.find(({ id }) =>
      terminalText(reloadedSnapshot, id).includes("REL-25"),
    )!.id;

    const hideOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(0));
    await waitFor(() => tui.output().slice(hideOutputLength).includes("LEADER"), "hide leader");
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
    tui.terminal.write(input.encode(kitty.hyper(115)));
    await waitFor(() => {
      const update = tui.output().slice(chooserOutputLength);
      return update.includes("Sessions") && tui.output().includes("HINTS");
    }, "the session chooser");
    tui.terminal.write(input.encode("\x1b"));
    await Bun.sleep(50);

    tui.terminal.write(input.encode("_wc_missing_command_\r"));
    await Bun.sleep(100);
    tui.terminal.write(input.encode("printf 'ERR-%s\\n' \"$((9*9))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, focusedPaneId).includes("ERR-81"),
      "shell recovery after command error",
    );

    tui.terminal.write(input.encode("sleep 10\r"));
    await Bun.sleep(100);
    tui.terminal.write(Uint8Array.of(3));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("printf 'INT-%s\\n' \"$((7*7))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, focusedPaneId).includes("INT-49"),
      "terminal after Ctrl-C",
    );
    expect(tui.child.exitCode).toBeNull();

    const cursorBeforeEscape = (await client.snapshot()).terminalHistories.find(
      ({ paneId: id }) => id === focusedPaneId,
    )?.cursor;
    tui.terminal.write(input.encode("\x1b"));
    await Bun.sleep(20);
    tui.terminal.write(input.encode("\r"));
    const finalSnapshot = await waitForSnapshot(
      client,
      (snapshot) =>
        (snapshot.terminalHistories.find(({ paneId: id }) => id === focusedPaneId)?.cursor ?? 0) >
        (cursorBeforeEscape ?? 0),
      "Escape terminal prompt",
    );
    expect(terminalText(finalSnapshot, paneId)).toContain("WC-42");
    expect(terminalText(finalSnapshot, focusedPaneId)).toContain("REL-25");

    tui.terminal.write(input.encode(kitty.hyper(113)));
    await waitFor(() => tui.child.exitCode !== null, "Hyper+q to quit");
    expect((await client.health()).epoch).toBeTruthy();
    expect((await client.snapshot()).panes.find(({ id }) => id === paneId)?.processStatus).toBe(
      "running",
    );
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20_000);

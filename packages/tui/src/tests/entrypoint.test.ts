import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RGBA } from "@opentui/core";
import {
  createClient,
  decodeBytes,
  type Snapshot,
  type WorkCraftClient,
} from "@work-craft/server/client";

import { calculateShellLayout } from "@/shell/layout.ts";
import { defaultTheme } from "@/ui/theming/themes/default.ts";
import { type PaneRect, projectPaneLayout, terminalRect } from "@/workbench/layout.ts";

const ROOT = resolve(import.meta.dir, "../../../..");

function foregroundSequence(color: string, background = color, opacity = 1): string {
  const foreground = RGBA.fromHex(color).toInts();
  const backdrop = RGBA.fromHex(background).toInts();
  const channels = foreground
    .slice(0, 3)
    .map((channel, index) => Math.round(channel * opacity + backdrop[index]! * (1 - opacity)));
  return `38;2;${channels.join(";")}m`;
}

const CONNECTED_COLOR = foregroundSequence(defaultTheme.colors.success);
const DIMMED_CONNECTED_COLOR = foregroundSequence(defaultTheme.colors.success, "#000000", 0.35);
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

function startTui(
  home: string,
  env: Record<string, string> = {},
): {
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
    env: { ...process.env, WORK_CRAFT_HOME: home, ...env },
    terminal,
  });
  return { child, output: () => output, terminal };
}

function waitForTerminalInput(
  tui: ReturnType<typeof startTui>,
  message: string,
  outputLength = 0,
  bounds?: PaneRect,
): Promise<void> {
  return waitFor(
    () => {
      const output = tui.output().slice(outputLength);
      // Inputs also display the cursor; callers must await dialog closure separately.
      const shown = output.lastIndexOf("\x1b[?25h");
      const position = new RegExp(`${String.fromCharCode(27)}\\[(\\d+);(\\d+)H`, "g");
      const positions = [...output.slice(0, shown).matchAll(position)];
      const row = Number(positions.at(-1)?.[1]) - 1;
      const column = Number(positions.at(-1)?.[2]) - 1;
      return (
        tui.child.exitCode === null &&
        shown > output.lastIndexOf("\x1b[?25l") &&
        (!bounds ||
          (column >= bounds.x &&
            column < bounds.x + bounds.width &&
            row >= bounds.y &&
            row < bounds.y + bounds.height))
      );
    },
    message,
    () => `\n${tui.output()}`,
  );
}

async function waitForSnapshot(
  client: WorkCraftClient,
  predicate: (snapshot: Snapshot) => boolean,
  message: string,
  details: (snapshot: Snapshot) => string = () => "",
): Promise<Snapshot> {
  const deadline = Date.now() + 3_000;
  let snapshot = await client.snapshot();
  while (!predicate(snapshot) && Date.now() < deadline) {
    await Bun.sleep(20);
    snapshot = await client.snapshot();
  }
  if (!predicate(snapshot)) {
    throw new Error(`Timed out waiting for ${message}${details(snapshot)}`);
  }
  return snapshot;
}

function terminalText(snapshot: Snapshot, paneId: string): string {
  const data = snapshot.terminalHistories.find((history) => history.paneId === paneId)?.data ?? "";
  return new TextDecoder().decode(decodeBytes(data));
}

test("normal TUI creation and duplicate linked registration enter the same PTY", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-create-pty-")));
  const root = join(home, "repository");
  const linked = join(home, "linked");
  await mkdir(root);
  for (const args of [
    ["init", "--initial-branch=trunk"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ],
    ["worktree", "add", "-b", "feature", linked],
  ]) {
    const result = Bun.spawnSync(["git", "-C", root, ...args]);
    expect(result.exitCode).toBe(0);
  }
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Coding" });
  await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workspace",
  });
  const tui = startTui(home);
  const input = new TextEncoder();
  try {
    await waitFor(
      () => tui.output().includes("Workspace") && tui.output().includes(CONNECTED_COLOR),
      "connected creation shell",
    );
    tui.terminal.write(input.encode("\rjjj\rn"));
    await waitFor(() => tui.output().includes("Existing directory path"), "directory form");
    const creationOutput = tui.output().length;
    tui.terminal.write(input.encode(`${linked}\r`));
    const opened = await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces.length === 1,
      "creation to ensure requested linked surface",
    );
    const child = opened.items.find((item) => item.kind === "worktree")!;
    expect(opened.surfaces[0]!.itemId).toBe(child.id);
    const pane = opened.panes[0]!;
    await waitForWorkbenchInput(creationOutput);
    tui.terminal.write(input.encode("printf 'CREATED-%s-%s\\n' sentinel \"$PWD\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, pane.id).includes(`CREATED-sentinel-${linked}`),
      "creation sentinel reaches linked PTY",
    );
    // Native Ctrl+h leaves the terminal for navigation; n opens the same registration form.
    const duplicateOutput = tui.output().length;
    tui.terminal.write(input.encode("\x1b[104;5un"));
    await waitFor(
      () => tui.output().slice(duplicateOutput).includes("Existing directory path"),
      "duplicate directory form",
    );
    const duplicateSubmitOutput = tui.output().length;
    tui.terminal.write(input.encode(`${linked}\r`));
    await waitForWorkbenchInput(duplicateSubmitOutput);
    tui.terminal.write(input.encode("printf 'DUPLICATE-%s\\n' sentinel\r"));
    const final = await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, pane.id).includes("DUPLICATE-sentinel"),
      "duplicate sentinel reaches original PTY",
    );
    expect(final.items).toHaveLength(2);
    expect(final.items.filter((item) => item.parentId === null)).toHaveLength(1);
    expect(final.surfaces).toEqual(opened.surfaces);
    expect(final.tabs).toEqual(opened.tabs);
    expect(final.panes).toHaveLength(1);
    expect(final.panes[0]!.id).toBe(pane.id);
    expect(final.panes[0]!.startedAt).toBe(pane.startedAt);
    expect(terminalText(final, pane.id)).toContain(`CREATED-sentinel-${linked}`);
    async function waitForWorkbenchInput(outputLength: number): Promise<void> {
      await waitFor(
        () => tui.output().slice(outputLength).includes(CONNECTED_COLOR),
        "undimmed header after creation form closes",
        () => tui.output().slice(-4000),
      );
      await waitForTerminalInput(tui, "workbench cursor after creation form closes", outputLength, {
        x: 51,
        y: 6,
        width: 68,
        height: 33,
      });
    }
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("normal entrypoint ignores input after shell exit and explicitly restarts the same pane", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-exit-pty-")));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  const shell = join(home, "shell");
  const starts = join(home, "shell-starts");
  await writeFile(shell, `#!/bin/sh\nprintf '%s\\n' "$$" >> '${starts}'\nexec /bin/sh\n`, {
    mode: 0o755,
  });
  await startDaemon(client, home, shell);
  const session = await client.command({ type: "session.create", name: "Exit" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workbench",
  });
  const item = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "inbox",
    title: "Exit work",
  });
  const opened = await client.command({ type: "surface.ensure", itemId: item.result.id });
  const paneId = opened.result.paneId!;
  const sibling = await client.command({
    type: "pane.split",
    paneId,
    direction: "vertical",
    cwd: home,
  });
  const siblingBefore = (await client.snapshot()).panes.find(
    ({ id }) => id === sibling.result.paneId,
  );
  const tui = startTui(home);
  const input = new TextEncoder();
  try {
    await waitFor(
      () => tui.output().includes("Workbench") && tui.output().includes(CONNECTED_COLOR),
      "connected exit shell",
    );
    tui.terminal.write(input.encode("\r\r"));
    await waitFor(() => tui.output().includes("Exit work"), "exit work navigator");
    tui.terminal.write(input.encode("\r"));
    await waitForTerminalInput(tui, "exit pane entry");
    tui.terminal.write(input.encode("printf 'STDERR-%s\\n' ordinary >&2\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("STDERR-ordinary"),
      "ordinary stderr",
    );
    const exitOutput = tui.output().length;
    tui.terminal.write(input.encode("exit\r"));
    const stopped = await waitForSnapshot(
      client,
      (snapshot) => snapshot.panes.find(({ id }) => id === paneId)?.processStatus === "exited",
      "shell exit",
    );
    await waitFor(
      () => tui.output().slice(exitOutput).includes("Reactivate"),
      "exited bottom Alert action",
    );
    const exitFrame = tui.output().slice(exitOutput);
    tui.terminal.write(input.encode("ignored-text\x1b[200~ignored-paste\x1b[201~"));
    // A handled strip key supplies a rendered barrier after ignored typing/paste.
    tui.terminal.write(input.encode("\x1b[H"));
    await waitFor(() => tui.output().slice(exitOutput).includes("Enter terminal"), "strip focus");
    const ignored = await client.snapshot();
    expect(ignored.panes).toEqual(stopped.panes);
    expect(ignored.terminalHistories).toEqual(stopped.terminalHistories);
    expect(tui.output().slice(exitOutput)).not.toContain("Process failed");
    const restartOutput = tui.output().length;
    const action = calculateShellLayout({
      terminalWidth: 120,
      terminalHeight: 40,
      navigatorOpen: true,
      preferredNavigatorWidth: 45,
      paneLayout: stopped.tabs[0]!.layout,
      panes: stopped.panes,
    }).focusNodes.find(
      ({ target }) =>
        target.region === "workbench" &&
        target.paneId === paneId &&
        target.control === "reactivate",
    )!.rect;
    const pointer = `${action.x + 2};${action.y + 1}`;
    tui.terminal.write(input.encode(`\x1b[<0;${pointer}M`));
    await waitFor(
      () => tui.output().slice(restartOutput).includes("Reactivate"),
      "Reactivate pointer focus before release",
      () => tui.output().slice(restartOutput),
    );
    expect((await client.snapshot()).panes).toEqual(stopped.panes);
    tui.terminal.write(input.encode(`\x1b[<0;${pointer}m`));
    await waitForSnapshot(
      client,
      (snapshot) => snapshot.panes.find(({ id }) => id === paneId)?.processStatus === "running",
      "explicit restart",
    );
    await waitForTerminalInput(tui, "explicit restart terminal entry", restartOutput);
    tui.terminal.write(input.encode("printf 'RESTART-%s\\n' sentinel\r"));
    const final = await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("RESTART-sentinel"),
      "restart sentinel",
    );
    expect(final.panes).toHaveLength(2);
    expect(final.panes.find(({ id }) => id === paneId)?.processStatus).toBe("running");
    expect(final.panes.find(({ id }) => id === sibling.result.paneId)).toEqual(siblingBefore);
    expect((await readFile(starts, "utf8")).trim().split("\n")).toHaveLength(3);
    expect(final.surfaces).toEqual(stopped.surfaces);
    expect(terminalText(final, paneId)).toContain("STDERR-ordinary");
    expect(terminalText(final, paneId)).not.toContain("ignored-text");
    expect(terminalText(final, paneId)).not.toContain("ignored-paste");
    expect(exitFrame).toContain("exited");
    expect(exitFrame.lastIndexOf("\x1b[?25l")).toBeGreaterThan(exitFrame.lastIndexOf("\x1b[?25h"));
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("normal entrypoint failed spawn reports once while typing cannot restart it", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-failed-pty-")));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home, join(home, "missing-shell"));
  const session = await client.command({ type: "session.create", name: "Failed" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workbench",
  });
  const item = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "inbox",
    title: "Failed work",
  });
  await client.command({ type: "surface.ensure", itemId: item.result.id });
  const tui = startTui(home);
  try {
    await waitFor(() => tui.output().includes(CONNECTED_COLOR), "connected failed shell");
    tui.terminal.write(new TextEncoder().encode("\r\r\r"));
    await waitFor(() => tui.output().includes("failed"), "failed process status");
    const before = await client.snapshot();
    tui.terminal.write(new TextEncoder().encode("ignored-text\x1b[200~ignored-paste\x1b[201~"));
    await Bun.sleep(150);
    expect((await client.snapshot()).panes).toEqual(before.panes);
    expect(before.panes[0]!.processStatus).toBe("failed");
    expect(tui.child.exitCode).toBeNull();
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("normal entrypoint Hyper tab switching and creation send sentinels only to the intended PTYs", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-tabs-pty-")));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Tabs" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workbench",
  });
  const item = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "inbox",
    title: "Tab work",
  });
  const first = await client.command({ type: "surface.ensure", itemId: item.result.id });
  const second = await client.command({
    type: "tab.create",
    surfaceId: first.result.surfaceId!,
    title: "Second",
  });
  await client.command({
    type: "surface.selectTab",
    surfaceId: first.result.surfaceId!,
    tabId: first.result.tabId!,
  });
  const before = await client.snapshot();
  const tui = startTui(home);
  const input = new TextEncoder();
  try {
    await waitFor(
      () => tui.output().includes("Workbench") && tui.output().includes(CONNECTED_COLOR),
      "connected tabs shell",
    );
    tui.terminal.write(input.encode("\r\r"));
    await waitFor(() => tui.output().includes("Tab work"), "tab work navigator");
    tui.terminal.write(input.encode("\r"));
    await waitForTerminalInput(tui, "first terminal entry");
    tui.terminal.write(input.encode("printf 'SOURCE-%s\\n' sentinel\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, first.result.paneId!).includes("SOURCE-sentinel"),
      "source sentinel",
    );
    const nextOutput = tui.output().length;
    tui.terminal.write(input.encode(kitty.hyper(93)));
    await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces[0]?.activeTabId === second.result.tabId,
      "second tab selected",
    );
    await waitFor(
      () => tui.output().slice(nextOutput).includes("Second"),
      "second tab rendered outside tab-strip focus",
      () => tui.output().slice(nextOutput),
    );
    await waitForTerminalInput(tui, "second terminal entry", nextOutput);
    tui.terminal.write(input.encode("printf 'DESTINATION-%s\\n' sentinel\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, second.result.paneId!).includes("DESTINATION-sentinel"),
      "destination sentinel without spatial refocus",
      (snapshot) =>
        `\nSource: ${terminalText(snapshot, first.result.paneId!)}\nDestination: ${terminalText(snapshot, second.result.paneId!)}\nTUI: ${tui.output().slice(nextOutput)}`,
    );
    const previousOutput = tui.output().length;
    tui.terminal.write(input.encode(kitty.hyper(91)));
    await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces[0]?.activeTabId === first.result.tabId,
      "first tab selected again",
    );
    await waitFor(
      () => tui.output().slice(previousOutput).includes("Main"),
      "first tab rendered outside tab-strip focus",
      () => tui.output().slice(previousOutput),
    );
    await waitForTerminalInput(tui, "return terminal entry", previousOutput);
    tui.terminal.write(input.encode("printf 'RETURN-%s\\n' sentinel\r"));
    const final = await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, first.result.paneId!).includes("RETURN-sentinel"),
      "return sentinel without spatial refocus",
      (snapshot) =>
        `\nSource: ${terminalText(snapshot, first.result.paneId!)}\nDestination: ${terminalText(snapshot, second.result.paneId!)}\nTUI: ${tui.output().slice(previousOutput)}`,
    );
    expect(final.panes.map(({ id, startedAt }) => ({ id, startedAt }))).toEqual(
      before.panes.map(({ id, startedAt }) => ({ id, startedAt })),
    );
    expect(final.surfaces).toEqual(before.surfaces);
    expect(final.tabs).toEqual(before.tabs);
    expect(terminalText(final, first.result.paneId!)).not.toContain("DESTINATION-sentinel");
    expect(terminalText(final, second.result.paneId!)).not.toContain("SOURCE-sentinel");
    expect(terminalText(final, second.result.paneId!)).not.toContain("RETURN-sentinel");

    // Ctrl+k moves from the terminal to the native two-row strip.
    const stripOutput = tui.output().length;
    tui.terminal.write(input.encode("\x1b[107;5u"));
    await waitFor(() => tui.output().slice(stripOutput).includes("Enter terminal"), "strip entry");
    const browseOutput = tui.output().length;
    tui.terminal.write(input.encode("\x1b[C"));
    await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces[0]?.activeTabId === second.result.tabId,
      "local browsing selects without confirmation",
    );
    await waitFor(
      () => tui.output().slice(browseOutput).includes("DESTINATION-"),
      "browsing renders selected tab output",
      () => tui.output().slice(browseOutput),
    );
    expect(tui.output().lastIndexOf("\x1b[?25l")).toBeGreaterThan(
      tui.output().lastIndexOf("\x1b[?25h"),
    );

    // Control-source Hyper must preserve strip focus, unlike the terminal-source path above.
    const hyperOutput = tui.output().length;
    tui.terminal.write(input.encode(kitty.hyper(91)));
    await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces[0]?.activeTabId === first.result.tabId,
      "strip-source Hyper selection",
    );
    await waitFor(() => tui.output().slice(hyperOutput).includes("SOURCE-"), "source view");
    expect(tui.output().lastIndexOf("\x1b[?25l")).toBeGreaterThan(
      tui.output().lastIndexOf("\x1b[?25h"),
    );

    const daemonPid = (await client.health()).pid;
    for (const [index, gesture] of [
      "\x1b[C\r",
      // Fixed 120x40 fixture: Main stretches across the left half of the strip on row 4.
      "\x1b[<0;53;4M\x1b[<0;53;4m",
    ].entries()) {
      const entryOutput = tui.output().length;
      process.kill(daemonPid, "SIGSTOP");
      try {
        tui.terminal.write(input.encode(gesture));
        await waitFor(
          () =>
            tui
              .output()
              .slice(entryOutput)
              .includes(index === 0 ? "Second" : "Main"),
          "local candidate while daemon selection is delayed",
        );
        expect(tui.output().slice(entryOutput)).not.toContain("\x1b[?25h");
      } finally {
        process.kill(daemonPid, "SIGCONT");
      }
      const paneId = index === 0 ? second.result.paneId! : first.result.paneId!;
      await waitForTerminalInput(tui, "delayed tab activation native readiness", entryOutput);
      tui.terminal.write(input.encode(`printf 'LOCAL-${index}-%s\\n' sentinel\r`));
      await waitForSnapshot(
        client,
        (snapshot) => terminalText(snapshot, paneId).includes(`LOCAL-${index}-sentinel`),
        "local activation input reaches requested PTY",
      );
      if (index === 0) {
        const refocusOutput = tui.output().length;
        tui.terminal.write(input.encode("\x1b[107;5u"));
        await waitFor(
          () => tui.output().slice(refocusOutput).includes("Enter terminal"),
          "strip before mouse activation",
        );
      }
    }
    const accepted = await client.snapshot();
    expect(terminalText(accepted, first.result.paneId!)).not.toContain("LOCAL-0-sentinel");
    expect(terminalText(accepted, second.result.paneId!)).not.toContain("LOCAL-1-sentinel");

    const createdPanes: string[] = [];
    for (const [index, origin] of ["terminal", "control"].entries()) {
      if (origin === "control") {
        const stripStart = tui.output().length;
        tui.terminal.write(input.encode("\x1b[107;5u"));
        await waitFor(
          () => tui.output().slice(stripStart).includes("Enter terminal"),
          "strip before creation",
        );
      }
      const createOutput = tui.output().length;
      tui.terminal.write(input.encode(kitty.hyper(110)));
      const created = await waitForSnapshot(
        client,
        (snapshot) => snapshot.tabs.length === 3 + index,
        "Hyper+n creates one tab",
      );
      const tab = created.tabs.find((tab) => tab.id === created.surfaces[0]?.activeTabId)!;
      const paneId = created.panes.find(
        (pane) =>
          !accepted.panes.some(({ id }) => id === pane.id) && !createdPanes.includes(pane.id),
      )!.id;
      expect(tab.layout).toEqual({ type: "pane", paneId });
      await waitFor(
        () => tui.output().slice(createOutput).includes(tab.title),
        `Hyper+n from ${origin} created tab rendered`,
        () => tui.output().slice(createOutput),
      );
      const renderedOutput = tui.output().lastIndexOf(tab.title) + tab.title.length;
      await waitForTerminalInput(tui, `Hyper+n from ${origin} native readiness`, renderedOutput);
      tui.terminal.write(input.encode(`printf 'CREATE-${index}-%s\\n' sentinel\r`));
      const delivered = await waitForSnapshot(
        client,
        (snapshot) => terminalText(snapshot, paneId).includes(`CREATE-${index}-sentinel`),
        `Hyper+n from ${origin} sentinel without refocus`,
        (snapshot) => {
          const panes = snapshot.panes.map(
            ({ id, processStatus }) => `${id} (${processStatus}): ${terminalText(snapshot, id)}`,
          );
          return `\nTarget: ${paneId}\n${panes.join("\n")}\nTUI: ${tui.output().slice(createOutput)}`;
        },
      );
      for (const other of delivered.panes.filter((pane) => pane.id !== paneId)) {
        expect(terminalText(delivered, other.id)).not.toContain(`CREATE-${index}-sentinel`);
      }
      createdPanes.push(paneId);
    }
    expect((await client.health()).pid).toBe(daemonPid);
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("normal entrypoint split keys inherit live pwd, equalize mixed trees and preserve shell PIDs", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-splits-pty-")));
  const target = join(home, "live cwd 雪");
  await mkdir(target);
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Splits" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workbench",
  });
  const item = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "inbox",
    title: "Split work",
  });
  const opened = await client.command({
    type: "surface.ensure",
    itemId: item.result.id,
    cwd: home,
  });
  const tui = startTui(home);
  const input = new TextEncoder();
  const paneIds = [opened.result.paneId!];
  const pids = new Map<string, string>();
  try {
    await waitFor(() => tui.output().includes(CONNECTED_COLOR), "connected split shell");
    tui.terminal.write(input.encode("\r\r"));
    await waitFor(() => tui.output().includes("Split work"), "split navigator");
    tui.terminal.write(input.encode("\r"));
    await waitForTerminalInput(tui, "source split input");
    tui.terminal.write(input.encode(`cd '${target}'; printf 'SOURCE-PID-%s\\n' "$$"\r`));
    const source = await waitForSnapshot(
      client,
      (snapshot) => /SOURCE-PID-\d+/.test(terminalText(snapshot, paneIds[0]!)),
      "source cd and PID sentinel",
    );
    pids.set(paneIds[0]!, terminalText(source, paneIds[0]!).match(/SOURCE-PID-(\d+)/)![1]!);

    for (const [index, key] of ["v", "v", "s"].entries()) {
      const splitOutput = tui.output().length;
      tui.terminal.write(input.encode(`\x00${key}`));
      const split = await waitForSnapshot(
        client,
        (snapshot) => snapshot.panes.length === paneIds.length + 1,
        `app split ${key}`,
      );
      const pane = split.panes.find(({ id }) => !paneIds.includes(id))!;
      paneIds.push(pane.id);
      const shell = calculateShellLayout({
        terminalWidth: 120,
        terminalHeight: 40,
        navigatorOpen: true,
        preferredNavigatorWidth: 45,
        paneLayout: split.tabs[0]!.layout,
      });
      const geometry = projectPaneLayout(split.tabs[0]!.layout!, shell.workbenchContent);
      const bounds = geometry.panes.find(({ paneId }) => paneId === pane.id)!.rect;
      const borderPosition = `\x1b[${bounds.y + 1};${bounds.x + 1}H`;
      await waitFor(
        () => tui.output().slice(splitOutput).includes(borderPosition),
        "new pane top border rendered before accepting its cursor",
      );
      // Pre-split source output can have a cursor inside the future destination rectangle.
      const renderedSplit = splitOutput + tui.output().slice(splitOutput).indexOf(borderPosition);
      await waitForTerminalInput(
        tui,
        `split ${index} native input`,
        renderedSplit,
        terminalRect(bounds, false),
      );
      tui.terminal.write(input.encode(`printf 'NEW-${index}-%s-PID-%s\\n' "$(pwd)" "$$"\r`));
      const ready = await waitForSnapshot(
        client,
        (snapshot) => terminalText(snapshot, pane.id).includes(`NEW-${index}-${target}-PID-`),
        `split ${index} actual new-shell pwd`,
        (snapshot) => `\n${terminalText(snapshot, pane.id)}\n${tui.output().slice(splitOutput)}`,
      );
      const pid = terminalText(ready, pane.id).match(/-PID-(\d+)/)![1]!;
      pids.set(pane.id, pid);
      expect(pane.cwd).toBe(target);
      if (index === 1) {
        expect(split.tabs[0]!.layout).toEqual({
          type: "split",
          direction: "vertical",
          ratio: 1 / 3,
          first: { type: "pane", paneId: paneIds[0]! },
          second: {
            type: "split",
            direction: "vertical",
            ratio: 0.5,
            first: { type: "pane", paneId: paneIds[1]! },
            second: { type: "pane", paneId: paneIds[2]! },
          },
        });
      }
    }
    const mixed = await client.snapshot();
    expect(mixed.tabs[0]!.layout).toEqual({
      type: "split",
      direction: "vertical",
      ratio: 1 / 3,
      first: { type: "pane", paneId: paneIds[0]! },
      second: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "pane", paneId: paneIds[1]! },
        second: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "pane", paneId: paneIds[2]! },
          second: { type: "pane", paneId: paneIds[3]! },
        },
      },
    });
    // A fourth column is below 20 cells here, but the app key must still create it.
    const tinyOutput = tui.output().length;
    tui.terminal.write(input.encode("\x00v"));
    const tiny = await waitForSnapshot(
      client,
      (snapshot) => snapshot.panes.length === 5,
      "tiny split",
    );
    expect(tiny.panes.find(({ id }) => !paneIds.includes(id))?.cwd).toBe(target);
    await waitFor(
      () => {
        const output = tui.output().slice(tinyOutput);
        return (
          output.includes("\x1b[?2026l") &&
          output.lastIndexOf("\x1b[?25l") > output.lastIndexOf("\x1b[?25h")
        );
      },
      "undersized split renders without native PTY focus",
      () => tui.output().slice(tinyOutput),
    );
    expect(tui.output().lastIndexOf("\x1b[?25l")).toBeGreaterThan(
      tui.output().lastIndexOf("\x1b[?25h"),
    );
    // Direct stream probes inspect old shells, not app focus/input eligibility in tiny panes.
    const stream = await client.stream({ onMessage() {} });
    try {
      for (const [paneId, pid] of pids) {
        stream.sendInput(paneId, input.encode("printf 'RETAINED-PID-%s\\n' \"$$\"\n"));
        const retained = await waitForSnapshot(
          client,
          (snapshot) => terminalText(snapshot, paneId).includes(`RETAINED-PID-${pid}`),
          "original shell PID survives equalization",
        );
        expect(terminalText(retained, paneId)).toContain(
          paneId === paneIds[0]
            ? `SOURCE-PID-${pid}`
            : `NEW-${paneIds.indexOf(paneId) - 1}-${target}-PID-${pid}`,
        );
      }
    } finally {
      stream.close();
    }
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("normal Coding entry filters external worktrees and retains its runtime through drawer and guard resizes", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-coding-pty-")));
  const root = join(home, "repository");
  const external = join(home, "external");
  await mkdir(root);
  function git(...args: string[]): void {
    const result = Bun.spawnSync(["git", "-C", root, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
    if (!result.success) {
      throw new Error(result.stderr.toString());
    }
  }
  git("init", "--initial-branch=trunk");
  git("commit", "--allow-empty", "-m", "initial");
  git("worktree", "add", "-b", "feature", external);
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  await startDaemon(client, home);
  const session = await client.command({ type: "session.create", name: "Coding" });
  const workspace = await client.command({
    type: "workspace.create",
    sessionId: session.result.id,
    name: "Workspace",
  });
  await client.command({
    type: "directory.register",
    workspaceId: workspace.result.id,
    path: root,
  });
  const childId = (await client.snapshot()).items.find((item) => item.kind === "worktree")!.id;
  const tui = startTui(home);
  const input = new TextEncoder();
  try {
    await waitFor(
      () => tui.output().includes("Workspace") && tui.output().includes(CONNECTED_COLOR),
      "connected Coding shell",
      () => tui.output().slice(-3000),
    );
    tui.terminal.write(input.encode("\rjjj\r"));
    await waitFor(() => tui.output().includes("repository"), "Coding results");
    tui.terminal.write(input.encode("\x1b[Zfeature\x0e\r"));
    await waitFor(() => tui.output().includes("external"), "filtered external worktree");
    expect((await client.snapshot()).surfaces).toHaveLength(0);
    const outputLength = tui.output().length;
    tui.terminal.write(input.encode("\r"));
    const opened = await waitForSnapshot(
      client,
      (snapshot) => snapshot.surfaces.some((surface) => surface.itemId === childId),
      "worktree surface",
    );
    const paneId = opened.panes[0]!.id;
    await waitForTerminalInput(tui, "worktree terminal readiness", outputLength);
    tui.terminal.write(input.encode("printf 'CWD-%s\\n' \"$PWD\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes(`CWD-${external}`),
      "registered worktree pwd",
    );
    const startedAt = (await client.snapshot()).panes[0]!.startedAt;
    function resize(width: number): void {
      tui.terminal.resize(width, 40);
      // The Bun script wrapper is not a terminal emulator forwarding SIGWINCH.
      process.kill(-tui.child.pid, "SIGWINCH");
    }
    for (const width of [119, 80, 79]) {
      resize(width);
    }
    await waitFor(
      () => tui.output().includes("Please resize your terminal"),
      "resize guard",
      () => tui.output().slice(-6000),
    );
    tui.terminal.write(input.encode("printf 'BLOCKED-GUARD\\n'\r"));
    const recoveryOutput = tui.output().length;
    resize(80);
    await waitForTerminalInput(tui, "guard recovery terminal", recoveryOutput);
    const drawerOutput = tui.output().length;
    tui.terminal.write(input.encode("\x00b"));
    await waitFor(
      () =>
        tui.output().slice(drawerOutput).includes("feature") &&
        tui.output().lastIndexOf("\x1b[?25l") > tui.output().lastIndexOf("\x1b[?25h"),
      "opened drawer results",
    );
    const entryOutput = tui.output().length;
    tui.terminal.write(input.encode("\r"));
    await waitForTerminalInput(tui, "drawer terminal entry", entryOutput);
    resize(120);
    tui.terminal.write(input.encode("printf 'AFTER-%s\\n' 42\r"));
    const final = await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("AFTER-42"),
      "post-resize input",
    );
    expect(final.panes[0]!.id).toBe(paneId);
    expect(final.panes[0]!.startedAt).toBe(startedAt);
    expect(terminalText(final, paneId)).not.toContain("BLOCKED-GUARD");
  } finally {
    await stopProcessGroup(tui.child);
    tui.terminal.close();
    await stopDaemon(client, socketPath);
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

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

async function startDaemon(
  client: WorkCraftClient,
  home: string,
  shell = "/bin/sh",
): Promise<void> {
  const previousHome = process.env.WORK_CRAFT_HOME;
  const previousShell = process.env.SHELL;
  process.env.WORK_CRAFT_HOME = home;
  // Personal shell startup prompts must not consume PTY test input.
  process.env.SHELL = shell;
  try {
    await client.ensureDaemon({ recover: false });
  } finally {
    if (previousHome === undefined) {
      delete process.env.WORK_CRAFT_HOME;
    } else {
      process.env.WORK_CRAFT_HOME = previousHome;
    }
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
  }
}

test("TUI reports asynchronous output failure with a nonzero exit", async () => {
  const script = `
    setTimeout(() => process.stdout.emit("error", new Error("test-output-failed")), 500);
    await import(${JSON.stringify(join(ROOT, "packages/tui/src/main.tsx"))});
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, CONTROLS_DEMO: "true", COMPONENTS_DEMO: "false" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(output).toContain("BUTTONS");
    expect(code).not.toBe(0);
    expect(errors).toContain("test-output-failed");
  } finally {
    await stopProcessGroup(child);
  }
});

for (const { kind, tabs, placeholder } of [
  { kind: "input", tabs: 4, placeholder: "Name" },
  { kind: "textarea", tabs: 6, placeholder: "Bio" },
]) {
  test(`demo Ctrl+C clears the focused ${kind} before a second press exits`, async () => {
    const tui = startTui("", { CONTROLS_DEMO: "true", COMPONENTS_DEMO: "false" });
    const input = new TextEncoder();
    try {
      await waitFor(() => tui.output().includes("BUTTONS"), "the controls demo");
      const focusOutputLength = tui.output().length;
      tui.terminal.write(input.encode("\t".repeat(tabs)));
      await waitForTerminalInput(tui, `the demo ${kind} to receive focus`, focusOutputLength);
      const typingOutputLength = tui.output().length;
      tui.terminal.write(input.encode("clear-me"));
      await waitFor(
        () => tui.output().slice(typingOutputLength).includes("clear-me"),
        `text in the demo ${kind}`,
      );
      const clearingOutputLength = tui.output().length;
      tui.terminal.write(Uint8Array.of(3));
      await waitFor(
        () => tui.output().slice(clearingOutputLength).includes(placeholder),
        `Ctrl+C to clear the demo ${kind}`,
      );
      expect(tui.child.exitCode).toBeNull();
      tui.terminal.write(Uint8Array.of(3));
      await waitFor(() => tui.child.exitCode !== null, "Ctrl+C on the empty control to exit");
      expect(tui.child.exitCode).toBe(0);
    } finally {
      await stopProcessGroup(tui.child);
      tui.terminal.close();
    }
  });
}

test("an empty installation offers session creation from the chooser", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  const client = createClient({ socketPath });
  const tui = startTui(home);

  try {
    await waitFor(
      () =>
        tui.output().includes("No sessions") &&
        tui.output().includes("New session") &&
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
    expect(tui.output()).toContain("INBOX");
    const typingOutputLength = tui.output().length;
    tui.terminal.write(new TextEncoder().encode("draft"));
    await waitFor(
      () => tui.output().slice(typingOutputLength).includes("draft"),
      "text in the session prompt",
    );
    const clearingOutputLength = tui.output().length;
    tui.terminal.write(Uint8Array.of(3));
    await waitFor(
      () => tui.output().slice(clearingOutputLength).includes("session name"),
      "Ctrl+C to clear the session prompt",
    );
    tui.terminal.write(Uint8Array.of(3));
    await Bun.sleep(100);
    expect(tui.child.exitCode).toBeNull();
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
        tui.output().includes("Select session...") &&
        tui.output().includes("Sessions") &&
        tui.output().includes(DIMMED_CONNECTED_COLOR),
      "the initial session chooser",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);
    const selectionOutputLength = tui.output().length;
    tui.terminal.write(new TextEncoder().encode("First\r"));
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
    tui.terminal.write(new TextEncoder().encode("n"));
    await waitFor(() => tui.output().includes("workspace name"), "the workspace prompt");
    expect(tui.output()).toContain("HINTS");
    expect(tui.output()).toContain("INBOX");
    const outputLength = tui.output().length;
    await client.command({ type: "session.delete", sessionId: session.result.id });
    await waitFor(
      () => {
        const update = tui.output().slice(outputLength);
        return (
          update.includes("Select") &&
          update.includes("session...") &&
          update.includes("No sessions")
        );
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
    expect(tui.output().slice(outputLength)).not.toContain("Select session...");

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
        first.output().includes("Select session...") &&
        first.output().includes("Sessions") &&
        first.output().includes(DIMMED_CONNECTED_COLOR) &&
        second.output().includes("Select session...") &&
        second.output().includes("Sessions") &&
        second.output().includes(DIMMED_CONNECTED_COLOR),
      "both session choosers",
      () => `\nFirst:\n${first.output()}\nSecond:\n${second.output()}`,
    );
    await Bun.sleep(100);
    const firstOutputLength = first.output().length;
    first.terminal.write(input.encode("First\r"));
    await waitFor(
      () => first.output().slice(firstOutputLength).includes("Fir"),
      "the first TUI selection",
      () => `\n${first.output().slice(firstOutputLength)}`,
    );
    const secondSelectionOutputLength = second.output().length;
    second.terminal.write(input.encode("Second\r"));
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
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "design",
    title: "Input Project",
  });
  const item = await client.command({
    type: "item.create",
    workspaceId: workspace.result.id,
    category: "design",
    parentId: project.result.id,
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
    expect((await client.snapshot()).panes.find(({ id }) => id === paneId)?.restorePolicy).toEqual({
      type: "shell",
      executable: "/bin/sh",
      args: [],
    });
    await waitFor(
      () => tui.output().includes("Keys") && tui.output().includes(CONNECTED_COLOR),
      "the populated shell",
      () => `\n${tui.output()}`,
    );
    await Bun.sleep(100);

    tui.terminal.write(input.encode("\r"));
    tui.terminal.write(input.encode(kitty.hyper(104)));
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("TODAY"), "the next category");
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("DESIGN"), "the design category");
    tui.terminal.write(input.encode(kitty.hyper(108)));
    await waitFor(() => tui.output().includes("IMPLEMENTATION"), "the project category");

    // Hyper changes selection, not the rail's independent browsing cursor.
    tui.terminal.write(input.encode("jj\r"));
    await Bun.sleep(50);
    tui.terminal.write(input.encode("l"));
    await waitFor(() => tui.output().includes("Input Item"), "the expanded project");
    tui.terminal.write(input.encode("j"));
    await Bun.sleep(50);
    expect(tui.output()).not.toContain("Second");
    const activationDaemonPid = (await client.health()).pid;
    const activationOutputLength = tui.output().length;
    let resumeActivation: ReturnType<typeof setTimeout> | undefined;
    // The view can render before the command response allows the input handoff.
    process.kill(activationDaemonPid, "SIGSTOP");
    try {
      tui.terminal.write(input.encode("\r"));
      await waitFor(() => tui.output().includes("Second"), "item activation");
      expect(tui.output().slice(activationOutputLength)).not.toContain("\x1b[?25h");
      resumeActivation = setTimeout(() => process.kill(activationDaemonPid, "SIGCONT"), 150);
      await waitForTerminalInput(tui, "item Enter to focus terminal input", activationOutputLength);
      tui.terminal.write(input.encode("printf 'ENTER-%s\\n' \"$((3*7))\"\r"));
      await waitForSnapshot(
        client,
        (snapshot) => terminalText(snapshot, secondTab.result.paneId!).includes("ENTER-21"),
        "item Enter handing input directly to its active pane",
      );
    } finally {
      clearTimeout(resumeActivation);
      process.kill(activationDaemonPid, "SIGCONT");
    }

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
    await waitForTerminalInput(tui, "spatial movement to focus terminal input");
    tui.terminal.write(input.encode("printf 'WC-%s\\n' \"$((6*7))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, paneId).includes("WC-42"),
      "printable terminal output",
      (snapshot) => `\nPane: ${terminalText(snapshot, paneId)}\nTUI: ${tui.output().slice(-5_000)}`,
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
    const daemonPid = (await client.health()).pid;
    const reloadOutputLength = tui.output().length;
    // Hold reload pending so connecting cannot disappear between render frames.
    process.kill(daemonPid, "SIGSTOP");
    try {
      tui.terminal.write(input.encode(kitty.hyper(114)));
      await waitFor(
        () => tui.output().slice(reloadOutputLength).includes(CONNECTING_COLOR),
        "reload to start connecting",
        () => `\n${tui.output().slice(reloadOutputLength)}`,
      );
    } finally {
      process.kill(daemonPid, "SIGCONT");
    }
    const reconnectOutputLength = tui.output().length;
    await waitFor(
      () => tui.output().slice(reconnectOutputLength).includes(CONNECTED_COLOR),
      "reload to reconnect",
      () => `\n${tui.output().slice(reconnectOutputLength)}`,
    );
    tui.terminal.write(Uint8Array.of(12));
    await waitForTerminalInput(tui, "terminal input focus after reload");
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
    const cancellationOutputLength = tui.output().length;
    tui.terminal.write(input.encode("\x1b"));
    await waitFor(
      () => tui.output().slice(cancellationOutputLength).includes(CONNECTED_COLOR),
      "the chooser backdrop to disappear",
    );
    await waitForTerminalInput(
      tui,
      "terminal input focus after chooser cancellation",
      cancellationOutputLength,
    );
    expect(tui.output().slice(cancellationOutputLength)).toContain("\x1b[?25h");

    tui.terminal.write(input.encode("_wc_missing_command_\r"));
    await Bun.sleep(100);
    tui.terminal.write(input.encode("printf 'ERR-%s\\n' \"$((9*9))\"\r"));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, focusedPaneId).includes("ERR-81"),
      "shell recovery after command error",
      (snapshot) =>
        `\nTUI: ${tui.output().slice(-8_000)}\nPane: ${terminalText(snapshot, focusedPaneId)}`,
    );

    const interruptCommand = String.raw`sh -c 'trap "printf \"%s-%s\\n\" WC INTERRUPTED; exit 0" INT; printf "%s-%s\n" WC INTERRUPT-READY; while :; do sleep 1; done'`;
    tui.terminal.write(input.encode(`${interruptCommand}\r`));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, focusedPaneId).includes("WC-INTERRUPT-READY"),
      "the interruptible child to install its signal handler",
    );
    tui.terminal.write(Uint8Array.of(3));
    await waitForSnapshot(
      client,
      (snapshot) => terminalText(snapshot, focusedPaneId).includes("WC-INTERRUPTED"),
      "Ctrl-C reaching the interruptible child",
    );
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

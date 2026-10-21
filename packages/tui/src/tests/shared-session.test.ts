import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { projectPaneLayout, type Snapshot } from "@work-craft/server/client";

import { calculateShellLayout } from "@/shell/layout";
import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";
import { terminalRect } from "@/workbench/layout";

type ProgramState = {
  pid: number;
  row: number;
  col: number;
  typed: string;
  replies: number;
  size: { cols: number; rows: number };
};

async function programState(log: string): Promise<ProgramState> {
  const lines = (await readFile(log, "utf8")).split("\n");
  return JSON.parse(lines.at(-2)!) as ProgramState;
}

function expectedSize(
  snapshot: Snapshot,
  paneId: string,
  cols: number,
  rows: number,
  navigatorOpen: boolean,
) {
  const tab = snapshot.tabs.find((tab) => JSON.stringify(tab.layout).includes(paneId))!;
  const shell = calculateShellLayout({
    terminalWidth: cols,
    terminalHeight: rows,
    navigatorOpen,
    preferredNavigatorWidth: 45,
    paneLayout: tab.layout,
  });
  const pane = projectPaneLayout(tab.layout!, shell.workbenchContent).panes.find(
    (pane) => pane.paneId === paneId,
  )!;
  const viewport = terminalRect(pane.rect, false);
  return { cols: viewport.width, rows: viewport.height };
}

test("two normal TUIs display one program and one logical cursor", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  try {
    await focusSharedTerminal(a);
    await sharedWait(async () => {
      const snapshot = await fixture.client.snapshot();
      return (
        snapshot.geometry.panes.find(({ paneId }) => paneId === fixture.paneId)?.size.cols ===
        expectedSize(snapshot, fixture.paneId, 160, 45, true).cols
      );
    }, "A's active viewport report");
    sharedWrite(a, ":");
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes("sh-3.2$ :")),
      "input probe before program launch",
      a.frame,
    );
    const log = join(fixture.home, "program-log");
    const program = join(import.meta.dir, "support/shared-session-program.ts");
    sharedWrite(a, `\x1b[200~;'${process.execPath}' '${program}' '${log}'\r\x1b[201~`);
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes("shared cursor")),
      "mirrored program",
      () => fixture.tuis.map((tui) => tui.frame()).join("\n"),
    );
    const first = await programState(log);
    expect(first.size).toEqual(
      expectedSize(await fixture.client.snapshot(), fixture.paneId, 160, 45, true),
    );
    sharedWrite(a, "u");
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes("row=25 col=90")),
      "one logical cursor",
      () => fixture.tuis.map((tui) => tui.frame()).join("\n"),
    );
    await fixture.resizeTui(b, 80, 30);
    await sharedWait(
      () => b.frame().includes("@") && b.cursor().x < 80,
      "cursor-follow crop",
      b.frame,
    );
    expect(
      (await fixture.client.snapshot()).geometry.panes.find(
        ({ paneId }) => paneId === fixture.paneId,
      )?.size,
    ).toEqual(first.size);
    expect((await programState(log)).size).toEqual(first.size);
    await fixture.resizeTui(b, 100, 32);
    await sharedWait(
      () => b.frame().includes("row=25 col=90"),
      "passive viewport restoration",
      b.frame,
    );
    await focusSharedTerminal(b);
    sharedWrite(b, "h");
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes("row=25 col=89")),
      "cursor moved by the other client",
    );
    sharedWrite(b, "z");
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes("typed=z")),
      "unchanged printable input",
    );
    const last = await programState(log);
    expect(last.pid).toBe(first.pid);
    expect(last.row).toBe(25);
    expect(last.col).toBe(89);
    expect(last.size).toEqual(
      expectedSize(await fixture.client.snapshot(), fixture.paneId, 100, 32, false),
    );
    sharedWrite(b, "?");
    await sharedWait(
      async () => (await programState(log)).replies === 1,
      "one live emulator reply",
    );

    // A fresh client replays the query in history but must not answer it again.
    const secondTab = await fixture.client.command({
      type: "tab.create",
      surfaceId: (await fixture.client.snapshot()).surfaces[0]!.id,
      title: "Independent",
    });
    await fixture.stopTui(a);
    sharedWrite(b, "\x1b[93;15u");
    await sharedWait(
      async () => (await fixture.client.snapshot()).navigation[0]?.tabId === secondTab.result.tabId,
      "B navigates while A is disconnected",
    );
    const reconnected = fixture.startTui(160, 45);
    await sharedWait(
      () =>
        reconnected.frame().includes("Independent") &&
        !reconnected.frame().includes(`shared pid=${first.pid}`),
      "reconnect reads current navigation, not the old tab",
      reconnected.frame,
    );
    sharedWrite(b, "\x1b[91;15u");
    await sharedWait(
      () => reconnected.frame().includes(`shared pid=${first.pid}`),
      "retained running program after reconnect",
      reconnected.frame,
    );
    await focusSharedTerminal(b, 25);
    sharedWrite(b, "v");
    await sharedWait(
      async () => (await programState(log)).typed === "zv",
      "B's input readiness after tab replay",
    );
    sharedWrite(b, "?");
    await sharedWait(
      async () => (await programState(log)).replies === 2,
      "one reply per new query, none from replay",
    );
    expect((await programState(log)).pid).toBe(first.pid);

    await fixture.cli(["session", "select", fixture.sessionId, "--tab", secondTab.result.tabId!]);
    await sharedWait(
      () => [b, reconnected].every((tui) => tui.frame().includes("Independent")),
      "mirrored tab selection",
    );
    await fixture.cli(["session", "select", fixture.sessionId, "--pane", fixture.paneId]);
    await sharedWait(
      () => [b, reconnected].every((tui) => tui.frame().includes(`shared pid=${first.pid}`)),
      "same process after navigation",
    );
    expect((await programState(log)).pid).toBe(first.pid);
    const split = await fixture.client.command({
      type: "pane.split",
      paneId: fixture.paneId,
      direction: "vertical",
    });
    const splitSnapshot = await fixture.client.snapshot();
    expect(splitSnapshot.navigation[0]?.paneId).toBe(fixture.paneId);
    expect(splitSnapshot.panes).toHaveLength(3);
    expect(split.result.paneId).not.toBe(fixture.paneId);
    await sharedWait(
      async () =>
        (await programState(log)).size.cols ===
        expectedSize(await fixture.client.snapshot(), fixture.paneId, 100, 32, false).cols,
      "split-derived PTY size",
    );
    expect((await programState(log)).pid).toBe(first.pid);
    await sharedWait(
      async () =>
        new Set((await readFile(join(fixture.home, "shell-pids"), "utf8")).trim().split("\n"))
          .size === 3,
      "all three shells publish their PIDs",
    );
    const shells = (await readFile(join(fixture.home, "shell-pids"), "utf8")).trim().split("\n");
    expect(new Set(shells).size).toBe(3);

    const other = await fixture.cli(["session", "create", "--name", "Other Session"]);
    await fixture.cli([
      "session",
      "add-workspace",
      String(other.id),
      "--workspace",
      fixture.workspaceId,
    ]);
    sharedWrite(b, "\x1b[115;15u");
    await sharedWait(
      () => b.frame().includes("Sessions") && b.frame().includes("Other Session"),
      "explicit session chooser",
      b.frame,
    );
    sharedWrite(b, "Other\r");
    await sharedWait(
      () => !b.frame().includes("New session") && b.frame().includes("Other Session"),
      "only B attaches to Other",
      b.frame,
    );
    await fixture.cli(["session", "open-item", String(other.id), "--item", fixture.itemId]);
    await fixture.cli(["session", "select", fixture.sessionId, "--tab", secondTab.result.tabId!]);
    await sharedWait(
      () =>
        b.frame().includes(`shared pid=${first.pid}`) &&
        reconnected.frame().includes("Independent") &&
        !reconnected.frame().includes(`shared pid=${first.pid}`),
      "independent session cursors over shared runtimes",
      () => b.frame() + "\n" + reconnected.frame(),
    );
    const independent = await fixture.client.snapshot();
    expect(
      independent.navigation.find(({ sessionId }) => sessionId === fixture.sessionId)?.tabId,
    ).toBe(secondTab.result.tabId!);
    expect(independent.navigation.find(({ sessionId }) => sessionId === other.id)?.paneId).toBe(
      fixture.paneId,
    );
    expect((await programState(log)).pid).toBe(first.pid);

    // Persist different pane memories, then recover once with no disposable clients.
    await fixture.cli(["session", "select", fixture.sessionId, "--pane", split.result.paneId!]);
    await fixture.cli(["session", "select", fixture.sessionId, "--tab", secondTab.result.tabId!]);
    await fixture.stopTui(b);
    await fixture.stopTui(reconnected);
    const beforeRecovery = await fixture.client.snapshot();
    const retained = beforeRecovery.terminalHistories.find(
      ({ paneId }) => paneId === fixture.paneId,
    )!;
    expect(retained.resizes!.length).toBeGreaterThan(1);
    await fixture.restartDaemon();
    await sharedWait(
      async () =>
        (await fixture.client.snapshot()).panes.every(
          ({ processStatus }) => processStatus === "running",
        ),
      "one recovery spawn per pane",
    );
    const recovered = await fixture.client.snapshot();
    expect(recovered.navigation).toEqual(beforeRecovery.navigation);
    expect(recovered.panes.map(({ id }) => id)).toEqual(beforeRecovery.panes.map(({ id }) => id));
    await sharedWait(
      async () =>
        new Set((await readFile(join(fixture.home, "shell-pids"), "utf8")).trim().split("\n"))
          .size === 6,
      "all recovered shells publish their PIDs",
    );
    const allShells = (await readFile(join(fixture.home, "shell-pids"), "utf8")).trim().split("\n");
    expect(new Set(allShells).size).toBe(6);
    expect(() => process.kill(first.pid, 0)).toThrow();
    const restoredHistory = recovered.terminalHistories.find(
      ({ paneId }) => paneId === fixture.paneId,
    )!;
    expect(restoredHistory.resizes!.slice(0, retained.resizes!.length)).toEqual(retained.resizes!);
    const memory = await fixture.cli([
      "session",
      "select",
      fixture.sessionId,
      "--tab",
      fixture.tabId,
    ]);
    expect(memory.navigation).toMatchObject({ paneId: split.result.paneId });
    expect(
      (await fixture.client.snapshot()).navigation.find(({ sessionId }) => sessionId === other.id)
        ?.paneId,
    ).toBe(fixture.paneId);
  } finally {
    await fixture.close();
  }
}, 30000);

test.skipIf(!Bun.which("nvim"))(
  "two normal TUIs edit one Neovim file and share its logical cursor",
  async () => {
    const fixture = await startSharedSessionFixture();
    const [a, b] = fixture.tuis;
    const file = join(fixture.home, "shared.txt");
    const state = join(fixture.home, "editor-state");
    try {
      await writeFile(file, "alpha\nbravo\ncharlie\n");
      await focusSharedTerminal(a);
      await sharedWait(async () => {
        const snapshot = await fixture.client.snapshot();
        return (
          snapshot.geometry.panes[0]?.size.cols ===
          expectedSize(snapshot, fixture.paneId, 160, 45, true).cols
        );
      }, "A's editor viewport report");
      sharedWrite(a, ":");
      await sharedWait(() => a.frame().includes("sh-3.2$ :"), "editor launch input probe", a.frame);
      sharedWrite(a, `\x1b[200~;'${Bun.which("nvim")}' -u NONE -i NONE -n '${file}'\r\x1b[201~`);
      await sharedWait(
        () =>
          [a, b].every((tui) => tui.frame().includes("alpha") && tui.frame().includes("charlie")),
        "one mirrored Neovim",
        () => a.frame() + "\n" + b.frame(),
      );
      const record = `:call writefile([string(getpid()), string(line('.')), string(col('.'))] + getline(1, '$') + [string(&lines), string(&columns)], '${state}')\r`;
      sharedWrite(a, `iShared-from-A\x1b[27uG$${record}`);
      await sharedWait(async () => {
        try {
          return (await readFile(state, "utf8")).split("\n").slice(1, 3).join("\n") === "3\n7";
        } catch {
          return false;
        }
      }, "A moves the editor's logical cursor to line 3 column 7");
      const pid = Number((await readFile(state, "utf8")).split("\n")[0]);
      expect(pid).toBeGreaterThan(0);
      expect((await readFile(state, "utf8")).split("\n").slice(3, 6)).toEqual([
        "Shared-from-Aalpha",
        "bravo",
        "charlie",
      ]);
      await focusSharedTerminal(b);
      sharedWrite(b, `gg0l${record}`);
      await sharedWait(
        async () => (await readFile(state, "utf8")).split("\n").slice(1, 3).join("\n") === "1\n2",
        "B moves the same editor cursor",
      );
      expect(Number((await readFile(state, "utf8")).split("\n")[0])).toBe(pid);
      const editorSize = expectedSize(
        await fixture.client.snapshot(),
        fixture.paneId,
        100,
        32,
        false,
      );
      expect((await readFile(state, "utf8")).trim().split("\n").slice(-2)).toEqual([
        String(editorSize.rows),
        String(editorSize.cols),
      ]);
      expect((await readFile(state, "utf8")).split("\n").slice(3, 6)).toEqual([
        "Shared-from-Aalpha",
        "bravo",
        "charlie",
      ]);
      sharedWrite(b, "A-and-B");
      sharedWrite(b, "\x1b[27u");
      await sharedWait(() => !b.frame().includes("INSERT"), "editor leaves insert mode");
      sharedWrite(b, record);
      await sharedWait(
        async () => (await readFile(state, "utf8")).includes("-and-B"),
        "B's edited buffer state",
      );
      expect((await readFile(state, "utf8")).split("\n").slice(3, 6)).toEqual([
        "Shared-from-Aalpha-and-B",
        "bravo",
        "charlie",
      ]);
      sharedWrite(b, ":write\r");
      await sharedWait(
        async () => (await readFile(file, "utf8")).startsWith("Shared-from-Aalpha-and-B\n"),
        "shared edits saved by B",
      );
      await sharedWait(
        () => [a, b].every((tui) => tui.frame().includes("Shared-from-Aalpha-and-B")),
        "shared edited file in both frames",
        () => a.frame() + "\n" + b.frame(),
      );
      const shellPid = Number((await readFile(join(fixture.home, "shell-pids"), "utf8")).trim());
      const ps = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,command="]);
      const rows = new TextDecoder()
        .decode(ps.stdout)
        .trim()
        .split("\n")
        .map((line) => {
          const [pid, ppid, ...command] = line.trim().split(/\s+/);
          return { pid: Number(pid), ppid: Number(ppid), command: command.join(" ") };
        });
      const descendants = new Set([shellPid]);
      for (let previous = -1; previous !== descendants.size;) {
        previous = descendants.size;
        for (const row of rows) {
          if (descendants.has(row.ppid)) {
            descendants.add(row.pid);
          }
        }
      }
      const editors = rows.filter(
        (row) => descendants.has(row.pid) && /(^|\/)nvim(?: |$)/.test(row.command),
      );
      const launches = editors.filter(({ command }) => !command.includes(" --embed "));
      expect(launches).toHaveLength(1);
      expect(editors.filter((editor) => editor.pid === pid)).toHaveLength(1);
      // New Neovim versions use one TUI frontend plus its --embed editor child.
      expect(
        editors.every(
          (editor) =>
            editor.pid === launches[0]!.pid ||
            (editor.pid === pid && editor.ppid === launches[0]!.pid),
        ),
      ).toBe(true);
      sharedWrite(b, ":qa!\r");
      await sharedWait(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }, "single editor exit");
    } finally {
      await fixture.close();
    }
  },
  30000,
);

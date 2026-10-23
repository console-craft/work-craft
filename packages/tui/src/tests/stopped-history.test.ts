import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  focusSharedTerminal,
  type SharedTuiProcess,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
  waitForSharedTerminalInput,
} from "@/tests/support/shared-session-processes";

async function reactivate(tui: SharedTuiProcess): Promise<void> {
  const lines = tui.frame().split("\n");
  const y = lines.findIndex((line) => line.includes("Reactivate"));
  expect(y).toBeGreaterThan(0);
  const x = lines[y]!.indexOf("Reactivate") + 3;
  sharedWrite(tui, `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  await sharedWait(() => !tui.frame().includes("Reactivate"), "UI Reactivate admitted", tui.frame);
}

async function browse(tui: SharedTuiProcess): Promise<void> {
  const seen = new Set<string>();
  for (let step = 0; step < 195; step++) {
    for (const marker of ["STOP-000-42", "STOP-090-42", "STOP-179-42"]) {
      if (tui.frame().includes(marker)) {
        seen.add(marker);
      }
    }
    sharedWrite(tui, "\x1b[<64;80;15M");
    await Bun.sleep(35);
  }
  expect([...seen].sort()).toEqual(["STOP-000-42", "STOP-090-42", "STOP-179-42"]);
}

test("exited scrollback is client-local and UI Reactivate retains it under one fresh shell", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  const pids = () => readFile(join(fixture.home, "shell-pids"), "utf8");
  try {
    await focusSharedTerminal(a);
    sharedWrite(
      a,
      'i=0; while [ "$i" -lt 180 ]; do printf \'STOP-%03d-%s\\n\' "$i" "$((6*7))"; i=$((i+1)); done; exit\r',
    );
    await sharedWait(
      () =>
        [a, b].every(
          (tui) => tui.frame().includes("Terminal exited") && tui.frame().includes("STOP-179-42"),
        ),
      "both stopped pictures",
      a.frame,
    );
    expect(a.frame()).toContain("STOP-179-42");
    const oldPids = await pids();
    const bottom = b.frame();
    await browse(a);
    expect(b.frame()).toBe(bottom);
    sharedWrite(a, "should-not-spawn\x1b[200~paste\x1b[201~");
    expect(await pids()).toBe(oldPids);
    const beforeReactivate = a.outputStats().rawBytes;
    await reactivate(a);
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("shell restarted manually")),
      "manual divider in both fresh bottoms",
      a.frame,
    );
    // Reactivate owns entry; a second tab gesture can cancel its pending handoff.
    await waitForSharedTerminalInput(a, beforeReactivate);
    sharedWrite(a, "printf 'MANUAL-FRESH-%s\\n' \"$((6*7))\"\r");
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("MANUAL-FRESH-42")),
      "fresh input after UI Reactivate",
      a.frame,
    );
    const restartedPids = await pids();
    expect(restartedPids.trim().split("\n")).toHaveLength(oldPids.trim().split("\n").length + 1);
    await browse(a);
    const retained = (await fixture.client.snapshot()).terminalHistories.find(
      (h) => h.paneId === fixture.paneId,
    )!;
    expect(
      Buffer.from(retained.data, "base64")
        .toString()
        .split("[work-craft: shell restarted manually]"),
    ).toHaveLength(2);
    await fixture.stopTui(a);
    const reopened = fixture.startTui(160, 45);
    await sharedWait(
      () => reopened.frame().includes("MANUAL-FRESH-42"),
      "ordinary reconnect",
      reopened.frame,
    );
    expect(await pids()).toBe(restartedPids);
    await focusSharedTerminal(reopened);
    sharedWrite(reopened, "exit\r");
    await sharedWait(
      () => reopened.frame().includes("Terminal exited"),
      "second shell exit",
      reopened.frame,
    );
    await reactivate(reopened);
    await sharedWait(
      async () =>
        (await pids()).trim().split("\n").length === oldPids.trim().split("\n").length + 2,
      "second explicit new shell",
    );
    const repeated = (await fixture.client.snapshot()).terminalHistories.find(
      (h) => h.paneId === fixture.paneId,
    )!;
    expect(
      Buffer.from(repeated.data, "base64")
        .toString()
        .split("[work-craft: shell restarted manually]"),
    ).toHaveLength(3);
    for (const tui of [reopened, b]) {
      expect(tui.output()).not.toContain("Unhandled error");
      expect(tui.frame()).not.toContain("Console (Focused)");
    }
  } finally {
    await fixture.close();
  }
}, 30000);

test("daemon restart leaves an exited pane stopped with browsable retained history", async () => {
  const fixture = await startSharedSessionFixture();
  const [a] = fixture.tuis;
  try {
    await focusSharedTerminal(a);
    sharedWrite(
      a,
      'i=0; while [ "$i" -lt 180 ]; do printf \'STOP-%03d-%s\\n\' "$i" "$((6*7))"; i=$((i+1)); done; exit\r',
    );
    await sharedWait(
      () => a.frame().includes("Terminal exited"),
      "shell exit before daemon stop",
      a.frame,
    );
    const pids = await readFile(join(fixture.home, "shell-pids"), "utf8");
    await fixture.restartDaemon();
    await sharedWait(
      () => a.frame().includes("STOP-179-42") && a.frame().includes("Terminal exited"),
      "stopped material after daemon restart",
      a.frame,
    );
    await browse(a);
    expect(await readFile(join(fixture.home, "shell-pids"), "utf8")).toBe(pids);
    const snapshot = await fixture.client.snapshot();
    expect(snapshot.panes.find((pane) => pane.id === fixture.paneId)!.processStatus).toBe("exited");
    const history = Buffer.from(
      snapshot.terminalHistories.find((h) => h.paneId === fixture.paneId)!.data,
      "base64",
    ).toString();
    expect(history).not.toContain("shell restored");
    expect(history).not.toContain("shell restarted manually");
    expect(a.frame()).not.toContain("Console (Focused)");
  } finally {
    await fixture.close();
  }
}, 20000);

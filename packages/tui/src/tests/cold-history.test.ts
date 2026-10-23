import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

test("graceful daemon restart reconnects open TUIs without opening the error console", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  try {
    await focusSharedTerminal(a);
    sharedWrite(a, "printf 'BEFORE-%s\\n' \"$((6*7))\"\r");
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("BEFORE-42")),
      "output before graceful restart",
      a.frame,
    );
    await fixture.restartDaemon();
    await sharedWait(
      () =>
        [a, b].every(
          (tui) =>
            tui.frame().includes("daemon restarted; shell restored") &&
            tui.frame().includes("BEFORE-42"),
        ),
      "live cold recovery after daemon stop",
      () => a.frame() + "\n" + b.frame(),
    );
    for (const tui of [a, b]) {
      expect(tui.output()).not.toContain("Unhandled error");
      expect(tui.frame()).not.toContain("Console (Focused)");
    }
  } finally {
    await fixture.close();
  }
}, 15000);

test("cold daemon recovery restores ordinary scrollback independently in two normal TUIs", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  let oldPids: number[] = [];
  try {
    await focusSharedTerminal(a);
    sharedWrite(
      a,
      'i=0; while [ "$i" -lt 180 ]; do printf \'COLD-%03d-%s\\n\' "$i" "$((6*7))"; i=$((i+1)); done; printf \'\\033[?1h\\033[?2004h\'\r',
    );
    await sharedWait(() => a.frame().includes("COLD-179-42"), "computed old output", a.frame);
    const cursor = (await fixture.client.snapshot()).terminalHistories.find(
      (h) => h.paneId === fixture.paneId,
    )!.cursor;
    const db = new Database(join(fixture.home, "work-craft.sqlite"), { readonly: true });
    try {
      await sharedWait(() => {
        const saved = db
          .query<{ cursor: number }, [string]>(
            "SELECT MAX(cursor_end) AS cursor FROM terminal_chunks WHERE pane_id = ?",
          )
          .get(fixture.paneId);
        return saved !== null && saved.cursor >= cursor;
      }, "old output durably flushed");
    } finally {
      db.close();
    }
    oldPids = (await readFile(join(fixture.home, "shell-pids"), "utf8"))
      .trim()
      .split("\n")
      .map(Number);
    await fixture.crashDaemon();
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("daemon restarted; shell restored")),
      "both clients render the recovered separator",
      () => a.frame() + "\n" + b.frame(),
    );
    expect(a.frame()).toContain("COLD-179-42");
    expect(b.frame()).toContain("COLD-179-42");
    for (const tui of [a, b]) {
      expect(tui.output()).not.toContain("Unhandled error");
      expect(tui.frame()).not.toContain("Console (Focused)");
    }
    const bottom = b.frame();
    const seen = new Set<string>();
    for (let step = 0; step < 195; step++) {
      for (const marker of ["COLD-000-42", "COLD-090-42", "COLD-179-42"]) {
        if (a.frame().includes(marker)) seen.add(marker);
      }
      sharedWrite(a, "\x1b[<64;80;15M");
      await Bun.sleep(35);
    }
    expect([...seen].sort()).toEqual(["COLD-000-42", "COLD-090-42", "COLD-179-42"]);
    expect(b.frame()).toBe(bottom);
    for (let step = 0; step < 195; step++) {
      sharedWrite(a, "\x1b[<65;80;15M");
    }
    await sharedWait(
      () => a.frame().includes("daemon restarted; shell restored"),
      "return to live bottom",
      a.frame,
    );
    await focusSharedTerminal(a);
    sharedWrite(a, "\x1b[200~printf 'FRESH-%s\\n' \"$((7*8))\"\x1b[201~\r");
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("FRESH-56")),
      "fresh shell input after old paste/cursor modes",
      a.frame,
    );
    const pids = await readFile(join(fixture.home, "shell-pids"), "utf8");
    expect(pids.trim().split("\n")).toHaveLength(oldPids.length + 1);
    await fixture.stopTui(a);
    const reopened = fixture.startTui(160, 45);
    await sharedWait(
      () => reopened.frame().includes("FRESH-56"),
      "ordinary reconnect retains live shell",
      reopened.frame,
    );
    expect(await readFile(join(fixture.home, "shell-pids"), "utf8")).toBe(pids);
    const retained = (await fixture.client.snapshot()).terminalHistories.find(
      (h) => h.paneId === fixture.paneId,
    )!;
    expect(
      Buffer.from(retained.data, "base64").toString().split("daemon restarted; shell restored"),
    ).toHaveLength(2);
  } finally {
    await fixture.close();
  }
  for (const pid of oldPids) {
    expect(() => process.kill(pid, 0)).toThrow();
  }
}, 20000);

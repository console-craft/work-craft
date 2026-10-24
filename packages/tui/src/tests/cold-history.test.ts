import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StreamConnection } from "@work-craft/server/client";

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
  const started = performance.now();
  let phase = "before-crash";
  let observation: Promise<StreamConnection> | undefined;
  let lastFrame = "";
  let lastState: { epoch?: string; geometry?: unknown; cursor?: number; tail?: string } = {};
  const trace = (event: string, detail: unknown) => {
    console.error(
      "cold-frame-trace",
      JSON.stringify({
        ms: Math.round(performance.now() - started),
        phase,
        event,
        detail,
      }),
    );
  };
  const frames = setInterval(() => {
    const frame = b.frame();
    if (frame !== lastFrame) {
      lastFrame = frame;
      trace("B-frame", { frame, observedDaemonState: lastState });
    }
  }, 20);
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
    phase = "reconnecting";
    observation = fixture.client.stream({
      onMessage(message) {
        if (message.type === "snapshot") {
          const history = message.snapshot.terminalHistories.find(
            (h) => h.paneId === fixture.paneId,
          );
          lastState = {
            epoch: message.snapshot.epoch,
            geometry: message.snapshot.geometry,
            cursor: history?.cursor,
            tail: history && Buffer.from(history.data, "base64").toString().slice(-160),
          };
          trace("snapshot", lastState);
        } else if (message.type === "terminal.geometry") {
          lastState = { ...lastState, epoch: message.epoch, geometry: message.geometry };
          trace("geometry", message);
        } else if (message.type === "terminal.output" && message.paneId === fixture.paneId) {
          const data = Buffer.from(message.data, "base64").toString();
          lastState = {
            ...lastState,
            epoch: message.epoch,
            cursor: message.cursor,
            tail: ((lastState.tail ?? "") + data).slice(-160),
          };
          trace("output", { ...message, data });
        }
      },
      onClose(error) {
        trace("observer-closed", String(error ?? "closed"));
      },
    });
    void observation.catch((error) => trace("observer-error", String(error)));
    await sharedWait(
      () =>
        [a, b].every((tui) => {
          const frame = tui.frame();
          return (
            frame.includes("daemon restarted; shell restored") && frame.includes("COLD-179-42")
          );
        }),
      "both clients render the recovered output and separator",
      () => a.frame() + "\n" + b.frame(),
    );
    expect(a.frame()).toContain("COLD-179-42");
    expect(b.frame()).toContain("COLD-179-42");
    for (const tui of [a, b]) {
      expect(tui.output()).not.toContain("Unhandled error");
      expect(tui.frame()).not.toContain("Console (Focused)");
    }
    const bottom = b.frame();
    phase = "passive-baseline";
    trace("baseline", { frame: bottom, observedDaemonState: lastState });
    await Bun.sleep(400);
    trace("before-first-scroll", { frame: b.frame(), changed: b.frame() !== bottom });
    phase = "scrolling-A";
    const seen = new Set<string>();
    for (let step = 0; step < 195; step++) {
      for (const marker of ["COLD-000-42", "COLD-090-42", "COLD-179-42"]) {
        if (a.frame().includes(marker)) seen.add(marker);
      }
      sharedWrite(a, "\x1b[<64;80;15M");
      await Bun.sleep(35);
    }
    expect([...seen].sort()).toEqual(["COLD-000-42", "COLD-090-42", "COLD-179-42"]);
    trace("before-isolation-assertion", { frame: b.frame(), changed: b.frame() !== bottom });
    expect(b.frame()).toBe(bottom);
    phase = "after-isolation-assertion";
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
    clearInterval(frames);
    (await observation?.catch(() => undefined))?.close();
    await fixture.close();
  }
  for (const pid of oldPids) {
    expect(() => process.kill(pid, 0)).toThrow();
  }
}, 20000);

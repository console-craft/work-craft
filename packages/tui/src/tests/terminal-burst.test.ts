import { expect, test } from "bun:test";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

// oxlint-disable-next-line no-restricted-imports -- Cross-package test helper, not an internal TUI import.
import { sendTerminalInput } from "../../../../scripts/test-support/terminal-input";

function residentKiB(daemonPid: number, clientPids: number[]): Record<string, number> {
  const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss="]);
  if (result.exitCode !== 0) {
    throw new Error("Cannot sample burst process memory");
  }
  const rows = result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((row) => {
      const [pid, parent, rss] = row.trim().split(/\s+/).map(Number);
      return { pid: pid!, parent: parent!, rss: rss! };
    });
  return Object.fromEntries([
    ["daemon", rows.find(({ pid }) => pid === daemonPid)!.rss],
    ...clientPids.map((root, index) => {
      const descendants = new Set([root]);
      for (let previous = -1; previous !== descendants.size;) {
        previous = descendants.size;
        for (const row of rows) {
          if (descendants.has(row.parent)) {
            descendants.add(row.pid);
          }
        }
      }
      return [
        `tui${index + 1}`,
        rows.filter(({ pid }) => descendants.has(pid)).reduce((n, row) => n + row.rss, 0),
      ];
    }),
  ]);
}

test("four busy panes retain both client surfaces and active input during a four MiB redraw", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  const control = await fixture.client.stream({ onMessage() {} });
  try {
    await fixture.resizeTui(a, 200, 60);
    await fixture.resizeTui(b, 180, 55);
    const second = await fixture.client.command({
      type: "pane.split",
      paneId: fixture.paneId,
      direction: "horizontal",
    });
    const third = await fixture.client.command({
      type: "pane.split",
      paneId: fixture.paneId,
      direction: "vertical",
    });
    const fourth = await fixture.client.command({
      type: "pane.split",
      paneId: second.result.paneId!,
      direction: "vertical",
    });
    const paneIds = [
      fixture.paneId,
      second.result.paneId!,
      third.result.paneId!,
      fourth.result.paneId!,
    ];
    const program = join(import.meta.dir, "support/shared-session-burst-program.ts");
    for (const [index, paneId] of paneIds.entries()) {
      await sendTerminalInput(
        fixture.client,
        control,
        paneId,
        new TextEncoder().encode(
          `exec '${process.execPath}' '${program}' '${fixture.home}' '${index}'\r`,
        ),
      );
      await sharedWait(
        () => Bun.file(join(fixture.home, `ready-${index}`)).exists(),
        `pane ${index} ready`,
      );
    }
    await fixture.client.command({
      type: "session.navigate",
      sessionId: fixture.sessionId,
      target: { kind: "pane", paneId: fixture.paneId },
    });
    control.close();
    const pids = await Promise.all(
      paneIds.map((_, index) => readFile(join(fixture.home, `ready-${index}`), "utf8")),
    );
    await sharedWait(
      () =>
        fixture.tuis.every((tui) =>
          pids.every((pid, index) => tui.frame().includes(`pane-${index} pid=${pid} tick=0`)),
        ),
      "both clients render the four-pane fixture before input",
      () => a.frame() + "\n" + b.frame(),
    );
    await focusSharedTerminal(a);
    sharedWrite(a, "z");
    await sharedWait(
      () => a.frame().includes("typed=z") && a.cursor().visible,
      "burst input readiness",
      a.frame,
    );
    const daemonPid = (await fixture.client.health()).pid;
    const samples = [residentKiB(daemonPid, [a.child.pid, b.child.pid])];
    const offsets = fixture.tuis.map((tui) => tui.output().length);
    const latencies: number[] = [];
    let duringBurst = 0;
    let typed = "z";
    await writeFile(join(fixture.home, "burst-start"), "start");
    for (const key of "abcdefgh") {
      if (!(await Bun.file(join(fixture.home, "done-0")).exists())) {
        duringBurst++;
      }
      typed += key;
      const started = performance.now();
      sharedWrite(a, key);
      while (!(a.frame().includes(`typed=${typed}`) && a.cursor().visible)) {
        if (performance.now() - started > 20_000) {
          throw new Error(`Input never became visible: ${typed}\n${a.frame()}`);
        }
        await Bun.sleep(20);
      }
      latencies.push(performance.now() - started);
      if (latencies.length % 2 === 0) {
        samples.push(residentKiB(daemonPid, [a.child.pid, b.child.pid]));
      }
      await Bun.sleep(30);
    }
    samples.push(residentKiB(daemonPid, [a.child.pid, b.child.pid]));
    // Completion includes paced output; responsiveness keeps its separate <1000ms assertion.
    for (let index = 0; index < 4; index++) {
      await sharedWait(
        () => Bun.file(join(fixture.home, `done-${index}`)).exists(),
        `pane ${index} completes`,
        () => a.frame() + "\n" + b.frame(),
        8000,
      );
    }
    await sharedWait(
      () => fixture.tuis.every((tui) => tui.frame().includes(`typed=${typed}`)),
      "both clients converge on typed input",
      () => a.frame() + "\n" + b.frame(),
    );
    const snapshot = await fixture.client.snapshot();
    samples.push(residentKiB(daemonPid, [a.child.pid, b.child.pid]));
    if (process.env.WORK_CRAFT_BURST_METRICS) {
      await appendFile(
        process.env.WORK_CRAFT_BURST_METRICS,
        JSON.stringify({
          rawBurstBytes: 4_194_304,
          duringBurst,
          inputLatencyMs: latencies,
          residentKiB: samples,
        }) + "\n",
      );
    }
    expect(duringBurst).toBeGreaterThan(1);
    expect(a.cursor().visible).toBe(true);
    for (const [index, paneId] of paneIds.entries()) {
      const pid = Number(pids[index]);
      await sharedWait(
        () => fixture.tuis.every((tui) => tui.frame().includes(`pane-${index} pid=${pid} tick=64`)),
        `both clients render pane ${index}'s final frame`,
        () => a.frame() + "\n" + b.frame(),
      );
      expect(await readFile(join(fixture.home, `done-${index}`), "utf8")).toBe(String(pid));
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(
        snapshot.terminalHistories.find((history) => history.paneId === paneId)!.cursor,
      ).toBeGreaterThan(1_048_576);
      for (const tui of fixture.tuis) {
        expect(tui.frame()).toContain(`pane-${index} pid=${pid}`);
      }
    }
    for (const [index, tui] of fixture.tuis.entries()) {
      const output = Bun.stripANSI(tui.output().slice(offsets[index]));
      expect(output).not.toContain("No execution surface");
      expect(output).not.toContain("Select session...");
      expect(output).not.toContain("Disconnected");
    }
    expect(Math.max(...latencies)).toBeLessThan(1000);
  } finally {
    control.close();
    await fixture.close();
  }
}, 60_000);

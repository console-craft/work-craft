import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { profileProbes, profileResidentKiB } from "@/tests/support/output-profile";
import { latencySummary } from "@/tests/support/output-profile-statistics";
import { flushProfileProbes } from "@/tests/support/output-profile-trace";
import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

// oxlint-disable-next-line no-restricted-imports -- Existing test-only real stream input helper.
import { sendTerminalInput } from "../../../../../scripts/test-support/terminal-input";

export async function startCapacityProfile(
  directory: string,
  diagnostics = false,
): Promise<{
  fixture: Awaited<ReturnType<typeof startSharedSessionFixture>>;
  programPaneIds: string[];
  idlePaneIds: string[];
}> {
  const fixture = await startSharedSessionFixture({
    boundedObservation: true,
    profileDirectory: diagnostics ? directory : "",
  });
  const programPaneIds: string[] = [];
  const idlePaneIds: string[] = [];
  const control = await fixture.client.stream({ onMessage() {} });
  try {
    await fixture.resizeTui(fixture.tuis[0], 200, 60);
    await fixture.resizeTui(fixture.tuis[1], 180, 55);
    for (let item = 0; item < 10; item++) {
      let paneId = fixture.paneId;
      let surfaceId = (await fixture.client.snapshot()).panes.find(
        (pane) => pane.id === paneId,
      )!.surfaceId;
      if (item > 0) {
        const path = join(fixture.home, `coding-${item}`);
        await mkdir(path);
        const registered = await fixture.client.command({
          type: "directory.register",
          workspaceId: fixture.workspaceId,
          path,
        });
        const opened = await fixture.client.command({
          type: "surface.ensure",
          itemId: registered.result.itemId!,
        });
        paneId = opened.result.paneId!;
        surfaceId = opened.result.surfaceId!;
      }
      const split = await fixture.client.command({
        type: "pane.split",
        paneId,
        direction: "vertical",
      });
      const firstPair = [paneId, split.result.paneId!];
      (item < 5 ? programPaneIds : idlePaneIds).push(...firstPair);
      const second = await fixture.client.command({
        type: "tab.create",
        surfaceId,
        title: "Second",
      });
      const secondSplit = await fixture.client.command({
        type: "pane.split",
        paneId: second.result.paneId!,
        direction: "vertical",
      });
      const third = await fixture.client.command({ type: "tab.create", surfaceId, title: "Third" });
      idlePaneIds.push(second.result.paneId!, secondSplit.result.paneId!, third.result.paneId!);
    }
    const program = join(import.meta.dir, "output-profile-program.ts");
    for (const [label, paneId] of programPaneIds.entries()) {
      await sendTerminalInput(
        fixture.client,
        control,
        paneId,
        new TextEncoder().encode(
          `exec '${process.execPath}' '${program}' '${directory}' '${label}'\r`,
        ),
      );
      await sharedWait(
        () => Bun.file(join(directory, `ready-profile-${label}.json`)).exists(),
        `complex producer ${label} starts`,
      );
    }
    await fixture.client.command({
      type: "session.navigate",
      sessionId: fixture.sessionId,
      target: { kind: "pane", paneId: programPaneIds[0]! },
    });
    control.close();
    return { fixture, programPaneIds, idlePaneIds };
  } catch (error) {
    control.close();
    await fixture.close();
    throw error;
  }
}

export async function measureCapacityProfile(
  directory: string,
  options: { diagnostics?: boolean; soakMs?: number } = {},
): Promise<object> {
  const capacity = await startCapacityProfile(directory, options.diagnostics);
  const { fixture, programPaneIds, idlePaneIds } = capacity;
  const [a, b] = fixture.tuis;
  const memory: { phase: string; minute: number; residentKiB: Record<string, number> }[] = [];
  let control: Awaited<ReturnType<typeof fixture.client.stream>> | undefined;
  let stopped = false;
  const errors: string[] = [];
  try {
    const daemonPid = (await fixture.client.health()).pid;
    const children = await Promise.all(
      programPaneIds.map(
        async (_, label) =>
          JSON.parse(await readFile(join(directory, `ready-profile-${label}.json`), "utf8"))
            .pid as number,
      ),
    );
    function sample(phase: string, minute = 0): void {
      memory.push({
        phase,
        minute,
        residentKiB: profileResidentKiB(daemonPid, [a.child.pid, b.child.pid], children),
      });
    }
    await Bun.sleep(10000);
    await focusSharedTerminal(a, 90).catch((error) => errors.push(String(error)));
    sample("idle-shells");
    const probes = await profileProbes(
      (text) => sharedWrite(a, text),
      () => ({ text: a.frame(), cursor: a.cursor().visible }),
      directory,
      "0",
    );
    await writeFile(
      join(directory, "capacity-idle.json"),
      JSON.stringify({ probes, memory, errors }),
    );
    const switches: { committedMs: number; visibleMs: number | null; paneId: string }[] = [];
    for (let index = 0; index < 100; index++) {
      const label = (index % 5) * 2;
      const paneId = programPaneIds[label]!;
      const started = performance.now();
      await fixture.client.command({
        type: "session.navigate",
        sessionId: fixture.sessionId,
        target: { kind: "pane", paneId },
      });
      const committedMs = performance.now() - started;
      let visibleMs: number | null = null;
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (a.frame().includes(`profile-${label} pid=`) && a.cursor().visible) {
          visibleMs = performance.now() - started;
          break;
        }
        await Bun.sleep(5);
      }
      switches.push({ paneId, committedMs, visibleMs });
    }
    sample("after-switches");
    await writeFile(
      join(directory, "capacity-switches.json"),
      JSON.stringify({ switches, memory, errors }),
    );
    await fixture.client.command({
      type: "session.navigate",
      sessionId: fixture.sessionId,
      target: { kind: "pane", paneId: programPaneIds[0]! },
    });
    await focusSharedTerminal(a, 90).catch((error) => errors.push(String(error)));
    // A finite slow viewer is always resumed before fixture teardown.
    process.kill(-b.child.pid, "SIGSTOP");
    stopped = true;
    const stalledProbes = await profileProbes(
      (text) => sharedWrite(a, text),
      () => ({ text: a.frame(), cursor: a.cursor().visible }),
      directory,
      "0",
      20,
    );
    process.kill(-b.child.pid, "SIGCONT");
    stopped = false;
    sample("mirror-resumed");
    await writeFile(
      join(directory, "capacity-mirror.json"),
      JSON.stringify({ stalledProbes, memory, errors }),
    );
    control = await fixture.client.stream({ onMessage() {} });
    for (const paneId of idlePaneIds) {
      await sendTerminalInput(fixture.client, control, paneId, new TextEncoder().encode("exit\r"));
    }
    await sharedWait(async () => {
      const snapshot = await fixture.client.snapshot();
      return idlePaneIds.every(
        (id) => snapshot.panes.find((pane) => pane.id === id)?.processStatus === "exited",
      );
    }, "forty stopped panes");
    control.close();
    control = undefined;
    await fixture.client.command({
      type: "session.navigate",
      sessionId: fixture.sessionId,
      target: { kind: "pane", paneId: programPaneIds[0]! },
    });
    await focusSharedTerminal(a, 90).catch((error) => errors.push(String(error)));
    const stoppedProbes = await profileProbes(
      (text) => sharedWrite(a, text),
      () => ({ text: a.frame(), cursor: a.cursor().visible }),
      directory,
      "0",
    );
    sample("stopped-shells");
    await writeFile(
      join(directory, "capacity-stopped.json"),
      JSON.stringify({ stoppedProbes, memory, errors }),
    );
    const started = performance.now();
    for (let minute = 1; performance.now() - started < (options.soakMs ?? 600000); minute++) {
      await Bun.sleep(Math.min(60000, (options.soakMs ?? 600000) - (performance.now() - started)));
      sample("soak", minute);
      await writeFile(
        join(directory, "capacity-soak.json"),
        JSON.stringify({ elapsedMs: performance.now() - started, memory, errors }),
      );
      if (options.diagnostics) {
        await flushProfileProbes(directory, [daemonPid, a.child.pid, b.child.pid]).catch((error) =>
          errors.push(String(error)),
        );
      }
      const label = ((minute - 1) % 5) * 2;
      await fixture.client.command({
        type: "session.navigate",
        sessionId: fixture.sessionId,
        target: { kind: "pane", paneId: programPaneIds[label]! },
      });
    }
    return {
      seed: 1,
      panes: 50,
      complex: 10,
      hiddenBytesPerTick: 4096,
      hiddenCadenceMs: 100,
      probes,
      stoppedProbes,
      stalledProbes,
      switches,
      memory,
      errors,
      idleVisible: latencySummary(
        probes.map((probe) => (probe.visibleMs === null ? null : probe.visibleMs - probe.sentMs)),
      ),
      stoppedVisible: latencySummary(
        stoppedProbes.map((probe) =>
          probe.visibleMs === null ? null : probe.visibleMs - probe.sentMs,
        ),
      ),
      switchVisible: latencySummary(switches.map((entry) => entry.visibleMs)),
      outerObservation: fixture.tuis.map((tui) => tui.outputStats()),
    };
  } finally {
    if (stopped) {
      process.kill(-b.child.pid, "SIGCONT");
    }
    control?.close();
    if (options.diagnostics) {
      const health = await fixture.client.health().catch(() => null);
      const roots = [a.child.pid, b.child.pid];
      if (health) {
        roots.push(health.pid);
      }
      await flushProfileProbes(directory, roots).catch((error) => errors.push(String(error)));
    }
    await fixture.close();
  }
}

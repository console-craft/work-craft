import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import {
  alignClock,
  latencySummary,
  observedToken,
} from "@/tests/support/output-profile-statistics";
import { flushProfileProbes } from "@/tests/support/output-profile-trace";
import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";
import { createTerminalObservation } from "@/tests/support/terminal-observation";

export type ProfileMode = "direct-pty" | "native" | "application";
export type ProfileResult = {
  mode: ProfileMode;
  probes: { sentMs: number; childMs: number | null; visibleMs: number | null }[];
  peakResidentKiB: Record<string, number>;
  rawBytes: number;
  outerBytes: number | null;
  timedOut: boolean;
};

export function profileResidentKiB(
  daemonPid: number | null,
  clientPids: number[],
  childPids: number[],
): Record<string, number> {
  const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss="]);
  if (!result.success) {
    throw new Error("Cannot sample profile memory");
  }
  const rows = result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
      return { pid, parent, rss };
    });
  const samples: Record<string, number> = {
    harness: rows.find((row) => row.pid === process.pid)?.rss ?? 0,
  };
  if (daemonPid !== null) {
    samples.daemon = rows.find((row) => row.pid === daemonPid)?.rss ?? 0;
  }
  for (const [index, root] of clientPids.entries()) {
    const descendants = new Set([root]);
    for (let previous = -1; previous !== descendants.size;) {
      previous = descendants.size;
      for (const row of rows) {
        if (descendants.has(row.parent!)) {
          descendants.add(row.pid!);
        }
      }
    }
    samples[`tui${index + 1}`] = rows
      .filter((row) => descendants.has(row.pid!))
      .reduce((n, row) => n + row.rss!, 0);
  }
  samples.children = rows
    .filter((row) => childPids.includes(row.pid!))
    .reduce((n, row) => n + row.rss!, 0);
  return samples;
}

export async function profileProbes(
  send: (text: string) => void,
  view: (() => { text: string; cursor: boolean }) | null,
  directory: string,
  label: string,
  count = 200,
): Promise<ProfileResult["probes"]> {
  const probes: ProfileResult["probes"] = [];
  const observed = new Map<number, number>();
  const inputPath = join(directory, `inputs-${label}.jsonl`);
  const previous = (await readFile(inputPath, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .at(-1);
  const base = previous ? Number(JSON.parse(previous).sequence) : 0;
  function inspect(): void {
    if (!view) {
      return;
    }
    const frame = view();
    const token = /probe=(\d+);/.exec(frame.text);
    const sequence = token ? Number(token[1]) : 0;
    if (
      sequence > base &&
      sequence <= base + probes.length &&
      observedToken(frame.text, frame.cursor, sequence) &&
      !observed.has(sequence)
    ) {
      observed.set(sequence, performance.timeOrigin + performance.now());
    }
  }
  const timer = setInterval(inspect, 5);
  const start = performance.now();
  try {
    for (let sequence = 1; sequence <= count; sequence++) {
      await Bun.sleep(Math.max(0, start + (sequence - 1) * 100 - performance.now()));
      const sentMs = performance.timeOrigin + performance.now();
      probes.push({ sentMs, childMs: null, visibleMs: null });
      send(`p${base + sequence};`);
    }
    await Bun.sleep(1000);
    inspect();
    const records = (await readFile(inputPath, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const [index, probe] of probes.entries()) {
      probe.childMs =
        records.find((record) => record.sequence === base + index + 1)?.wallMs ?? null;
      probe.visibleMs = observed.get(base + index + 1) ?? null;
    }
    return probes;
  } finally {
    clearInterval(timer);
  }
}

export async function runOutputProfile(
  mode: ProfileMode,
  directory: string,
  options: {
    probes?: number;
    warmupMs?: number;
    diagnostics?: boolean;
  } = {},
): Promise<ProfileResult> {
  const program = join(import.meta.dir, "output-profile-program.ts");
  let rawBytes = 0;
  let parseMs = 0;
  let daemonPid: number | null = null;
  let clientPids: number[] = [];
  let childPid = 0;
  let cleanup: () => Promise<void> = async () => {};
  let send!: (text: string) => void;
  let view: (() => { text: string; cursor: boolean }) | null = null;
  let stats = () => ({ rawBytes, parseMs });
  let readRawBytes = async () => rawBytes;
  try {
    if (mode === "application") {
      const fixture = await startSharedSessionFixture({
        boundedObservation: true,
        profileDirectory: options.diagnostics ? directory : "",
      });
      cleanup = fixture.close;
      const [a, b] = fixture.tuis;
      await fixture.stopTui(b);
      await focusSharedTerminal(a);
      const initialSnapshot = await fixture.client.snapshot();
      const baselineCursor = initialSnapshot.terminalHistories.find(
        (history) => history.paneId === fixture.paneId,
      )!.cursor;
      readRawBytes = async () =>
        (await fixture.client.snapshot()).terminalHistories.find(
          (history) => history.paneId === fixture.paneId,
        )!.cursor - baselineCursor;
      const initial = initialSnapshot.geometry.panes.find(
        (entry) => entry.paneId === fixture.paneId,
      )!.size;
      await fixture.resizeTui(a, 160 + 80 - initial.cols, 45 + 24 - initial.rows);
      await sharedWait(async () => {
        const size = (await fixture.client.snapshot()).geometry.panes.find(
          (entry) => entry.paneId === fixture.paneId,
        )!.size;
        return size.cols === 80 && size.rows === 24;
      }, "matched 80x24 profile grid");
      const control = await fixture.client.stream({ onMessage() {} });
      try {
        const attachment = await control.attach(fixture.sessionId);
        const snapshot = await fixture.client.snapshot();
        const navigation = snapshot.navigation.find(
          (entry) => entry.sessionId === fixture.sessionId,
        )!;
        const geometry = snapshot.geometry.tabs.find((entry) => entry.tabId === navigation.tabId)!;
        const stamp = {
          epoch: snapshot.epoch,
          attachmentGeneration: attachment.generation,
          navigationGeneration: navigation.generation,
          geometrySequence: geometry.generation,
        };
        control.reportViewport(
          { ...stamp, tabId: navigation.tabId!, canvas: geometry.canvas!, eligible: true },
          stamp,
        );
        await control.command(
          {
            type: "session.navigate",
            sessionId: fixture.sessionId,
            target: { kind: "pane", paneId: fixture.paneId },
          },
          attachment.generation,
        );
        const synchronized = await fixture.client.snapshot();
        control.sendInput(
          fixture.paneId,
          new TextEncoder().encode(`exec '${process.execPath}' '${program}' '${directory}' '0'\r`),
          {
            ...stamp,
            geometrySequence: synchronized.geometry.tabs.find(
              (entry) => entry.tabId === navigation.tabId,
            )!.generation,
            source: "input",
            kind: "key",
            activitySequence: 1,
          },
        );
        await control.command(
          {
            type: "session.navigate",
            sessionId: fixture.sessionId,
            target: { kind: "pane", paneId: fixture.paneId },
          },
          attachment.generation,
        );
      } finally {
        control.close();
      }
      send = (text) => sharedWrite(a, text);
      view = () => ({ text: a.frame(), cursor: a.cursor().visible });
      stats = a.outputStats;
      daemonPid = (await fixture.client.health()).pid;
      clientPids = [a.child.pid];
    } else {
      const setup =
        mode === "native"
          ? await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false })
          : null;
      const terminal = setup
        ? new EmbeddedTerminalRenderable(setup.renderer, {
            id: "profile-native",
            cols: 80,
            rows: 24,
            width: 80,
            height: 24,
          })
        : null;
      if (terminal) {
        setup!.renderer.root.add(terminal);
      }
      const observer = terminal ? createTerminalObservation(terminal) : null;
      const child = Bun.spawn([process.execPath, program, directory, "0"], {
        env: {
          ...process.env,
          WORK_CRAFT_OUTPUT_PROFILE_DIR: "",
          WORK_CRAFT_OUTPUT_PROFILE_ROLE: "",
        },
        terminal: {
          cols: 80,
          rows: 24,
          data(_terminal, bytes) {
            rawBytes += bytes.byteLength;
            observer?.write(bytes);
          },
        },
      });
      childPid = child.pid;
      cleanup = async () => {
        child.kill();
        await child.exited;
        child.terminal?.close();
        setup?.renderer.destroy();
      };
      send = (text) => child.terminal!.write(text);
      view = observer
        ? () => ({ text: observer.frame(), cursor: observer.cursor().visible })
        : null;
      stats = () => ({ rawBytes, parseMs: observer?.parseMs() ?? 0 });
    }
    await sharedWait(
      () => Bun.file(join(directory, "ready-profile-0.json")).exists(),
      "profile producer ready",
      () => view?.().text ?? "direct PTY",
    );
    const ready = JSON.parse(await readFile(join(directory, "ready-profile-0.json"), "utf8"));
    if (ready.cols !== 80 || ready.rows !== 24) {
      throw new Error(`Mismatched profile grid ${ready.cols}x${ready.rows}`);
    }
    childPid = ready.pid;
    await Bun.sleep(options.warmupMs ?? 10000);
    const before = profileResidentKiB(daemonPid, clientPids, [childPid]);
    const probes = await profileProbes(send, view, directory, "0", options.probes);
    const after = profileResidentKiB(daemonPid, clientPids, [childPid]);
    const observed = stats();
    if (options.diagnostics && mode === "application") {
      await flushProfileProbes(directory, [daemonPid!, ...clientPids]);
    }
    const result: ProfileResult = {
      mode,
      probes,
      rawBytes: await readRawBytes(),
      outerBytes: mode === "application" ? observed.rawBytes : null,
      timedOut: probes.some(
        (probe) => probe.childMs === null || (view !== null && probe.visibleMs === null),
      ),
      peakResidentKiB: Object.fromEntries(
        Object.keys(before).map((key) => [key, Math.max(before[key]!, after[key]!)]),
      ),
    };
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(
        {
          ...result,
          outerParseMs: observed.parseMs,
          clockAssumption:
            "same-host performance.timeOrigin wall mapping; raw latency is not skew-corrected",
          clockBrackets: probes
            .filter(
              (probe) =>
                probe.childMs !== null &&
                probe.visibleMs !== null &&
                probe.visibleMs >= probe.sentMs,
            )
            .map((probe) => alignClock(probe.sentMs, probe.visibleMs!, probe.childMs!)),
          inputToChild: latencySummary(
            probes.map((probe) => (probe.childMs === null ? null : probe.childMs - probe.sentMs)),
          ),
          inputToVisible:
            mode === "direct-pty"
              ? null
              : latencySummary(
                  probes.map((probe) =>
                    probe.visibleMs === null ? null : probe.visibleMs - probe.sentMs,
                  ),
                ),
        },
        null,
        2,
      ),
    );
    return result;
  } finally {
    await cleanup();
  }
}

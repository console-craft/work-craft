import { expect, spyOn, test } from "bun:test";
import { appendFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { startCapacityProfile } from "@/tests/support/output-capacity";
import { runOutputProfile } from "@/tests/support/output-profile";
import {
  alignClock,
  intervalOverlaps,
  latencySummary,
  observedToken,
} from "@/tests/support/output-profile-statistics";
import { flushProfileProbes, readProfileFooter } from "@/tests/support/output-profile-trace";
import { createTerminalObservation } from "@/tests/support/terminal-observation";

test("missing probes remain failures and nearest-rank latency does not hide them", () => {
  expect(latencySummary([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
    count: 10,
    missing: 0,
    p95: 100,
    p99: 100,
    max: 100,
  });
  expect(latencySummary([10, null])).toEqual({
    count: 2,
    missing: 1,
    p95: null,
    p99: null,
    max: null,
  });
});

test("token observations require the exact sequence and a visible cursor", () => {
  expect(observedToken("probe=12;", true, 12)).toBe(true);
  expect(observedToken("probe=123;", true, 12)).toBe(false);
  expect(observedToken("probe=12;", false, 12)).toBe(false);
});

test("clock alignment reports an interval rather than assuming identical process clocks", () => {
  expect(alignClock(100, 110, 108)).toEqual({ offsetMs: 3, uncertaintyMs: 5 });
  expect(() => alignClock(110, 100, 108)).toThrow();
});

test("byte interval joins tolerate different PTY and WebSocket chunk boundaries", () => {
  expect(intervalOverlaps({ start: 0, end: 10 }, { start: 8, end: 20 })).toBe(2);
  expect(intervalOverlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(0);
  const whole = intervalOverlaps({ start: 0, end: 30 }, { start: 8, end: 20 });
  const split = [0, 10, 20].reduce(
    (n, start) => n + intervalOverlaps({ start, end: start + 10 }, { start: 8, end: 20 }),
    0,
  );
  expect(whole).toBe(12);
  expect(split).toBe(12);
});

test("display observation retains at most 256 KiB while the native screen stays current", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
  const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
    id: "bounded-observer",
    cols: 80,
    rows: 24,
    width: 80,
    height: 24,
  });
  setup.renderer.root.add(terminal);
  const observer = createTerminalObservation(terminal);
  try {
    observer.write(new Uint8Array(300000).fill(120));
    observer.write(new TextEncoder().encode("\x1b[Hprobe=7;\x1b[K\x1b[?25h"));
    await setup.flush();
    expect(observer.retained().byteLength).toBe(262144);
    expect(observer.bytes()).toBeGreaterThan(300000);
    expect(observer.frame()).toContain("probe=7;");
    expect(observer.cursor().visible).toBe(true);
    expect(observer.parseMs()).toBeGreaterThan(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("direct PTY comparison records child receipts without inventing display timestamps and cleans up", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-direct-test-",
  );
  try {
    const result = await runOutputProfile("direct-pty", directory, { probes: 3, warmupMs: 0 });
    expect(result.timedOut).toBe(false);
    expect(result.probes).toHaveLength(3);
    expect(result.probes.every((probe) => probe.childMs !== null && probe.visibleMs === null)).toBe(
      true,
    );
    const ready = JSON.parse(await readFile(join(directory, "ready-profile-0.json"), "utf8"));
    expect(ready).toMatchObject({ cols: 80, rows: 24 });
    expect(() => process.kill(ready.pid, 0)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capacity fixture owns exactly fifty panes, thirty tabs and ten complex producers", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-capacity-test-",
  );
  const capacity = await startCapacityProfile(directory);
  try {
    const snapshot = await capacity.fixture.client.snapshot();
    expect(snapshot.panes).toHaveLength(50);
    expect(snapshot.tabs).toHaveLength(30);
    expect(capacity.programPaneIds).toHaveLength(10);
    expect(capacity.idlePaneIds).toHaveLength(40);
    for (let label = 0; label < 10; label++) {
      expect(
        JSON.parse(await readFile(join(directory, `ready-profile-${label}.json`), "utf8")).pid,
      ).toBeGreaterThan(0);
    }
  } finally {
    await capacity.fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

test("native comparison observes actual rendered tokens rather than child receipt alone", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-native-test-",
  );
  try {
    const result = await runOutputProfile("native", directory, { probes: 3, warmupMs: 0 });
    expect(result.timedOut).toBe(false);
    expect(
      result.probes.every((probe) => probe.visibleMs !== null && probe.visibleMs >= probe.sentMs),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("application comparison matches the native grid and flushes enabled child traces", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-application-test-",
  );
  try {
    const result = await runOutputProfile("application", directory, {
      probes: 3,
      warmupMs: 0,
      diagnostics: true,
    });
    expect(result.probes).toHaveLength(3);
    const traces = (await readdir(directory)).filter(
      (name) => name.endsWith(".jsonl") && name.startsWith("tui-"),
    );
    expect(traces.length).toBeGreaterThan(0);
    expect(await readFile(join(directory, traces[0]!), "utf8")).toContain('"type":"summary"');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test("a producer startup timeout still reaps its owned subprocess", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-timeout-test-",
  );
  const original = Bun.spawn;
  let child: Bun.Subprocess | undefined;
  const capture = spyOn(Bun, "spawn").mockImplementation(((
    ...args: Parameters<typeof Bun.spawn>
  ) => {
    child = Reflect.apply(original, Bun, [
      [process.execPath, "-e", "setInterval(()=>{},1000)"],
      args[1],
    ]);
    return child;
  }) as typeof Bun.spawn);
  try {
    await expect(
      runOutputProfile("direct-pty", join(directory, "missing"), { probes: 3, warmupMs: 0 }),
    ).rejects.toThrow("profile producer ready");
    expect(await child!.exited).toBeGreaterThan(0);
    expect(() => process.kill(child!.pid, 0)).toThrow();
  } finally {
    capture.mockRestore();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await child.exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic ownership rejects PID zero before inspecting or signalling manifests", async () => {
  await expect(flushProfileProbes("/path-not-read", [0])).rejects.toThrow("owned root PID");
  await expect(flushProfileProbes("/path-not-read", [1])).rejects.toThrow("owned root PID");
});

test("diagnostic completion reads a bounded tail and never accepts an old footer after partial append", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/profile-footer-test-",
  );
  const path = join(directory, "trace.jsonl");
  try {
    await writeFile(path, "old data\n".repeat(1000000) + '{"type":"summary"}\n');
    const previous = (await stat(path)).size;
    expect(await readProfileFooter(path, 0)).toBe(true);
    expect(await readProfileFooter(path, previous)).toBe(false);
    await appendFile(path, '{"type":"event"');
    expect(await readProfileFooter(path, previous)).toBe(false);
    await appendFile(path, '\n{"type":"summary"}\n');
    expect(await readProfileFooter(path, previous)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

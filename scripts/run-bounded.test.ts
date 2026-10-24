import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBounded, stopOwnedProcess } from "./run-bounded";

const bun = process.execPath;
const supervisor = join(import.meta.dir, "run-bounded.ts");

function idle() {
  return Bun.spawn([bun, "-e", "setInterval(() => {}, 1000)"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

test("bounded commands preserve success and child failure statuses without retrying", async () => {
  expect(await runBounded([bun, "-e", "process.exit(0)"], 2000)).toBe(0);
  expect(await runBounded([bun, "-e", "process.exit(7)"], 2000)).toBe(7);
});

test("an external deadline interrupts a child whose event loop cannot run timers", async () => {
  const start = performance.now();
  expect(await runBounded([bun, "-e", "while (true) {}"], 250)).toBe(124);
  expect(performance.now() - start).toBeLessThan(5000);
}, 10000);

test("invalid commands and deadlines reject before execution", async () => {
  for (const deadline of [0, -1, NaN, Infinity, 0.5]) {
    await expect(runBounded([bun, "-e", "process.exit(0)"], deadline)).rejects.toThrow();
  }
  await expect(runBounded([], 1000)).rejects.toThrow();
});

test("the CLI forwards both streams and preserves a nonzero child exit", async () => {
  const child = Bun.spawn(
    [
      bun,
      supervisor,
      "2000",
      bun,
      "-e",
      'console.log("out"); console.error("err"); process.exit(7)',
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(7);
  expect(stdout).toContain("out");
  expect(stderr).toContain("err");
});

for (const outcome of ["timeout", "early exit", "interrupt"] as const) {
  test(`supervisor ${outcome} reaps detached owned descendants, not an unrelated process`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "work-craft-watchdog-"));
    const path = join(directory, "child.pid");
    const unrelated = idle();
    let owned: number | undefined;
    const program = `
      import { testProcessEnvironment } from ${JSON.stringify(supervisor)};
      if (${outcome === "early exit"} && Object.keys(testProcessEnvironment({})).some(key => key !== "WORK_CRAFT_TEST_RUN_ID")) {
        throw new Error("Clean fixture environment inherited unrelated variables");
      }
      const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        detached: true, ${outcome === "early exit" ? "env: testProcessEnvironment({})," : ""}
        stdin: "ignore", stdout: "ignore", stderr: "ignore"
      });
      await Bun.write(${JSON.stringify(path)}, String(child.pid));
      ${outcome === "early exit" ? "process.exit(0);" : "while (true) {}"}
    `;
    const launcher = Bun.spawn([bun, supervisor, "1000", bun, "-e", program], {
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const deadline = Date.now() + 3000;
      while (!(await Bun.file(path).exists()) && Date.now() < deadline) {
        await Bun.sleep(10);
      }
      owned = Number(await readFile(path, "utf8"));
      if (outcome === "interrupt") {
        launcher.kill("SIGTERM");
      }
      const stderr = await new Response(launcher.stderr).text();
      expect(await launcher.exited, stderr).toBe(
        outcome === "early exit" ? 0 : outcome === "timeout" ? 124 : 143,
      );
      expect(alive(owned)).toBe(false);
      expect(alive(unrelated.pid)).toBe(true);
    } finally {
      launcher.kill();
      await launcher.exited;
      if (owned && alive(owned)) {
        process.kill(owned, "SIGKILL");
      }
      unrelated.kill();
      await unrelated.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 10000);
}

test("cleanup does not signal a PID whose birth no longer matches the owned process", () => {
  const child = idle();
  try {
    stopOwnedProcess({ pid: child.pid, startedAt: "not the original process" });
    expect(alive(child.pid)).toBe(true);
  } finally {
    child.kill();
  }
});

test("cleanup accepts a process already gone but rejects uncertain observation", async () => {
  const child = Bun.spawn([bun, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" });
  await child.exited;
  expect(() => stopOwnedProcess({ pid: child.pid, startedAt: "gone" })).not.toThrow();
  const probe = spyOn(Bun, "spawnSync").mockImplementation(() => {
    throw new Error("process observation unavailable");
  });
  try {
    expect(() => stopOwnedProcess({ pid: child.pid, startedAt: "unknown" })).toThrow("observation");
  } finally {
    probe.mockRestore();
  }
});

test("incomplete process observation fails closed instead of waiting forever for the blocked child", async () => {
  const base = Bun.spawnSync(["true"]);
  for (const output of [
    "unparseable process output",
    `${process.pid} 1 Sat Oct 24 00:00:00 2026 unrelated`,
  ]) {
    const spawn = spyOn(Bun, "spawn");
    const probe = spyOn(Bun, "spawnSync").mockReturnValue({
      ...base,
      stdout: Buffer.from(output),
    });
    const result = runBounded([bun, "-e", "while (true) {}"], 100);
    try {
      expect(await Promise.race([result, Bun.sleep(500).then(() => "still blocked")])).toBe(1);
    } finally {
      probe.mockRestore();
      const child = spawn.mock.results[0]?.value as Bun.Subprocess | undefined;
      spawn.mockRestore();
      child?.kill("SIGKILL");
      await child?.exited;
      await result;
    }
  }
});

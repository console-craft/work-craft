import { expect, spyOn, test } from "bun:test";
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

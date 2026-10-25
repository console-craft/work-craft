import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOutputProbe } from "../output-probe.ts";

test("records 32768 events then counts discarded observations without event-time writes", () => {
  const writes: string[] = [];
  const probe = createOutputProbe(
    (text) => writes.push(text),
    () => 12,
  );
  for (let index = 0; index < 32769; index++) {
    probe.observe({
      stage: "native.write",
      bytes: 10,
      durationMs: 2,
      pending: index,
      cols: 20,
      rows: 6,
    });
  }
  expect(writes).toEqual([]);
  probe.flush();
  const records = writes
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.filter((record) => record.type === "event")).toHaveLength(32768);
  expect(records[0]).toMatchObject({ sequence: 1, monotonicMs: 12, cols: 20, rows: 6 });
  expect(records[32767].sequence).toBe(32768);
  expect(records.at(-1)).toMatchObject({ type: "summary", discarded: 1, valid: false });
  expect(records.at(-1).totals["native.write"]).toEqual({
    count: 32769,
    bytes: 327690,
    durationMs: 65538,
  });
  expect(records.at(-1).highWater["native.write"]).toEqual({ bytes: 10, pending: 32768 });
});

test("flush clears retained events and strips unexpected payload properties", () => {
  const writes: string[] = [];
  const probe = createOutputProbe(
    (text) => writes.push(text),
    () => 1,
  );
  const event = { stage: "pty.read", bytes: 4, data: "secret", credentials: "secret" };
  probe.observe(event);
  probe.flush();
  probe.flush();
  expect(writes.join("")).not.toContain("secret");
  const records = writes
    .at(-1)!
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ type: "summary", discarded: 0, valid: true });
});

test("flush failure does not throw into PTY or render callbacks", () => {
  const probe = createOutputProbe(
    () => {
      throw new Error("unwritable sink");
    },
    () => 0,
  );
  probe.observe({ stage: "pty.read" });
  expect(() => probe.flush()).not.toThrow();
  expect(() => probe.observe({ stage: "pty.read" })).not.toThrow();
});

test("aggregate-only observations retain counters and high-water without consuming detailed trace slots", () => {
  let text = "";
  const probe = createOutputProbe(
    (next) => {
      text = next;
    },
    () => 0,
  );
  for (let index = 0; index < 40000; index++) {
    probe.observe({ stage: "store.buffer", bytes: index, aggregateOnly: true });
  }
  probe.observe({ stage: "store.apply.end", cursor: 42 });
  probe.flush();
  const lines = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ stage: "store.apply.end", cursor: 42 });
  expect(lines[1]).toMatchObject({ valid: true, discarded: 0, aggregated: 40000 });
  expect(lines[1].highWater["store.buffer"].bytes).toBe(39999);
});

test("disabled recorder creates no files or signal handlers; enabled subprocess flushes on SIGUSR2", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-probe-test-"));
  const module = new URL("../output-probe.ts", import.meta.url).href;
  const disabled = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `const before=process.listenerCount("SIGUSR2");const m=await import(${JSON.stringify(module)});m.observeOutput({stage:"pty.read"});m.flushOutputProbe();console.log(process.listenerCount("SIGUSR2")-before);`,
    ],
    {
      env: { ...process.env, WORK_CRAFT_OUTPUT_PROFILE_DIR: "" },
    },
  );
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout.toString().trim()).toBe("0");
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const m=await import(${JSON.stringify(module)});m.observeOutput({stage:"pty.read",bytes:5});console.log("ready");setInterval(()=>{},1000);`,
    ],
    {
      env: {
        ...process.env,
        WORK_CRAFT_OUTPUT_PROFILE_DIR: directory,
        WORK_CRAFT_OUTPUT_PROFILE_ROLE: "harness",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
    reader.releaseLock();
    child.kill("SIGUSR2");
    const path = join(directory, `harness-server-${child.pid}.jsonl`);
    let text = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      text = await readFile(path, "utf8").catch(() => "");
      if (text.includes('"type":"summary"')) {
        break;
      }
      await Bun.sleep(10);
    }
    expect(text).toContain('"bytes":5');
    expect(text).toContain('"valid":true');
    expect((await readdir(directory)).some((name) => name.endsWith(".manifest.json"))).toBe(true);
  } finally {
    child.kill();
    await child.exited;
    await rm(directory, { recursive: true, force: true });
  }
});

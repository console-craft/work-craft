import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOutputProbe } from "@/client/output-probe";

test("client recorder bounds events and counts overflow without writing on the input path", () => {
  const writes: string[] = [];
  const probe = createOutputProbe(
    (text) => writes.push(text),
    () => 3,
  );
  for (let index = 0; index < 32769; index++) {
    probe.observe({ stage: "native.write", bytes: 2, pending: index });
  }
  expect(writes).toEqual([]);
  probe.flush();
  const records = writes
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.filter((record) => record.type === "event")).toHaveLength(32768);
  expect(records.at(-1)).toMatchObject({ type: "summary", valid: false, discarded: 1 });
  expect(records.at(-1).highWater["native.write"]).toEqual({ bytes: 2, pending: 32768 });
});

test("client recorder strips payload and isolates sink failures", () => {
  let text = "";
  const probe = createOutputProbe(
    (next) => {
      text = next;
    },
    () => 0,
  );
  const event = { stage: "native.write", data: "private terminal bytes" };
  probe.observe(event);
  probe.flush();
  expect(text).not.toContain("private terminal bytes");
  const failed = createOutputProbe(
    () => {
      throw new Error("disk full");
    },
    () => 0,
  );
  failed.observe({ stage: "frame" });
  expect(() => failed.flush()).not.toThrow();
});

test("TUI probe initializes only its own files and signal handler", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-tui-probe-test-"));
  const module = new URL("../output-probe.ts", import.meta.url).href;
  try {
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `const before=process.listenerCount("SIGUSR2");const m=await import(${JSON.stringify(module)});m.observeOutput({stage:"frame",bytes:7});process.emit("SIGUSR2");console.log(process.listenerCount("SIGUSR2")-before);`,
      ],
      {
        env: {
          ...process.env,
          WORK_CRAFT_OUTPUT_PROFILE_DIR: directory,
          WORK_CRAFT_OUTPUT_PROFILE_ROLE: "harness",
        },
      },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(child.stdout.toString().trim()).toBe("1");
    const name = `harness-tui-${child.pid}`;
    expect((await readdir(directory)).sort()).toEqual([`${name}.jsonl`, `${name}.manifest.json`]);
    expect(
      JSON.parse(await readFile(join(directory, `${name}.manifest.json`), "utf8")),
    ).toMatchObject({
      role: "harness",
      component: "tui",
      pid: child.pid,
    });
    const records = (await readFile(join(directory, `${name}.jsonl`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ stage: "frame", bytes: 7 });
    expect(records.at(-1)).toMatchObject({ type: "summary", valid: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { createOutputProbe } from "@/client/output-probe";
import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

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

test("normal daemon and TUIs flush correlated stages without logging terminal text", async () => {
  const directory = await mkdtemp(
    "/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/probe-integration-",
  );
  const fixture = await startSharedSessionFixture({ profileDirectory: directory });
  try {
    const [a] = fixture.tuis;
    await focusSharedTerminal(a);
    sharedWrite(a, "printf '\\nPRIVATE_PROBE_READY\\n'\r");
    await sharedWait(
      () => a.frame().includes("PRIVATE_PROBE_READY"),
      "probe input reaches child and display",
      a.frame,
    );
    await Bun.sleep(100);
    const manifests = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith(".manifest.json"))
        .map(async (name) => ({
          name,
          ...JSON.parse(await readFile(join(directory, name), "utf8")),
        })),
    );
    expect(manifests.filter((entry) => entry.role === "daemon")).toHaveLength(1);
    expect(
      new Set(manifests.filter((entry) => entry.role === "tui").map((entry) => entry.pid)).size,
    ).toBe(2);
    for (const pid of new Set<number>(manifests.map((entry) => entry.pid))) {
      process.kill(pid, "SIGUSR2");
    }
    await sharedWait(async () => {
      const texts = await Promise.all(
        manifests.map((entry) =>
          readFile(join(directory, entry.name.replace(".manifest.json", ".jsonl")), "utf8").catch(
            () => "",
          ),
        ),
      );
      return texts.every((text) => text.includes('"type":"summary"'));
    }, "all probe components finish flushing");
    const text = (
      await Promise.all(
        manifests.map((entry) =>
          readFile(join(directory, entry.name.replace(".manifest.json", ".jsonl")), "utf8"),
        ),
      )
    ).join("");
    for (const stage of [
      "pty.read",
      "history.append",
      "socket.send",
      "socket.receive",
      "store.enqueue",
      "store.apply.end",
      "native.write.end",
      "native.create",
      "frame",
    ]) {
      expect(text).toContain(`"stage":"${stage}"`);
    }
    expect(text).not.toContain("PRIVATE_PROBE_READY");
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

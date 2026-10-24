import { expect, test } from "bun:test";

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

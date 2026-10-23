import { expect, test } from "bun:test";

import type { SemanticTerminalInput } from "@work-craft/server/client";

import { createTerminalInput } from "@/workbench/terminal-input";

const key: SemanticTerminalInput = { kind: "key", key: { text: "x" } };

test("input waits for its finite applied-frame readiness and retains its original sender", async () => {
  const sent: string[] = [];
  let ready = false;
  let sender = "original";
  const queue = createTerminalInput({
    ready: () => ready,
    capture() {
      const captured = sender;
      return {
        valid: () => true,
        send: async () => {
          sent.push(captured);
          return { forwarded: true };
        },
      };
    },
    onResult() {},
    onError(error) {
      throw error;
    },
  });
  queue.admit(key);
  sender = "replacement";
  await queue.flush();
  expect(sent).toEqual([]);
  ready = true;
  await queue.flush();
  expect(sent).toEqual(["original"]);
  expect(queue.bytes).toBe(0);
  queue.close();
});

test("FIFO input charges the in-flight request until its acknowledgement", async () => {
  const sent: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = createTerminalInput({
    ready: () => true,
    capture: () => ({
      valid: () => true,
      async send(input) {
        sent.push(input.kind);
        if (sent.length === 1) {
          await held;
        }
        return { forwarded: true };
      },
    }),
    onResult() {},
    onError(error) {
      throw error;
    },
  });
  queue.admit(key);
  queue.admit({ kind: "focus", focused: true });
  await Promise.resolve();
  expect(sent).toEqual(["key"]);
  expect(queue.bytes).toBe(257);
  release();
  await queue.flush();
  expect(sent).toEqual(["key", "focus"]);
  expect(queue.bytes).toBe(0);
  queue.close();
});

test("scope is rechecked before send and teardown aborts an admitted in-flight request", async () => {
  let ready = false;
  let valid = true;
  let sent = 0;
  let aborted = false;
  const queue = createTerminalInput({
    ready: () => ready,
    capture: () => ({
      valid: () => valid,
      send: (_input, signal) => {
        sent++;
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    }),
    onResult() {},
    onError(error) {
      throw error;
    },
  });
  queue.admit(key);
  valid = false;
  ready = true;
  await queue.flush();
  expect(sent).toBe(0);
  valid = true;
  queue.admit(key);
  await Promise.resolve();
  queue.close();
  await queue.flush();
  expect(aborted).toBe(true);
  expect(queue.bytes).toBe(0);
});

test("paste plus descriptor admits exactly eight MiB and rejects oversized or subsequent work", async () => {
  let ready = false;
  const errors: string[] = [];
  const queue = createTerminalInput({
    ready: () => ready,
    capture: () => ({ valid: () => true, send: async () => ({ forwarded: true }) }),
    onResult() {},
    onError: (error) => errors.push(error.message),
  });
  expect(queue.admit({ kind: "paste", bytes: new Uint8Array(8388481) })).toBe(false);
  expect(queue.bytes).toBe(0);
  for (let round = 0; round < 2; round++) {
    ready = false;
    expect(queue.admit({ kind: "paste", bytes: new Uint8Array(8388480) })).toBe(true);
    expect(queue.bytes).toBe(8388608);
    expect(queue.admit(key)).toBe(false);
    expect(queue.bytes).toBe(8388608);
    ready = true;
    await queue.flush();
    expect(queue.bytes).toBe(0);
  }
  expect(errors).toHaveLength(3);
  queue.close();
});

test("zero-payload events still consume bounded descriptor space", () => {
  const queue = createTerminalInput({
    ready: () => false,
    capture: () => ({ valid: () => true, send: async () => ({ forwarded: false }) }),
    onResult() {},
    onError() {},
  });
  for (let index = 0; index < 65536; index++) {
    queue.admit({ kind: "focus", focused: true });
  }
  expect(queue.bytes).toBe(8388608);
  expect(queue.admit({ kind: "focus", focused: false })).toBe(false);
  queue.close();
  expect(queue.bytes).toBe(0);
});

test("ready input still yields before sending so synchronous scope revocation can cancel it", async () => {
  let valid = true;
  let sent = 0;
  const queue = createTerminalInput({
    ready: () => true,
    capture: () => ({
      valid: () => valid,
      send: async () => {
        sent++;
        return { forwarded: true };
      },
    }),
    onResult() {},
    onError(error) {
      throw error;
    },
  });
  queue.admit(key);
  valid = false;
  await queue.flush();
  expect(sent).toBe(0);
  expect(queue.bytes).toBe(0);
  queue.close();
});

test("each input retains a finite picture frontier without newer output extending its wait", async () => {
  let received = 1;
  let presented = 0;
  let sent = 0;
  const queue = createTerminalInput({
    ready: () => true,
    capture() {
      const required = received;
      return {
        ready: () => presented >= required,
        valid: () => true,
        send: async () => {
          sent++;
          return { forwarded: true };
        },
      };
    },
    onResult() {},
    onError(error) {
      throw error;
    },
  });
  queue.admit(key);
  await queue.flush();
  expect(sent).toBe(0);
  received = 20;
  presented = 1;
  await queue.flush();
  expect(sent).toBe(1);
  queue.close();
});

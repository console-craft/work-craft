import { expect, test } from "bun:test";

import type { EmbeddedTerminalInputRequest } from "@opentui/core";

import * as input from "@/workbench/terminal-input";

function fixture() {
  expect(typeof input.createTerminalInput).toBe("function");
  let scope = 1;
  let eligible = true;
  let recoveries = 0;
  let schedules = 0;
  const frontier = { cursor: 5, gridSequence: 2 };
  const first: string[] = [];
  const second: string[] = [];
  let sender = first;
  const cancelled: string[] = [];
  const queue = input.createTerminalInput({
    capture() {
      if (!eligible) {
        return null;
      }
      const generation = scope;
      const destination = sender;
      return {
        frontier,
        valid: () => eligible && scope === generation,
        send: (bytes) => destination.push(new TextDecoder().decode(bytes)),
      };
    },
    request: () => {
      schedules++;
    },
    overflow: () => {
      recoveries++;
      eligible = false;
    },
  });
  function request(id: string, bytes = 0, beforeSend?: () => void): EmbeddedTerminalInputRequest {
    let settled = false;
    return {
      event: { kind: "paste", byteLength: bytes },
      payloadBytes: bytes,
      cancel() {
        if (!settled) {
          settled = true;
          cancelled.push(id);
        }
      },
      resume(send) {
        if (!settled) {
          settled = true;
          beforeSend?.();
          send(new TextEncoder().encode(id));
        }
      },
    };
  }
  return {
    queue,
    frontier,
    first,
    second,
    cancelled,
    request,
    revoke: () => {
      scope++;
    },
    changeSender: () => {
      sender = second;
    },
    recoveries: () => recoveries,
    schedules: () => schedules,
  };
}

test("input holds its original finite byte and marker frontier and sender", () => {
  const f = fixture();
  f.queue.admit(f.request("original"));
  f.changeSender();
  f.frontier.cursor = 10;
  f.frontier.gridSequence = 3;
  expect(f.queue.frontier()).toEqual({ cursor: 5, gridSequence: 2 });
  expect(f.queue.step({ cursor: 4, gridSequence: 2 })).toBe(false);
  expect(f.queue.step({ cursor: 5, gridSequence: 1 })).toBe(false);
  expect(f.first).toEqual([]);
  expect(f.queue.step({ cursor: 5, gridSequence: 2 })).toBe(true);
  expect(f.first).toEqual(["original"]);
  expect(f.second).toEqual([]);
  expect(f.queue.frontier()).toBeUndefined();
  expect(f.queue.step({ cursor: 10, gridSequence: 3 })).toBe(false);
});

test("even ready input schedules and settles only one FIFO item per quantum", () => {
  const f = fixture();
  f.queue.admit(f.request("one"));
  f.queue.admit(f.request("two"));
  expect(f.first).toEqual([]);
  expect(f.schedules()).toBe(2);
  expect(f.queue.step(f.frontier)).toBe(true);
  expect(f.first).toEqual(["one"]);
  expect(f.queue.step(f.frontier)).toBe(true);
  expect(f.first).toEqual(["one", "two"]);
});

test.each(["scope", "clear", "close"] as const)(
  "%s cancels pending input without encoding or forwarding",
  (action) => {
    const f = fixture();
    f.queue.admit(f.request("stale"));
    if (action === "scope") {
      f.revoke();
      expect(f.queue.step(null)).toBe(true);
    } else {
      f.queue[action]();
    }
    expect(f.cancelled).toEqual(["stale"]);
    expect(f.first).toEqual([]);
    expect(f.queue.frontier()).toBeUndefined();
    f.queue.close();
    f.queue.admit(f.request("after-close"));
    expect(f.cancelled).toEqual(["stale", "after-close"]);
    expect(f.first).toEqual([]);
  },
);

test("scope is rechecked immediately before sending encoded input", () => {
  const f = fixture();
  f.queue.admit(f.request("revoked-during-encode", 0, f.revoke));
  f.queue.step(f.frontier);
  expect(f.first).toEqual([]);
});

test("payload plus descriptor charge admits exactly eight MiB and rejects the next event", () => {
  const f = fixture();
  f.queue.admit(f.request("limit", 8 * 1024 * 1024 - 128));
  expect(f.recoveries()).toBe(0);
  f.queue.admit(f.request("overflow"));
  expect(f.cancelled).toEqual(["overflow", "limit"]);
  expect(f.recoveries()).toBe(1);
  expect(f.queue.frontier()).toBeUndefined();
  expect(f.first).toEqual([]);
});

test("an oversized single paste is cancelled without retaining a queue entry", () => {
  const f = fixture();
  f.queue.admit(f.request("oversized", 8 * 1024 * 1024));
  expect(f.cancelled).toEqual(["oversized"]);
  expect(f.recoveries()).toBe(1);
  expect(f.queue.frontier()).toBeUndefined();
});

test("zero-payload input cannot grow beyond the descriptor accounting limit", () => {
  const f = fixture();
  for (let index = 0; index < 65536; index++) {
    f.queue.admit(f.request(`${index}`));
  }
  expect(f.recoveries()).toBe(0);
  f.queue.admit(f.request("overflow"));
  expect(f.recoveries()).toBe(1);
  expect(f.cancelled).toHaveLength(65537);
  expect(f.first).toEqual([]);
  expect(f.queue.frontier()).toBeUndefined();
});

test("consuming repeated full queues releases accounting for subsequent input", () => {
  const f = fixture();
  for (let index = 0; index < 200; index++) {
    f.queue.admit(f.request(`${index}`, 8 * 1024 * 1024 - 128));
    expect(f.queue.step(f.frontier)).toBe(true);
  }
  expect(f.first).toHaveLength(200);
  expect(f.recoveries()).toBe(0);
  expect(f.queue.frontier()).toBeUndefined();
});

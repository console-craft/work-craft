import { expect, test } from "bun:test";

import {
  createPasteReceiver,
  sendProjectionInput,
} from "../test-support/terminal-projection-paste";
import type { PasteMessage, ProjectionStamp } from "../test-support/terminal-projection-types";

const stamp: ProjectionStamp = {
  epoch: "e",
  runtime: "r",
  attachment: 1,
  navigation: 2,
  geometry: 3,
};
const begin: PasteMessage = { type: "paste.begin", id: "paste-a", stamp, total: 3 };
const chunk: PasteMessage = { type: "paste.chunk", id: "paste-a", stamp, offset: 0, data: "YWJj" };
const commit: PasteMessage = { type: "paste.commit", id: "paste-a", stamp };

test("paste bounds are checked before allocating and duplicate chunks cannot commit", () => {
  const receiver = createPasteReceiver();
  try {
    for (const total of [-1, 0.5, 8388481, Number.MAX_SAFE_INTEGER]) {
      expect(() => receiver.accept({ ...begin, total }, stamp)).toThrow();
      expect(receiver.bytes).toBe(0);
    }
    receiver.accept(begin, stamp);
    receiver.accept(chunk, stamp);
    expect(() => receiver.accept(chunk, stamp)).toThrow();
    expect(receiver.bytes).toBe(0);
  } finally {
    receiver.clear();
  }
});

test("each revoked authority generation discards incomplete paste", () => {
  for (const field of Object.keys(stamp) as (keyof ProjectionStamp)[]) {
    const receiver = createPasteReceiver();
    try {
      receiver.accept(begin, stamp);
      receiver.accept(chunk, stamp);
      const current = {
        ...stamp,
        [field]: typeof stamp[field] === "number" ? Number(stamp[field]) + 2 : "replacement",
      };
      expect(() => receiver.accept(commit, current)).toThrow("stale");
      expect(receiver.bytes).toBe(0);
    } finally {
      receiver.clear();
    }
  }
});

test("receiver snapshots only trusted authority fields instead of retaining unknown stamp data", () => {
  const receiver = createPasteReceiver();
  const untrusted = Object.defineProperty({ ...stamp }, "unknown", {
    enumerable: true,
    get() {
      throw new Error("Unknown stamp field was copied");
    },
  });
  try {
    expect(() => receiver.accept({ ...begin, stamp: untrusted }, stamp)).not.toThrow();
    receiver.accept(chunk, stamp);
    expect(receiver.accept(commit, stamp)).toEqual(new Uint8Array([97, 98, 99]));
  } finally {
    receiver.clear();
  }
});

test("aborting an in-flight sender cancels its original paste without committing", async () => {
  const controller = new AbortController();
  const receiver = createPasteReceiver();
  const sent: string[] = [];
  try {
    await expect(
      sendProjectionInput(
        { stamp, input: { kind: "paste", bytes: [97, 98, 99] } },
        async (message) => {
          if (!("type" in message)) {
            throw new Error("Expected paste wire message");
          }
          sent.push(message.type);
          const completed = receiver.accept(message, stamp);
          expect(completed).toBeNull();
          if (message.type === "paste.chunk") {
            controller.abort();
          }
          return {};
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(sent).toEqual(["paste.begin", "paste.chunk", "paste.cancel"]);
    expect(receiver.bytes).toBe(0);
  } finally {
    receiver.clear();
  }
});

test("failed requests and stale responses cancel without retries", async () => {
  for (const stale of [false, true]) {
    const receiver = createPasteReceiver();
    const sent: string[] = [];
    try {
      await expect(
        sendProjectionInput({ stamp, input: { kind: "paste", bytes: [97] } }, async (message) => {
          if (!("type" in message)) {
            throw new Error("Expected paste wire message");
          }
          sent.push(message.type);
          if (message.type === "paste.chunk") {
            if (stale) {
              return { stale: true };
            }
            throw new Error("request failed");
          }
          receiver.accept(message, stamp);
          return {};
        }),
      ).rejects.toThrow();
      expect(sent).toEqual(["paste.begin", "paste.chunk", "paste.cancel"]);
      expect(receiver.bytes).toBe(0);
    } finally {
      receiver.clear();
    }
  }
});

test("clearing partial paste permits a fresh transfer and empty paste commits once", async () => {
  const receiver = createPasteReceiver();
  try {
    receiver.accept(begin, stamp);
    receiver.clear();
    let completed: Uint8Array | null = null;
    await sendProjectionInput({ stamp, input: { kind: "paste", bytes: [] } }, async (message) => {
      if (!("type" in message)) {
        throw new Error("Expected paste wire message");
      }
      completed = receiver.accept(message, stamp);
      return {};
    });
    expect(completed as Uint8Array | null).toEqual(new Uint8Array());
    expect(receiver.bytes).toBe(0);
  } finally {
    receiver.clear();
  }
});

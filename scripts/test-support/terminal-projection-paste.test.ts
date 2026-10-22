import { expect, test } from "bun:test";

import { createPasteReceiver, sendProjectionInput } from "./terminal-projection-paste";
import type { PasteMessage, ProjectionStamp } from "./terminal-projection-types";

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

test("chunked paste retains exact bytes and commits once", async () => {
  const receiver = createPasteReceiver();
  const received: Uint8Array[] = [];
  let offset = 0;
  let requests = 0;
  try {
    await sendProjectionInput(
      { stamp, input: { kind: "paste", bytes: Array.from({ length: 3145728 }, () => 120) } },
      async (message) => {
        expect("type" in message).toBe(true);
        if (!("type" in message)) {
          throw new Error("Numeric paste must not reach wire");
        }
        expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(90000);
        if (message.type === "paste.chunk") {
          expect(message.offset).toBe(offset);
          const bytes = Buffer.from(message.data, "base64");
          expect(bytes.length).toBeLessThanOrEqual(65536);
          offset += bytes.length;
        }
        const result = receiver.accept(message, stamp);
        if (message.type !== "paste.commit") {
          expect(result).toBeNull();
        }
        if (result) {
          received.push(result);
        }
        requests++;
        return {};
      },
    );
    expect(offset).toBe(3145728);
    expect(requests).toBe(50);
    expect(received).toHaveLength(1);
    expect(Buffer.from(received[0]!)).toEqual(Buffer.alloc(3145728, 120));
    expect(receiver.bytes).toBe(0);
    expect(() => receiver.accept(commit, stamp)).toThrow();
  } finally {
    receiver.clear();
  }
});

test("malformed paste chunks release storage without committing", () => {
  const invalid: PasteMessage[] = [
    { ...chunk, data: "!!!=" },
    { ...chunk, data: "YQ" },
    { ...chunk, data: "YR==" },
    { ...chunk, offset: 1 },
    { ...chunk, offset: -1 },
    { ...chunk, data: "YWJjZA==" },
    { ...chunk, data: "eA==".repeat(65536) },
    { ...chunk, id: "different" },
    { ...begin, id: "other-paste" },
    commit,
  ];
  for (const message of invalid) {
    const receiver = createPasteReceiver();
    try {
      receiver.accept(begin, stamp);
      expect(receiver.bytes).toBe(131);
      expect(() => receiver.accept(message, stamp)).toThrow();
      expect(receiver.bytes).toBe(0);
    } finally {
      receiver.clear();
    }
  }
});

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

test("partial paste expires while idle", async () => {
  const receiver = createPasteReceiver();
  try {
    receiver.accept(begin, stamp);
    expect(receiver.bytes).toBe(131);
    await Bun.sleep(4100);
    expect(receiver.bytes).toBe(0);
    expect(() => receiver.accept(commit, stamp)).toThrow();
  } finally {
    receiver.clear();
  }
}, 5000);

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

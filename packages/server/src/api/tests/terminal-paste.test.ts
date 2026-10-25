import { expect, test } from "bun:test";

import { createPasteReceiver } from "../terminal-paste";

const stamp = {
  epoch: "e",
  paneId: "p",
  attachmentGeneration: 1,
  navigationGeneration: 2,
  geometrySequence: 3,
  runtimeGeneration: 4,
  source: "input" as const,
  kind: "paste" as const,
  activitySequence: 5,
};

test("partial paste cannot borrow another real pane or authority generation", () => {
  for (const field of [
    "paneId",
    "attachmentGeneration",
    "navigationGeneration",
    "geometrySequence",
    "runtimeGeneration",
    "activitySequence",
  ] as const) {
    const receiver = createPasteReceiver();
    try {
      receiver.accept({ type: "paste.begin", id: "a", stamp, total: 1 }, stamp);
      const current = {
        ...stamp,
        [field]: field === "paneId" ? "other" : (stamp[field] as number) + 1,
      };
      expect(() =>
        receiver.accept({ type: "paste.chunk", id: "a", stamp, offset: 0, data: "eA==" }, current),
      ).toThrow("stale");
      expect(receiver.bytes).toBe(0);
    } finally {
      receiver.clear();
    }
  }
});

test("unrelated late errors cannot cancel another paste and canonical bytes commit once", () => {
  const receiver = createPasteReceiver();
  try {
    receiver.accept({ type: "paste.begin", id: "a", stamp, total: 3 }, stamp);
    expect(receiver.bytes).toBe(131);
    expect(() =>
      receiver.accept({ type: "paste.chunk", id: "other", stamp, offset: 0, data: "!!!!" }, stamp),
    ).toThrow();
    expect(receiver.bytes).toBe(131);
    receiver.accept({ type: "paste.chunk", id: "a", stamp, offset: 0, data: "YWJj" }, stamp);
    expect(receiver.accept({ type: "paste.commit", id: "a", stamp }, stamp)).toEqual(
      Buffer.from("abc"),
    );
    expect(receiver.bytes).toBe(0);
    expect(() => receiver.accept({ type: "paste.commit", id: "a", stamp }, stamp)).toThrow();
  } finally {
    receiver.clear();
  }
});

test("malformed owner chunks and whole-paste overflow clear only their own retained work", () => {
  const receiver = createPasteReceiver();
  try {
    expect(() =>
      receiver.accept({ type: "paste.begin", id: "a", stamp, total: 8388481 }, stamp),
    ).toThrow("limit");
    for (const data of ["eB==", "eA=", Buffer.alloc(65537).toString("base64")]) {
      receiver.accept({ type: "paste.begin", id: "a", stamp, total: 65537 }, stamp);
      expect(() =>
        receiver.accept({ type: "paste.chunk", id: "a", stamp, offset: 0, data }, stamp),
      ).toThrow("chunk");
      expect(receiver.bytes).toBe(0);
    }
  } finally {
    receiver.clear();
  }
});

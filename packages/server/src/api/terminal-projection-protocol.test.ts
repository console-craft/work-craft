import { expect, test } from "bun:test";

import { parseInteractiveMessage } from "./interactive-protocol";

const context = {
  epoch: "e",
  attachmentGeneration: 1,
  navigationGeneration: 2,
  geometrySequence: 3,
  runtimeGeneration: 4,
};

test("material requests preserve the original real input scope and local scroll offset", () => {
  const message = {
    type: "terminal.material",
    requestId: 2,
    paneId: "p",
    context,
    scrollOffset: 3,
  } as const;
  expect(parseInteractiveMessage(message)).toEqual(message);
});

test("semantic requests preserve Kitty metadata and captured physical activity", () => {
  const message = {
    type: "terminal.semantic",
    requestId: 3,
    paneId: "p",
    context: { ...context, source: "input", kind: "key", activitySequence: 7 },
    input: {
      kind: "key",
      key: {
        key: "key_a",
        text: "λ",
        action: "release",
        mods: 4,
        consumedMods: 4,
        composing: false,
        unshiftedCodepoint: 97,
      },
    },
  } as const;
  expect(parseInteractiveMessage(message)).toEqual(message);
});

test("projection input rejects missing identities, forged metadata and unchunked paste", () => {
  const good = {
    type: "terminal.semantic",
    requestId: 3,
    paneId: "p",
    context: { ...context, source: "input", kind: "key" },
    input: { kind: "key", key: { key: "key_x", text: "x" } },
  };
  for (const bad of [
    { ...good, requestId: 0 },
    { ...good, context: { ...good.context, runtimeGeneration: undefined } },
    { ...good, context: { ...good.context, geometrySequence: -1 } },
    { ...good, context: { ...good.context, source: "response" } },
    { ...good, context: { ...good.context, kind: "mouse" } },
    { ...good, input: { kind: "key", key: { mods: 256 } } },
    { ...good, input: { kind: "key", key: { action: "wrong" } } },
    { ...good, input: { kind: "key", key: { composing: "yes" } } },
    { ...good, input: { kind: "key", key: { unshiftedCodepoint: 0x110000 } } },
    { ...good, input: { kind: "key", key: { text: "x".repeat(8388609) } } },
    { ...good, input: { kind: "paste", bytes: [120] } },
    { ...good, input: { kind: "mouse", mouse: { action: "press", x: NaN, y: 0 } } },
  ]) {
    expect(() => parseInteractiveMessage(bad)).toThrow();
  }
});

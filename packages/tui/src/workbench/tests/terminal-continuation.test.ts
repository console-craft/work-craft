import { expect, test } from "bun:test";

import {
  EmbeddedTerminalRenderable,
  KeyEvent,
  parseKeypress,
  resolveRenderLib,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

const encode = (text: string) => new TextEncoder().encode(text);

for (const [name, prefix, suffix] of [
  ["UTF-8 and split CSI/OSC", "λ🙂\x1b[2;3H\x1b]2;title\x07", "字\x1b[6n"],
  [
    "active/alternate screens and saved cursor",
    "main\x1b7\x1b[?1049hALT\x1b7",
    "\x1b[4;8Hx\x1b8Y\x1b[?1049l\x1b8Z",
  ],
  ["scroll regions and wrapping", "\x1b[2;5r\x1b[5;1Habcdefghijklmnopqrst", "UVWXYZ\nnext\x1b[6n"],
  ["style continuation", "\x1b[31;44;1mred", "styled\x1b[0mplain"],
  [
    "paste, mouse and application cursor modes",
    "\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1h",
    "ready\x1b[6n",
  ],
] as const) {
  test(`native continuation preserves ${name} across byte boundaries`, async () => {
    const bytes = encode(prefix);
    const uninterrupted = await runContinuation([bytes], [encode(suffix)], []);
    const split = await runContinuation(
      Array.from(bytes, (byte) => new Uint8Array([byte])),
      [encode(suffix)],
      [],
    );
    expect(split).toEqual(uninterrupted);
  });
}

test("native parser survives two ordered resizes at the same byte boundary", async () => {
  const prefix = encode("\x1b[2;");
  const suffix = [encode("3Hmarker\x1b[6n")];
  const sizes = [
    { cols: 30, rows: 8 },
    { cols: 25, rows: 7 },
  ];
  const whole = await runContinuation(
    [prefix],
    suffix,
    sizes.map((size) => ({ afterChunk: 1, ...size })),
  );
  const split = await runContinuation(
    Array.from(prefix, (byte) => new Uint8Array([byte])),
    suffix,
    sizes.map((size) => ({ afterChunk: prefix.byteLength, ...size })),
  );
  expect(split).toEqual(whole);
});

test("reset-plus-tail is not a checkpoint when an old mode has rolled out of history", async () => {
  const tail = encode("\x1b[H".repeat(400000) + "same visible screen");
  const full = await runContinuation([encode("\x1b[?2004h"), tail], [], []);
  const resetTail = await runContinuation(
    [encode("\x1bc"), tail.subarray(tail.byteLength - 1048576)],
    [],
    [],
  );
  expect(full.text).toBe(resetTail.text);
  expect(full.encodedInputs[1]).not.toEqual(resetTail.encodedInputs[1]);
});

test("headless mouse encoding preserves enabled modes across split instructions", () => {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 32, renderCellsMax: 2000 });
  const terminal = lib.createContextEmbeddedTerminal(context, {
    cols: 20,
    rows: 6,
    maxScrollback: 0,
  });
  const mouse = { action: "press", button: "left", x: 2, y: 1 } as const;
  try {
    expect(lib.contextEmbeddedTerminalEncodeMouse(context, terminal, mouse)).toHaveLength(0);
    for (const byte of encode("\x1b[?1000h\x1b[?1006h")) {
      lib.contextEmbeddedTerminalWrite(context, terminal, new Uint8Array([byte]));
    }
    expect(
      new TextDecoder().decode(lib.contextEmbeddedTerminalEncodeMouse(context, terminal, mouse)),
    ).toBe("\x1b[<0;3;2M");
  } finally {
    lib.destroyContextEmbeddedTerminal(context, terminal);
    lib.destroyContext(context);
  }
});

test("headless public buffer leases resolve Unicode text without exporting parser handles", () => {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 32, renderCellsMax: 2000 });
  const terminal = lib.createContextEmbeddedTerminal(context, { cols: 20, rows: 6 });
  const target = lib.createContextBuffer(context, { width: 20, height: 6 });
  try {
    lib.contextEmbeddedTerminalWrite(context, terminal, encode("\x1b[31mλ🙂\x1b[0m"));
    lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
    const lease = lib.contextAcquireBufferLease(context, target);
    try {
      const size = lib.contextBufferLeaseGetRealCharSize(context, lease.handle, true);
      const bytes = new Uint8Array(size);
      const lengths = new Uint8Array(20 * 6);
      expect(
        lib.contextBufferLeaseWriteResolvedChars(context, lease.handle, bytes, true, lengths),
      ).toBe(size);
      expect(new TextDecoder().decode(bytes)).toContain("λ🙂");
    } finally {
      lib.contextReleaseBufferLease(context, lease.handle);
    }
  } finally {
    lib.destroyContextBuffer(context, target);
    lib.destroyContextEmbeddedTerminal(context, terminal);
    lib.destroyContext(context);
  }
});

test("public native context can parse and answer a query without a terminal renderer", () => {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 32, renderCellsMax: 2000 });
  const terminal = lib.createContextEmbeddedTerminal(context, {
    cols: 20,
    rows: 6,
    maxScrollback: 0,
  });
  const target = lib.createContextBuffer(context, { width: 20, height: 6 });
  try {
    lib.contextEmbeddedTerminalWrite(context, terminal, encode("\x1b[2;3H\x1b[6n"));
    expect(
      new TextDecoder().decode(lib.contextEmbeddedTerminalDrainResponses(context, terminal)),
    ).toBe("\x1b[2;3R");
    lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
    expect(lib.contextEmbeddedTerminalCursor(context, terminal)).toMatchObject({ x: 2, y: 1 });
  } finally {
    lib.destroyContextBuffer(context, target);
    lib.destroyContextEmbeddedTerminal(context, terminal);
    lib.destroyContext(context);
  }
});

async function runContinuation(
  prefix: Uint8Array[],
  suffix: Uint8Array[],
  resizes: { afterChunk: number; cols: number; rows: number }[],
): Promise<{
  text: string;
  cursor: { x: number; y: number; visible: boolean };
  replies: Uint8Array[];
  encodedInputs: Uint8Array[];
  spans: unknown;
}> {
  const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
  const replies: Uint8Array[] = [];
  const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
    id: "continuation",
    cols: 20,
    rows: 6,
    width: 20,
    height: 6,
    onData(bytes, source) {
      if (source === "response") {
        replies.push(bytes.slice());
      }
    },
  });
  setup.renderer.root.add(terminal);
  try {
    for (const [index, bytes] of prefix.entries()) {
      terminal.write(bytes);
      for (const size of resizes.filter((marker) => marker.afterChunk === index + 1)) {
        terminal.width = size.cols;
        terminal.height = size.rows;
        await setup.flush();
      }
    }
    for (const bytes of suffix) {
      terminal.write(bytes);
    }
    await setup.flush();
    const screen = terminal.screen();
    return {
      text: screen.text,
      cursor: screen.cursor,
      replies: [Buffer.concat(replies)],
      encodedInputs: [
        terminal.encodeKey(new KeyEvent(parseKeypress("\x1b[A")!)),
        terminal.encodePaste(encode("paste")),
      ],
      spans: setup.captureSpans(),
    };
  } finally {
    setup.renderer.destroy();
  }
}

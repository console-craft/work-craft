import { toArrayBuffer } from "bun:ffi";
// Opt-in isolated upstream compatibility characterization, not product acceptance.
import { expect, test } from "bun:test";

import {
  EmbeddedTerminalRenderable,
  KeyEvent,
  MouseEvent,
  parseKeypress,
  resolveRenderLib,
  RGBA,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("stock control reproduces stale arrow encoding before parsing received modes", async () => {
  const setup = await createTestRenderer({ width: 30, height: 6 });
  try {
    const output: string[] = [];
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 30,
      height: 6,
      onData: (bytes) => output.push(decode(bytes)),
    });
    setup.renderer.root.add(terminal);
    expect("onInputAdmission" in terminal).toBe(false);
    terminal.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    terminal.write("\x1b[?1h");
    terminal.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    expect(output).toEqual(["\x1b[A", "\x1bOA"]);
  } finally {
    await setup.dispose();
  }
});

test("public listeners defer key paste and Kitty release encoding without replacing methods", async () => {
  const setup = await createTestRenderer({ width: 30, height: 6, kittyKeyboard: true });
  try {
    const output: string[] = [];
    const pending: (() => void)[] = [];
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 30,
      height: 6,
      onData: (bytes) => output.push(decode(bytes)),
    });
    setup.renderer.root.add(terminal);
    terminal.focus();
    function captureKey(event: KeyEvent): void {
      event.preventDefault();
      const key = new KeyEvent(event);
      pending.push(() => output.push(decode(terminal.encodeKey(key))));
    }
    setup.renderer.keyInput.on("keypress", captureKey);
    setup.renderer.keyInput.on("keyrelease", captureKey);
    setup.renderer.keyInput.on("paste", (event) => {
      event.preventDefault();
      const bytes = new Uint8Array(event.bytes);
      pending.push(() => output.push(decode(terminal.encodePaste(bytes))));
    });
    setup.renderer.keyInput.processParsedKey(parseKeypress("\x1b[A")!);
    const paste = Buffer.from("original");
    setup.renderer.keyInput.processPaste(paste);
    paste.fill(120);
    setup.renderer.keyInput.processParsedKey(
      parseKeypress("\x1b[97;1:3u", { useKittyKeyboard: true })!,
    );
    expect(output).toEqual([]);
    expect(pending).toHaveLength(3);
    terminal.write("\x1b[?1h\x1b[?2004h");
    pending[0]!();
    pending[1]!();
    terminal.write("\x1b[>3u");
    pending[2]!();
    expect(output).toEqual(["\x1bOA", "\x1b[200~original\x1b[201~", "\x1b[97;1:3u"]);
  } finally {
    await setup.dispose();
  }
});

test("generic mouse prevention cannot defer the stock mouse encoder", async () => {
  const setup = await createTestRenderer({ width: 30, height: 6 });
  try {
    const output: string[] = [];
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 30,
      height: 6,
      selectable: false,
      onData: (bytes) => output.push(decode(bytes)),
      onMouse(event) {
        event.preventDefault();
        event.stopPropagation();
      },
    });
    setup.renderer.root.add(terminal);
    terminal.write("\x1b[?1000h\x1b[?1006h");
    await setup.flush();
    terminal.processMouseEvent(
      new MouseEvent(terminal, {
        type: "down",
        button: 0,
        x: 2,
        y: 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    expect(output).toEqual(["\x1b[<0;3;2M"]);
  } finally {
    await setup.dispose();
  }
});

test("stock focus reports encode immediately independently of key capture", async () => {
  const setup = await createTestRenderer({ width: 30, height: 6 });
  try {
    const output: string[] = [];
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 30,
      height: 6,
      onData: (bytes) => output.push(decode(bytes)),
    });
    setup.renderer.root.add(terminal);
    terminal.focus();
    terminal.write("\x1b[?1004h");
    terminal.blur();
    expect(output).toEqual(["\x1b[O"]);
    expect(terminal.focused).toBe(false);
  } finally {
    await setup.dispose();
  }
});

test("public headless parser supports four input kinds and one hidden query response", () => {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 8, renderCellsMax: 2000 });
  const terminal = lib.createContextEmbeddedTerminal(context, { cols: 30, rows: 6 });
  try {
    lib.contextEmbeddedTerminalWrite(
      context,
      terminal,
      "\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[5n",
    );
    expect(
      decode(lib.contextEmbeddedTerminalEncodeKey(context, terminal, { key: "arrow_up" })),
    ).toBe("\x1bOA");
    expect(
      decode(lib.contextEmbeddedTerminalEncodePaste(context, terminal, Buffer.from("paste"))),
    ).toBe("\x1b[200~paste\x1b[201~");
    expect(
      decode(
        lib.contextEmbeddedTerminalEncodeMouse(context, terminal, {
          action: "press",
          button: "left",
          x: 2,
          y: 1,
        }),
      ),
    ).toBe("\x1b[<0;3;2M");
    expect(decode(lib.contextEmbeddedTerminalEncodeFocus(context, terminal, false))).toBe("\x1b[O");
    expect(decode(lib.contextEmbeddedTerminalDrainResponses(context, terminal))).toBe("\x1b[0n");
    expect(lib.contextEmbeddedTerminalDrainResponses(context, terminal)).toHaveLength(0);
  } finally {
    lib.destroyContextEmbeddedTerminal(context, terminal);
    lib.destroyContext(context);
  }
});

test("registry material retains Unicode and style while long OSC8 destinations are unsupported", () => {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 8, renderCellsMax: 2000 });
  const terminal = lib.createContextEmbeddedTerminal(context, { cols: 30, rows: 6 });
  const target = lib.createContextBuffer(context, { width: 30, height: 6 });
  try {
    const url = "https://example.test/" + "a".repeat(600);
    lib.contextEmbeddedTerminalWrite(
      context,
      terminal,
      "λ🙂e\u0301\x1b[1;3;4;38;2;17;34;51m \x1b[0m\x1b]8;;" +
        url +
        "\x1b\\LINK\x1b]8;;\x1b\\ AFTER",
    );
    lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
    const lease = lib.contextAcquireBufferLease(context, target);
    try {
      const bytes = new Uint8Array(
        lib.contextBufferLeaseGetRealCharSize(context, lease.handle, false),
      );
      const lengths = new Uint8Array(180);
      lib.contextBufferLeaseWriteResolvedChars(context, lease.handle, bytes, false, lengths);
      expect(decode(bytes).startsWith("λ🙂e\u0301 LINK AFTER")).toBe(true);
      expect([...lengths.subarray(0, 5)]).toEqual([2, 4, 0, 3, 1]);
      const attributes = new Uint32Array(toArrayBuffer(lease.attributes, 0, 180 * 4));
      expect(attributes[4]! & 255).toBe(13);
      const foreground = new Uint16Array(toArrayBuffer(lease.fg, 0, 180 * 8));
      expect(RGBA.fromArray(foreground.subarray(16, 20)).toInts()).toEqual([17, 34, 51, 255]);
    } finally {
      lib.contextReleaseBufferLease(context, lease.handle);
    }
  } finally {
    lib.destroyContextBuffer(context, target);
    lib.destroyContextEmbeddedTerminal(context, terminal);
    lib.destroyContext(context);
  }
});

test("pasted mouse-shaped bytes remain paste and rejected paste can be cancelled before retention", async () => {
  const setup = await createTestRenderer({ width: 30, height: 6 });
  try {
    const output: string[] = [];
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 30,
      height: 6,
      onData: (bytes) => output.push(decode(bytes)),
    });
    setup.renderer.root.add(terminal);
    terminal.focus();
    terminal.write("\x1b[?2004h\x1b[?1000h\x1b[?1006h");
    const payload = "\x1b[<0;3;2M";
    setup.renderer.keyInput.processPaste(new TextEncoder().encode(payload));
    // The native paste encoder sanitizes ESC; it must not become a child mouse report.
    expect(output).toEqual(["\x1b[200~ [<0;3;2M\x1b[201~"]);
    setup.renderer.keyInput.on("paste", (event) => {
      event.preventDefault();
      structuredClone(event.bytes.buffer, { transfer: [event.bytes.buffer] });
    });
    expect(() => setup.renderer.keyInput.processPaste(new Uint8Array([97]))).not.toThrow();
    expect(output).toHaveLength(1);
  } finally {
    await setup.dispose();
  }
});

import { expect, spyOn, test } from "bun:test";

import {
  CliRenderEvents,
  EmbeddedTerminalRenderable,
  KeyEvent,
  MouseEvent,
  parseKeypress,
  PasteEvent,
  resolveRenderLib,
} from "@opentui/core";
import { extend } from "@opentui/react";
import type { InputStamp } from "@work-craft/server/client";
import { act, useState } from "react";

import { appendTerminalChunk, type TerminalBuffer } from "@/client/terminal-buffer";
import { createTerminalOutputs } from "@/client/terminal-output";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";
import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";
import { TerminalViewport } from "@/workbench/terminal-viewport";

extend({ terminal: EmbeddedTerminalRenderable });
const encode = (text: string) => new TextEncoder().encode(text);
const responseStamp = {
  epoch: "e",
  attachmentGeneration: 1,
  navigationGeneration: 1,
  geometrySequence: 1,
};

function buffer(text = "", overrides: Partial<TerminalBuffer> = {}): TerminalBuffer {
  return {
    epoch: "e",
    runtimeGeneration: 0,
    resetGeneration: 0,
    history: encode(text),
    historyStartCursor: 0,
    historyPrefixBytes: 0,
    historyCursor: encode(text).byteLength,
    initialSize: { cols: 100, rows: 30 },
    initialGridSequence: 0,
    resizes: [],
    chunks: [],
    ...overrides,
  };
}

async function viewport(
  initial: TerminalBuffer,
  width: number,
  height: number,
  responds: boolean | ((stamp: InputStamp) => boolean) = true,
) {
  const emitted: { source: string; text: string }[] = [];
  const responseStamps: InputStamp[] = [];
  let update!: (next: TerminalBuffer) => void;
  let resizeLocal!: (width: number, height: number) => void;
  let resyncs = 0;
  const outputs = createTerminalOutputs(new Map([["p", initial]]));
  function Fixture() {
    const [viewport, setViewport] = useState({ width, height });
    resizeLocal = (width, height) => setViewport({ width, height });
    const [current, setCurrent] = useState(initial);
    update = (next) => {
      outputs.set("p", next);
      setCurrent(next);
    };
    const lastGrid = current.resizes.at(-1) ?? current.initialSize ?? { cols: 100, rows: 30 };
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box
          position="absolute"
          left={2}
          top={2}
          width={viewport.width}
          height={viewport.height}
          overflow="hidden"
        >
          <TerminalViewport
            paneId="p"
            output={outputs.pane("p")}
            size={{ cols: lastGrid.cols, rows: lastGrid.rows }}
            inputEnabled
            focused
            canInput={() => outputs.pane("p").read()?.recovering !== true}
            canRespond={(stamp) => (typeof responds === "function" ? responds(stamp) : responds)}
            onData={(data, source, stamp) => {
              emitted.push({ source, text: new TextDecoder().decode(data) });
              if (stamp) {
                responseStamps.push(stamp);
              }
            }}
            onReady={() => {}}
            onFocus={() => {}}
            onResync={() => {
              resyncs++;
            }}
          />
        </Box>
        <Text position="absolute" left={0} top={height + 4}>
          status remains visible
        </Text>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, {
    width: width + 4,
    height: height + 5,
    exitOnCtrlC: false,
  });
  await flushMeasured(setup);
  await flushMeasured(setup);
  function terminal() {
    return setup.renderer.root.findDescendantById("terminal:p") as EmbeddedTerminalRenderable;
  }
  return {
    ...setup,
    update,
    resizeLocal,
    emitted,
    responseStamps,
    terminal,
    resyncs: () => resyncs,
    outputs,
  };
}

test("pane-local publication drains output without a parent control render", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const native = setup.terminal();
  try {
    setup.outputs.set("p", buffer("pane-local output"));
    await flushMeasured(setup);
    expect(native.screen().text).toContain("pane-local output");
    expect(setup.terminal()).toBe(native);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an authorized focused leaf queues physical input while its native grid is resizing", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  const lib = resolveRenderLib();
  const original = lib.contextEmbeddedTerminalResize.bind(lib);
  let injected = false;
  const resize = spyOn(lib, "contextEmbeddedTerminalResize").mockImplementation((...args) => {
    if (args[2] === 93 && args[3] === 25) {
      injected = true;
      setup.renderer.stdin.emit("data", Buffer.from("z"));
    }
    return original(...args);
  });
  try {
    expect(native.focused).toBe(true);
    act(() =>
      setup.update({
        ...initial,
        resizes: [{ cursor: 0, sequence: 1, cols: 93, rows: 25 }],
      }),
    );
    await flushMeasured(setup);
    await flushMeasured(setup);
    expect(injected).toBe(true);
    expect(native.focused).toBe(true);
    expect(setup.renderer.currentFocusedRenderable).toBe(native);
    expect(setup.emitted).toEqual([{ source: "input", text: "z" }]);
  } finally {
    resize.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("unmount cancels a scheduled pane drain instead of writing to a destroyed native terminal", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const native = setup.terminal();
  const write = spyOn(native, "write");
  setup.outputs.set("p", buffer("must not parse after unmount"));
  act(() => setup.renderer.destroy());
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

test("the viewport never sends a native write larger than eight KiB", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const native = setup.terminal();
  const sizes: number[] = [];
  const original = native.write.bind(native);
  const write = spyOn(native, "write").mockImplementation((bytes) => {
    sizes.push(typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength);
    original(bytes);
  });
  try {
    setup.outputs.set("p", buffer("x".repeat(20000)));
    await flushMeasured(setup);
    expect(sizes).toEqual([8192, 8192, 3616]);
  } finally {
    write.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("failed native writes do not acknowledge consumption or prevent recovery", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const output = setup.outputs.pane("p");
  const consumed = spyOn(output, "consumed");
  const original = setup.terminal().write.bind(setup.terminal());
  const write = spyOn(setup.terminal(), "write").mockImplementation(() => {
    throw new Error("native write failed");
  });
  try {
    setup.outputs.set("p", buffer("unconsumed"));
    await flushMeasured(setup);
    expect(consumed).not.toHaveBeenCalled();
    expect(output.next({ cursor: 0, gridSequence: 0 }, 8192)).toMatchObject({
      type: "bytes",
      cursor: 10,
    });
    expect(setup.resyncs()).toBe(1);
    expect(setup.terminal().focusable).toBe(false);
    const pending = output.read()!;
    setup.outputs.set("p", { ...pending, recovering: true });
    await flushMeasured(setup);
    write.mockImplementation(original);
    setup.outputs.set("p", { ...pending, recovering: false });
    await flushMeasured(setup);
    expect(setup.terminal().screen().text).toContain("unconsumed");
    expect(setup.terminal().focusable).toBe(true);
    expect(consumed).toHaveBeenCalledTimes(1);
  } finally {
    consumed.mockRestore();
    write.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("continuous output does not move the finite readiness frontier or repeatedly refocus", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const native = setup.terminal();
  const focus = spyOn(native, "focus");
  const blur = spyOn(native, "blur");
  const original = native.write.bind(native);
  let cursor = 20000;
  let remaining = 6;
  const initial = buffer("x".repeat(cursor));
  let current = initial;
  const write = spyOn(native, "write").mockImplementation((bytes) => {
    original(bytes);
    if (remaining-- > 0) {
      cursor += 8192;
      current = appendTerminalChunk(current, cursor, new Uint8Array(8192).fill(120), 0);
      setup.outputs.set("p", current);
    }
  });
  try {
    setup.outputs.set("p", initial);
    await flushMeasured(setup);
    expect(native.focusable).toBe(true);
    expect(blur).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  } finally {
    focus.mockRestore();
    blur.mockRestore();
    write.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("screen-change callbacks coalesce cursor inspection to one per 33 milliseconds", async () => {
  const setup = await viewport(buffer(), 60, 12);
  const screen = spyOn(setup.terminal(), "screen");
  const nextWindow = performance.now() + 1000;
  const now = spyOn(performance, "now").mockReturnValue(nextWindow);
  try {
    for (let index = 0; index < 100; index++) {
      setup.terminal().onScreenChange!();
    }
    expect(screen).toHaveBeenCalledTimes(1);
  } finally {
    now.mockRestore();
    screen.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("queued keys paste mouse and focus encode only after their finite received mode frontier", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  const modes = encode("\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1004h");
  try {
    setup.outputs.set("p", appendTerminalChunk(initial, modes.length, modes, 0));
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    native.handlePaste(new PasteEvent(encode("paste")));
    native.processMouseEvent(
      new MouseEvent(native, {
        type: "down",
        button: 0,
        x: native.screenX + 2,
        y: native.screenY + 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    native.blur();
    expect(setup.emitted.length).toBe(0);
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([
      { source: "input", text: "\x1bOA" },
      { source: "input", text: "\x1b[200~paste\x1b[201~" },
      { source: "input", text: "\x1b[<0;3;2M" },
      { source: "input", text: "\x1b[O" },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("later output cannot extend an admitted key's finite parser frontier", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  const first = appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0);
  const original = native.write.bind(native);
  let appended = false;
  const write = spyOn(native, "write").mockImplementation((bytes) => {
    original(bytes);
    if (!appended) {
      appended = true;
      setup.outputs.set("p", appendTerminalChunk(first, 10, encode("\x1b[?1l"), 0));
    }
  });
  try {
    setup.outputs.set("p", first);
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([{ source: "input", text: "\x1bOA" }]);
    expect(new TextDecoder().decode(native.encodeKey(new KeyEvent(parseKeypress("\x1b[A")!)))).toBe(
      "\x1b[A",
    );
  } finally {
    write.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("coalesced later bytes and same-cursor resizes cannot overtake an admitted key", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  const write = native.write.bind(native);
  const encodedAt: number[] = [];
  const lib = resolveRenderLib();
  const originalEncode = lib.contextEmbeddedTerminalEncodeKey.bind(lib);
  let written = 0;
  const writes = spyOn(native, "write").mockImplementation((bytes) => {
    written += bytes.length;
    write(bytes);
  });
  const encodeKey = spyOn(lib, "contextEmbeddedTerminalEncodeKey").mockImplementation((...args) => {
    encodedAt.push(written);
    return originalEncode(...args);
  });
  try {
    let current = appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0);
    setup.outputs.set("p", current);
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    current = appendTerminalChunk(current, 10, encode("\x1b[?1l"), 0);
    setup.outputs.set("p", {
      ...current,
      resizes: [{ cursor: 10, sequence: 1, cols: 100, rows: 30 }],
    });
    await flushMeasured(setup);
    expect(encodedAt).toEqual([5]);
    expect(setup.emitted).toEqual([{ source: "input", text: "\x1bOA" }]);
  } finally {
    writes.mockRestore();
    encodeKey.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("pre-encoding input rejects oversized queued paste and releases it on unmount", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  setup.outputs.set("p", appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0));
  act(() => native.handlePaste(new PasteEvent(new Uint8Array(8 * 1024 * 1024))));
  expect(setup.resyncs()).toBe(1);
  expect(setup.emitted.length).toBe(0);
  act(() => setup.renderer.destroy());
  await Bun.sleep(0);
  expect(setup.emitted.length).toBe(0);
});

test("queued input waits through a received grid marker before native encoding", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    setup.outputs.set("p", {
      ...appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0),
      resizes: [{ cursor: 5, sequence: 1, cols: 90, rows: 25 }],
    });
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    await flushMeasured(setup);
    await flushMeasured(setup);
    expect(native.screen().columns).toBe(90);
    expect(setup.emitted).toEqual([{ source: "input", text: "\x1bOA" }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("cancelled deferred blur still releases native focus without sending a stale report", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    const current = appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0);
    setup.outputs.set("p", current);
    native.blur();
    expect(native.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable).not.toBe(native);
    setup.outputs.set("p", { ...current, recovering: true });
    await flushMeasured(setup);
    expect(native.focused).toBe(false);
    expect(setup.emitted).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("native key releases also wait for received Kitty event-reporting modes", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    const modes = encode("\x1b[>3u");
    setup.outputs.set("p", appendTerminalChunk(initial, modes.length, modes, 0));
    native.handleKeyPress(new KeyEvent({ ...parseKeypress("a")!, eventType: "release" }));
    expect(setup.emitted).toEqual([]);
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([{ source: "input", text: "\x1b[97;1:3u" }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("deferred mouse encoding preserves the clicked grid cell when its crop moves", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  const original = native.write.bind(native);
  const write = spyOn(native, "write").mockImplementation((bytes) => {
    original(bytes);
    native.translateX = 10;
  });
  try {
    const modes = encode("\x1b[?1000h\x1b[?1006h");
    setup.outputs.set("p", appendTerminalChunk(initial, modes.length, modes, 0));
    native.processMouseEvent(
      new MouseEvent(native, {
        type: "down",
        button: 0,
        x: native.screenX + 2,
        y: native.screenY + 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([{ source: "input", text: "\x1b[<0;3;2M" }]);
  } finally {
    write.mockRestore();
    act(() => setup.renderer.destroy());
  }
});

test("fast recovery completion still re-enables an unfocused native viewport after its control commit", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    native.blur();
    act(() => setup.update({ ...initial, recovering: true }));
    expect(native.focusable).toBe(false);
    setup.outputs.set("p", { ...initial, recovering: false });
    await flushMeasured(setup);
    expect(native.focusable).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("native destruction releases renderer focus even with admitted input awaiting output", async () => {
  const initial = buffer();
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    setup.outputs.set("p", appendTerminalChunk(initial, 5, encode("\x1b[?1h"), 0));
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    native.destroy();
    expect(setup.renderer.currentFocusedRenderable === native).toBe(false);
    expect(native.focused).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a delayed mirror cannot answer an old live query after a same-size ownership handoff", async () => {
  let owner = "a";
  const stamp = {
    epoch: "e",
    attachmentGeneration: 1,
    navigationGeneration: 1,
    geometrySequence: 1,
  };
  const a = await viewport(buffer(), 60, 12, () => owner === "a");
  const b = await viewport(buffer(), 60, 12, () => owner === "b");
  const query = encode("\x1b[6n");
  try {
    const chunk = {
      cursor: query.length,
      data: query,
      geometrySequence: 1,
      origin: "live" as const,
    };
    act(() => a.update(buffer("", { chunks: [{ ...chunk, responseStamp: stamp }] })));
    await flushMeasured(a);
    expect(a.emitted).toHaveLength(1);
    expect(a.responseStamps).toEqual([stamp]);
    owner = "b";
    act(() => b.update(buffer("", { chunks: [{ ...chunk, responseStamp: null }] })));
    await flushMeasured(b);
    expect(b.emitted).toEqual([]);
  } finally {
    act(() => a.renderer.destroy());
    act(() => b.renderer.destroy());
  }
});

test("two canonical native viewports agree through ordered history resizes and cursor clipping", async () => {
  const first = "\x1b[2J\x1b[25;90HX";
  const middle = "\x1b[2J\x1b[20;70HY";
  const last = "\x1b[2J\x1b[25;90HZ";
  const current = buffer(first + middle + last, {
    resizes: [
      { cursor: encode(first).byteLength, sequence: 1, cols: 80, rows: 24 },
      { cursor: encode(first + middle).byteLength, sequence: 2, cols: 100, rows: 30 },
    ],
  });
  const actualWrites: { text: string; cols: number; rows: number }[] = [];
  const original = EmbeddedTerminalRenderable.prototype.write;
  const writes = spyOn(EmbeddedTerminalRenderable.prototype, "write").mockImplementation(function (
    this: EmbeddedTerminalRenderable,
    data: string | Uint8Array,
  ) {
    actualWrites.push({
      text: typeof data === "string" ? data : new TextDecoder().decode(data),
      cols: this.screen().columns,
      rows: this.screen().rows,
    });
    original.call(this, data);
  });
  const large = await viewport(current, 120, 40);
  const small = await viewport(current, 60, 12);
  try {
    expect(small.terminal().screen().cursor).toEqual(large.terminal().screen().cursor);
    expect(small.terminal().screen()).toMatchObject({
      columns: 100,
      rows: 30,
      cursor: { x: 90, y: 24 },
    });
    expect(small.captureCharFrame().split("\n")[13]?.[60]).toBe("Z");
    expect(small.renderer.getCursorState()).toMatchObject({ x: 62, y: 14, visible: true });
    expect(small.captureCharFrame()).toContain("status remains visible");
    expect(large.captureCharFrame().split("\n")[26]?.slice(102).trim()).toBe("");
    expect(
      actualWrites.filter(({ text }) => text.includes("Y")).map(({ cols, rows }) => [cols, rows]),
    ).toEqual([
      [80, 24],
      [80, 24],
    ]);
    expect(
      actualWrites.filter(({ text }) => text.includes("Z")).map(({ cols, rows }) => [cols, rows]),
    ).toEqual([
      [100, 30],
      [100, 30],
    ]);
    expect(small.resyncs() + large.resyncs()).toBe(0);
  } finally {
    act(() => small.renderer.destroy());
    act(() => large.renderer.destroy());
    writes.mockRestore();
  }
});

test("a passive viewport shrink follows the existing cursor without requiring new output", async () => {
  const setup = await viewport(buffer("\x1b[25;90H@\x1b[25;90H"), 100, 30);
  try {
    act(() => setup.resizeLocal(40, 10));
    await flushMeasured(setup);
    expect(setup.terminal().screen()).toMatchObject({
      columns: 100,
      rows: 30,
      cursor: { x: 89, y: 24 },
    });
    expect(setup.captureCharFrame()).toContain("@");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("the native viewport does not advertise in-band resize reports it cannot deliver", async () => {
  const setup = await viewport(buffer(), 60, 12);
  try {
    const query = encode("\x1b[?2048$p");
    act(() =>
      setup.update(
        buffer("", {
          chunks: [
            {
              cursor: query.length,
              data: query,
              geometrySequence: 1,
              origin: "live",
              responseStamp,
            },
          ],
        }),
      ),
    );
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([{ source: "response", text: "\x1b[?2048;0$y" }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("enabling in-band resize before querying still reports the unsupported capability honestly", async () => {
  const setup = await viewport(buffer(), 60, 12);
  try {
    const query = encode("\x1b[?2048h\x1b[?2048$p");
    act(() =>
      setup.update(
        buffer("", {
          chunks: [
            {
              cursor: query.length,
              data: query,
              geometrySequence: 1,
              origin: "live",
              responseStamp,
            },
          ],
        }),
      ),
    );
    await flushMeasured(setup);
    expect(setup.emitted).toEqual([{ source: "response", text: "\x1b[?2048;0$y" }]);
    act(() => setup.resizeLocal(40, 10));
    await flushMeasured(setup);
    expect(setup.emitted).toHaveLength(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("history queries are suppressed while only the current owner answers live queries", async () => {
  const history = "\x1b[25;90HX\x1b[6n";
  const owner = await viewport(buffer(history), 60, 12);
  const mirror = await viewport(buffer(history), 60, 12, false);
  try {
    expect(owner.emitted).toEqual([]);
    expect(mirror.emitted).toEqual([]);
    const live = encode("\x1b[6n");
    const current = buffer(history, {
      chunks: [
        {
          cursor: encode(history).byteLength + live.byteLength,
          data: live,
          geometrySequence: 1,
          origin: "live",
          responseStamp,
        },
      ],
    });
    act(() => {
      owner.update(current);
      mirror.update(current);
    });
    await flushMeasured(owner);
    await flushMeasured(mirror);
    expect(owner.emitted).toEqual([{ source: "response", text: "\x1b[25;91R" }]);
    expect(mirror.emitted).toEqual([]);
  } finally {
    act(() => owner.renderer.destroy());
    act(() => mirror.renderer.destroy());
  }
});

test("same-cursor resize retains the native object and translates mouse coordinates", async () => {
  const initial = buffer("\x1b[25;90HX\x1b[?1000h\x1b[?1006h");
  const setup = await viewport(initial, 60, 12);
  const native = setup.terminal();
  try {
    await act(async () => setup.mockMouse.click(60, 13));
    expect(setup.emitted).toEqual([
      { source: "input", text: "\x1b[<0;90;25M" },
      { source: "input", text: "\x1b[<0;90;25m" },
    ]);
    act(() =>
      setup.update({
        ...initial,
        resizes: [{ cursor: initial.historyCursor, sequence: 1, cols: 120, rows: 40 }],
      }),
    );
    await flushMeasured(setup);
    expect(setup.terminal()).toBe(native);
    expect(native.screen()).toMatchObject({ columns: 120, rows: 40 });
    expect(setup.resyncs()).toBe(0);
    act(() => setup.renderer.stdin.emit("data", Buffer.from("a")));
    await flushMeasured(setup);
    expect(setup.emitted.at(-1)).toEqual({ source: "input", text: "a" });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an obsolete native resize callback cannot invent a different actual grid", async () => {
  const setup = await viewport(buffer("kept"), 60, 12);
  try {
    act(() => setup.terminal().onTerminalResize!(80, 20));
    await flushMeasured(setup);
    expect(setup.resyncs()).toBe(0);
    expect(setup.terminal().focusable).toBe(true);
    expect(setup.terminal().screen()).toMatchObject({ columns: 100, rows: 30 });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a byte gap requests one resync and does not feed partial output to the emulator", async () => {
  const initial = buffer("kept");
  const setup = await viewport(initial, 60, 12);
  const eligibilityAtBlur: boolean[] = [];
  setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, () => {
    if (setup.renderer.currentFocusedRenderable === null) {
      eligibilityAtBlur.push(setup.terminal().focusable);
    }
  });
  try {
    act(() =>
      setup.update({
        ...initial,
        chunks: [{ cursor: 12, data: encode("BAD"), geometrySequence: 1, origin: "live" }],
      }),
    );
    await flushMeasured(setup);
    await flushMeasured(setup);
    expect(setup.resyncs()).toBe(1);
    expect(setup.terminal().screen().text).not.toContain("BAD");
    expect(setup.terminal().focusable).toBe(false);
    expect(eligibilityAtBlur).toEqual([false]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

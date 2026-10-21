import { expect, spyOn, test } from "bun:test";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { act, useState } from "react";

import type { TerminalReplayBuffer } from "@/client/terminal-replay";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";
import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";
import { TerminalViewport } from "@/workbench/terminal-viewport";

extend({ terminal: EmbeddedTerminalRenderable });
const encode = (text: string) => new TextEncoder().encode(text);

function buffer(text = "", overrides: Partial<TerminalReplayBuffer> = {}): TerminalReplayBuffer {
  return {
    epoch: "e",
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
  initial: TerminalReplayBuffer,
  width: number,
  height: number,
  responds = true,
) {
  const emitted: { source: string; text: string }[] = [];
  let update!: (next: TerminalReplayBuffer) => void;
  let resyncs = 0;
  function Fixture() {
    const [current, setCurrent] = useState(initial);
    update = setCurrent;
    const lastGrid = current.resizes.at(-1) ?? current.initialSize ?? { cols: 100, rows: 30 };
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box position="absolute" left={2} top={2} width={width} height={height} overflow="hidden">
          <TerminalViewport
            paneId="p"
            buffer={current}
            size={{ cols: lastGrid.cols, rows: lastGrid.rows }}
            inputEnabled
            focused
            canInput={() => true}
            canRespond={() => responds}
            onData={(data, source) =>
              emitted.push({ source, text: new TextDecoder().decode(data) })
            }
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
  return { ...setup, update, emitted, terminal, resyncs: () => resyncs };
}

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
    expect(setup.emitted.at(-1)).toEqual({ source: "input", text: "a" });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a byte gap requests one resync and does not feed partial output to the emulator", async () => {
  const initial = buffer("kept");
  const setup = await viewport(initial, 60, 12);
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
  } finally {
    act(() => setup.renderer.destroy());
  }
});

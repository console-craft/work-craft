import { expect, test } from "bun:test";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { act, useRef, useState } from "react";

import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    gridReference: typeof EmbeddedTerminalRenderable;
  }
}
extend({ gridReference: EmbeddedTerminalRenderable });

async function nativeViewport(width: number, height: number) {
  const resizes: { cols: number; rows: number }[] = [];
  const emitted: { source: "input" | "response"; data: string }[] = [];
  let resizeGrid!: (size: { cols: number; rows: number }) => void;
  function Fixture() {
    const terminal = useRef<EmbeddedTerminalRenderable>(null);
    const [grid, setGrid] = useState({ cols: 100, rows: 30 });
    resizeGrid = setGrid;
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    return (
      <box position="absolute" left={2} top={2} width={width} height={height} overflow="hidden">
        <gridReference
          id="shared-terminal"
          ref={terminal}
          cols={100}
          rows={30}
          width={grid.cols}
          height={grid.rows}
          flexShrink={0}
          position="absolute"
          left={-offset.x}
          top={-offset.y}
          onData={(bytes, source) => {
            emitted.push({ source, data: new TextDecoder().decode(bytes) });
          }}
          onTerminalResize={(cols, rows) => resizes.push({ cols, rows })}
          onScreenChange={() => {
            const screen = terminal.current!.screen();
            const x = Math.max(0, Math.min(screen.columns - width, screen.cursor.x - width + 1));
            const y = Math.max(0, Math.min(screen.rows - height, screen.cursor.y - height + 1));
            setOffset((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
          }}
        />
      </box>
    );
  }
  const setup = await testRender(<Fixture />, {
    width: width + 4,
    height: height + 4,
    exitOnCtrlC: false,
  });
  await flushMeasured(setup);
  const terminal = setup.renderer.root.findDescendantById(
    "shared-terminal",
  ) as EmbeddedTerminalRenderable;
  act(() => terminal.focus());
  await flushMeasured(setup);
  return { ...setup, terminal, resizeGrid, resizes, emitted };
}

test("native mirrors keep a 100x30 grid while clipping to different viewports", async () => {
  const large = await nativeViewport(120, 40);
  const small = await nativeViewport(60, 12);
  try {
    for (const setup of [large, small]) {
      act(() => setup.terminal.write("\x1b[2J\x1b[25;90HX"));
      await flushMeasured(setup);
    }
    expect(small.terminal.screen().cursor).toEqual(large.terminal.screen().cursor);
    expect(small.terminal.screen()).toMatchObject({ columns: 100, rows: 30 });
    expect(small.terminal.screen().cursor).toMatchObject({ x: 90, y: 24 });
    expect(large.captureCharFrame().split("\n")[26]?.[91]).toBe("X");
    expect(small.captureCharFrame().split("\n")[13]?.[60]).toBe("X");
    expect(small.renderer.getCursorState()).toMatchObject({ x: 62, y: 14, visible: true });
    expect(large.captureCharFrame().split("\n")[26]?.slice(102).trim()).toBe("");
  } finally {
    act(() => small.renderer.destroy());
    act(() => large.renderer.destroy());
  }
});

test("native grid changes retain the terminal and parse output only at the new measured size", async () => {
  const setup = await nativeViewport(60, 12);
  const terminal = setup.terminal;
  try {
    act(() => terminal.write("\x1b[2J\x1b[25;90HX"));
    await flushMeasured(setup);
    act(() => setup.resizeGrid({ cols: 80, rows: 24 }));
    await flushMeasured(setup);
    expect(terminal.screen()).toMatchObject({ columns: 80, rows: 24 });
    act(() => terminal.write("\x1b[2J\x1b[20;70HY"));
    await flushMeasured(setup);
    expect(terminal.screen().cursor).toMatchObject({ x: 70, y: 19 });
    expect(setup.captureCharFrame()).toContain("Y");
    act(() => setup.resizeGrid({ cols: 100, rows: 30 }));
    await flushMeasured(setup);
    expect(terminal.screen()).toMatchObject({ columns: 100, rows: 30 });
    act(() => terminal.write("\x1b[2J\x1b[25;90HZ"));
    await flushMeasured(setup);
    expect(terminal.screen().cursor).toMatchObject({ x: 90, y: 24 });
    expect(setup.captureCharFrame().split("\n")[13]?.[60]).toBe("Z");
    expect(setup.renderer.root.findDescendantById("shared-terminal")).toBe(terminal);
    expect(setup.resizes.slice(-2)).toEqual([
      { cols: 80, rows: 24 },
      { cols: 100, rows: 30 },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("translated native mouse input uses canonical grid coordinates", async () => {
  const setup = await nativeViewport(60, 12);
  try {
    act(() => setup.terminal.write("\x1b[2J\x1b[25;90HX\x1b[?1000h\x1b[?1006h"));
    await flushMeasured(setup);
    await act(async () => setup.mockMouse.click(60, 13));
    expect(setup.emitted.filter(({ source }) => source === "input")).toEqual([
      { source: "input", data: "\x1b[<0;90;25M" },
      { source: "input", data: "\x1b[<0;90;25m" },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("native device replies are distinguishable from programmatic focus reports", async () => {
  const setup = await nativeViewport(60, 12);
  try {
    act(() => setup.terminal.write("\x1b[25;90HX\x1b[6n\x1b[?1004h"));
    await flushMeasured(setup);
    act(() => setup.terminal.blur());
    act(() => setup.terminal.focus());
    expect(setup.emitted).toEqual([
      { source: "response", data: "\x1b[25;91R" },
      { source: "input", data: "\x1b[O" },
      { source: "input", data: "\x1b[I" },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

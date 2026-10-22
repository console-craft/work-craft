import { expect, test } from "bun:test";

import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  OptimizedBuffer,
  ResourceContext,
  RGBA,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { TerminalMaterialRenderable } from "@/workbench/tests/no-fork-positioned-material-view";

// oxlint-disable-next-line no-restricted-imports -- Opt-in stock-registry drawing trial.
import type { CompactMaterialFrame } from "../../../../../scripts/test-support/terminal-projection-types";

const normal = { fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 } as const;

test("public cell primitives narrow single regional indicators in every width mode", () => {
  const context = new ResourceContext({ objectCapacity: 128, renderCellsMax: 10000 });
  const fg = RGBA.fromInts(255, 255, 255);
  const bg = RGBA.fromInts(0, 0, 0);
  try {
    for (const mode of ["wcwidth", "unicode", "unicode-wide"] as const) {
      const buffer = OptimizedBuffer.create(12, 1, mode, { owner: context });
      try {
        const encoded = buffer.encodeUnicode("🇦");
        try {
          expect({ mode, widths: encoded.data.map((glyph) => glyph.width) }).toEqual({
            mode,
            widths: [1],
          });
        } finally {
          buffer.freeUnicode(encoded);
        }
        for (const method of ["drawText", "setCell", "drawChar"] as const) {
          buffer.clear(bg);
          if (method === "drawText") {
            buffer.drawText("🇦", 0, 0, fg, bg);
          } else if (method === "setCell") {
            buffer.setCell(0, 0, "🇦", fg, bg);
          } else {
            buffer.drawChar(0x1f1e6, 0, 0, fg, bg);
          }
          buffer.drawText("X", 2, 0, RGBA.fromInts(255, 0, 0), bg);
          const span = buffer.getSpanLines()[0]!.spans[0]!;
          expect({ mode, method, text: span.text, width: span.width }).toEqual({
            mode,
            method,
            text: "🇦 ",
            width: 2,
          });
        }
      } finally {
        buffer.destroy();
      }
    }
  } finally {
    context.destroy();
  }
});

function picture(rows: CompactMaterialFrame["rows"], cols = 12): CompactMaterialFrame {
  return {
    size: { cols, rows: rows.length },
    cursor: { x: 5, y: 0, visible: true, style: "bar", blinking: false },
    styles: [
      normal,
      {
        fg: [17 / 255, 34 / 255, 51 / 255, 1],
        bg: [68 / 255, 85 / 255, 102 / 255, 1],
        attributes: 13,
      },
    ],
    rows,
  };
}

test("regional indicators keep following text at column four", async () => {
  const native = await createTestRenderer({ width: 12, height: 3 });
  const projected = await createTestRenderer({ width: 12, height: 3 });
  try {
    const reference = new EmbeddedTerminalRenderable(native.renderer, { width: 12, height: 3 });
    native.renderer.root.add(reference);
    reference.write("🇦🇧\x1b[31mX");
    await native.flush();
    expect(native.captureSpans().lines[0]!.spans[0]!.width).toBe(4);
    const frame = picture([
      [
        [1, "🇦", 2, 0],
        [1, "", 0, 0],
        [1, "🇧", 2, 0],
        [1, "", 0, 0],
        [1, "X", 1, 1],
        [7, " ", 1, 0],
      ],
    ]);
    const view = new TerminalMaterialRenderable(projected.renderer, { frame });
    projected.renderer.root.add(view);
    await projected.flush();
    const styled = projected.captureSpans().lines[0]!.spans;
    const marker = styled.findIndex((span) => span.text.includes("X"));
    expect(marker).toBeGreaterThan(0);
    expect(styled.slice(0, marker).reduce((sum, span) => sum + span.width, 0)).toBe(4);
    expect(
      styled
        .slice(0, marker)
        .map((span) => span.text)
        .join(""),
    ).toBe(native.captureSpans().lines[0]!.spans[0]!.text);
  } finally {
    await native.dispose();
    await projected.dispose();
  }
});

test("wide combining and styled blanks preserve cell slots", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    const view = new TerminalMaterialRenderable(setup.renderer, {
      frame: picture([
        [
          [1, "λ", 1, 0],
          [1, "🙂", 2, 0],
          [1, "", 0, 0],
          [1, "e\u0301", 1, 0],
          [1, " ", 1, 1],
          [7, " ", 1, 0],
        ],
      ]),
    });
    setup.renderer.root.add(view);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("λ🙂e\u0301");
    const spans = setup.captureSpans().lines[0]!.spans;
    const index = spans.findIndex((span) => span.attributes === 13);
    expect(spans.slice(0, index).reduce((sum, span) => sum + span.width, 0)).toBe(4);
    expect(spans[index]!.fg.toInts()).toEqual([17, 34, 51, 255]);
    expect(spans[index]!.bg.toInts()).toEqual([68, 85, 102, 255]);
  } finally {
    await setup.dispose();
  }
});

test("cursor uses focused leaf screen coordinates and clips outside its viewport", async () => {
  const setup = await createTestRenderer({ width: 30, height: 8 });
  try {
    const parent = new BoxRenderable(setup.renderer, {
      position: "absolute",
      left: 5,
      top: 2,
      width: 12,
      height: 3,
      overflow: "hidden",
    });
    setup.renderer.root.add(parent);
    const frame = picture([[[12, " ", 1, 0]]]);
    frame.cursor.x = 2;
    const view = new TerminalMaterialRenderable(setup.renderer, { frame });
    parent.add(view);
    view.focus();
    await setup.flush();
    expect(setup.renderer.getCursorState()).toMatchObject({
      x: 8,
      y: 3,
      visible: true,
      style: "line",
    });
    parent.width = 2;
    view.requestRender();
    await setup.flush();
    expect(setup.renderer.getCursorState().visible).toBe(false);
  } finally {
    await setup.dispose();
  }
});

test("selection copies one grapheme across a wide tail without changing its peer", async () => {
  const a = await createTestRenderer({ width: 12, height: 3 });
  const b = await createTestRenderer({ width: 20, height: 5 });
  try {
    const frame = picture([
      [
        [1, "λ", 1, 0],
        [1, "🙂", 2, 0],
        [1, "", 0, 0],
        [1, "e\u0301", 1, 0],
        [8, " ", 1, 0],
      ],
    ]);
    const view = new TerminalMaterialRenderable(a.renderer, { frame });
    const peer = new TerminalMaterialRenderable(b.renderer, { frame });
    a.renderer.root.add(view);
    b.renderer.root.add(peer);
    await a.flush();
    await b.flush();
    view.applyMouseResult(
      { kind: "mouse", mouse: { action: "press", button: "left", x: 0, y: 0 } },
      false,
    );
    view.applyMouseResult(
      { kind: "mouse", mouse: { action: "motion", button: "left", x: 3, y: 0 } },
      false,
    );
    expect(view.getSelectedText()).toBe("λ🙂e\u0301");
    view.applyMouseResult(
      { kind: "mouse", mouse: { action: "press", button: "left", x: 2, y: 0 } },
      false,
    );
    expect(view.getSelectedText()).toBe("🙂");
    expect(peer.getSelectedText()).toBe("");
  } finally {
    await a.dispose();
    await b.dispose();
  }
});

import { expect, test } from "bun:test";

import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { CompactMaterialFrame } from "@work-craft/server/client";

import { TerminalMaterialRenderable } from "@/workbench/terminal-material";

function picture(): CompactMaterialFrame {
  return {
    size: { cols: 12, rows: 1 },
    cursor: { x: 5, y: 0, visible: true, style: "bar", blinking: false },
    styles: [
      { fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 },
      {
        fg: [17 / 255, 34 / 255, 51 / 255, 1],
        bg: [68 / 255, 85 / 255, 102 / 255, 1],
        attributes: 13,
      },
    ],
    rows: [
      [
        [1, "λ", 1, 0],
        [1, "🙂", 2, 0],
        [1, "", 0, 0],
        [1, "e\u0301", 1, 0],
        [1, " ", 1, 1],
        [7, " ", 1, 0],
      ],
    ],
  };
}

test("material keeps styled blanks, selected wide tails and the prior valid picture", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    const frame = picture();
    const view = new TerminalMaterialRenderable(setup.renderer, { frame });
    setup.renderer.root.add(view);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("λ🙂e\u0301");
    const styled = setup.captureSpans().lines[0]!.spans.find((span) => span.attributes === 13)!;
    expect(styled.fg.toInts()).toEqual([17, 34, 51, 255]);
    expect(styled.bg.toInts()).toEqual([68, 85, 102, 255]);
    const before = setup.captureCharFrame();
    expect(() => view.setFrame({ ...frame, rows: [[[13, "x", 1, 0]]] })).toThrow();
    await setup.flush();
    expect(setup.captureCharFrame()).toBe(before);
    view.applyMouseResult(
      { kind: "mouse", mouse: { action: "press", button: "left", x: 2, y: 0 } },
      false,
    );
    expect(view.getSelectedText()).toBe("🙂");
  } finally {
    await setup.dispose();
  }
});

test("focused material uses screen-relative cursor coordinates and ancestor clipping", async () => {
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
    const view = new TerminalMaterialRenderable(setup.renderer, { frame: picture() });
    parent.add(view);
    view.focus();
    await setup.flush();
    expect(setup.renderer.getCursorState()).toMatchObject({
      x: 11,
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

test("preview waiver preserves regional-indicator following columns but not wide glyph fidelity", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    const frame = picture();
    frame.rows = [
      [
        [1, "🇦", 2, 0],
        [1, "", 0, 0],
        [1, "🇧", 2, 0],
        [1, "", 0, 0],
        [1, "X", 1, 1],
        [7, " ", 1, 0],
      ],
    ];
    setup.renderer.root.add(new TerminalMaterialRenderable(setup.renderer, { frame }));
    await setup.flush();
    const spans = setup.captureSpans().lines[0]!.spans;
    expect(spans[0]!.width).toBe(4);
    expect(spans[0]!.text).toBe("🇦 🇧 ");
    expect(spans[1]!.text).toBe("X");
  } finally {
    await setup.dispose();
  }
});

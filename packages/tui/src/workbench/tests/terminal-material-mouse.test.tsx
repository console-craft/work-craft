import { expect, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";
import type { CompactMaterialFrame } from "@work-craft/server/client";

import { streamFixture, terminalBufferFixture } from "@/tests/support/fixtures";
import { materialStreamFixture } from "@/tests/support/material-stream";
import { TerminalMaterialRenderable } from "@/workbench/terminal-material";

const frame: CompactMaterialFrame = {
  size: { cols: 12, rows: 1 },
  cursor: { x: 4, y: 0, visible: true, style: "bar", blinking: false },
  styles: [{ fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 }],
  rows: [
    [
      [1, "λ", 1, 0],
      [1, "🙂", 2, 0],
      [1, "", 0, 0],
      [1, "é", 1, 0],
      [8, " ", 1, 0],
    ],
  ],
};
const context = {
  epoch: "e",
  attachmentGeneration: 1,
  navigationGeneration: 1,
  geometrySequence: 0,
  runtimeGeneration: 1,
  source: "input" as const,
  kind: "mouse" as const,
};

test("raw SGR hover, drag and release retain their actual button state in child mouse reports", async () => {
  const setup = await createTestRenderer({ width: 30, height: 4 });
  const encoded: string[] = [];
  const history = new TextEncoder().encode("\x1b[?1003h\x1b[?1006h");
  const stream = materialStreamFixture(
    () => terminalBufferFixture({ history, historyCursor: history.length }),
    () => frame.size,
    streamFixture({ sendInput: (_id, bytes) => encoded.push(new TextDecoder().decode(bytes)) }),
  );
  try {
    const view = new TerminalMaterialRenderable(setup.renderer, {
      frame,
      position: "absolute",
      left: 5,
      top: 1,
      onInput(input) {
        if (input.kind === "mouse") {
          void stream.sendSemantic("p", input, context);
        }
      },
    });
    setup.renderer.root.add(view);
    await setup.flush();
    await setup.mockInput.pressKeys(["\x1b[<35;7;2M"]);
    expect(encoded).toEqual(["\x1b[<35;2;1M"]);
    await setup.mockInput.pressKeys(["\x1b[<0;7;2M", "\x1b[<32;9;2M", "\x1b[<0;9;2m"]);
    // The public renderer releases both the captured and hit target after a drag.
    expect(encoded).toEqual([
      "\x1b[<35;2;1M",
      "\x1b[<0;2;1M",
      "\x1b[<32;4;1M",
      "\x1b[<0;4;1m",
      "\x1b[<0;4;1m",
    ]);
    await setup.mockInput.pressKeys(["\x1b[<35;1;4M"]);
    expect(encoded).toHaveLength(5);
    expect(view.getSelectedText()).toBe("");
  } finally {
    await setup.dispose();
  }
});

test("real local drag finishes on release, ignores hover and participates in renderer copy and clear", async () => {
  const setup = await createTestRenderer({ width: 35, height: 4 });
  const stream = materialStreamFixture(
    () => undefined,
    () => frame.size,
  );
  try {
    const view = new TerminalMaterialRenderable(setup.renderer, {
      frame,
      position: "absolute",
      left: 5,
      top: 1,
      onInput(input) {
        if (input.kind === "mouse") {
          void stream
            .sendSemantic("p", input, context)
            .then((reply) => view.applyMouseResult(input, reply.forwarded));
        }
      },
    });
    const peer = new TerminalMaterialRenderable(setup.renderer, {
      frame,
      position: "absolute",
      left: 20,
      top: 1,
    });
    setup.renderer.root.add(view);
    setup.renderer.root.add(peer);
    await setup.flush();
    await setup.mockMouse.drag(5, 1, 8, 1);
    await setup.flush();
    expect(view.getSelectedText()).toBe("λ🙂é");
    await setup.mockInput.pressKeys(["\x1b[<35;14;2M"]);
    await setup.flush();
    expect(view.getSelectedText()).toBe("λ🙂é");
    expect(view.hasSelection()).toBe(true);
    expect(setup.renderer.getSelection()?.isDragging).toBe(false);
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("λ🙂é");
    expect(peer.getSelectedText()).toBe("");
    setup.renderer.clearSelection();
    await setup.flush();
    expect(view.hasSelection()).toBe(false);
    expect(view.getSelectedText()).toBe("");
    expect(setup.renderer.getSelection()).toBeNull();
  } finally {
    await setup.dispose();
  }
});

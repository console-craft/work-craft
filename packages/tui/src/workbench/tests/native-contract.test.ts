import { expect, test } from "bun:test";

import { EmbeddedTerminalRenderable, getLinkId, PasteEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { SemanticTerminalInput } from "@work-craft/server/client";

import { TerminalMaterialRenderable } from "@/workbench/terminal-material";

test("material admission snapshots Buffer paste without a native admission extension", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    let pending: SemanticTerminalInput | undefined;
    const terminal = new TerminalMaterialRenderable(setup.renderer, {
      frame: {
        size: { cols: 12, rows: 3 },
        cursor: { x: 0, y: 0, visible: false, style: "block", blinking: false },
        styles: [{ fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 }],
        rows: Array.from({ length: 3 }, () => [[12, " ", 1, 0]]),
      },
      onInput: (input) => {
        pending = input;
      },
    });
    setup.renderer.root.add(terminal);
    const bytes = Buffer.from("original");
    terminal.handlePaste(new PasteEvent(bytes));
    bytes.fill(120);
    expect(pending?.kind).toBe("paste");
    expect(
      pending && pending.kind === "paste"
        ? new TextDecoder().decode(Uint8Array.from(pending.bytes))
        : "",
    ).toBe("original");
  } finally {
    await setup.dispose();
  }
});

const hyperlinkTest = process.env.WORK_CRAFT_FORK_LINK_DIAGNOSTICS === "1" ? test : test.skip;
hyperlinkTest(
  "installed native binary retains the exact URL on both hidden wide cells",
  async () => {
    const setup = await createTestRenderer({ width: 12, height: 3 });
    try {
      const terminal = new EmbeddedTerminalRenderable(setup.renderer, { width: 12, height: 3 });
      setup.renderer.root.add(terminal);
      terminal.write("\x1b]8;;https://example.test/λ\x1b\\\x1b[8m界\x1b]8;;\x1b\\");
      await setup.renderOnce();
      const owner = setup.renderer.nativeScene.resourceContext;
      setup.renderer.currentRenderBuffer.withBuffers(({ attributes }) => {
        for (const x of [0, 1]) {
          expect(attributes[x]! & 255).toBe(64);
          expect(owner.renderLib.contextGetLinkUrl(owner.context, getLinkId(attributes[x]!))).toBe(
            "https://example.test/λ",
          );
        }
      });
    } finally {
      await setup.dispose();
    }
  },
);

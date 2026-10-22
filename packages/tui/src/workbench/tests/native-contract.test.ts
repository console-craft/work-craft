import { expect, test } from "bun:test";

import {
  type EmbeddedTerminalInputRequest,
  EmbeddedTerminalRenderable,
  getLinkId,
  PasteEvent,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

test("installed native admission snapshots Buffer paste before caller mutation", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    let pending: EmbeddedTerminalInputRequest | undefined;
    const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
      width: 12,
      height: 3,
      onInputAdmission: (request) => {
        pending = request;
      },
    });
    setup.renderer.root.add(terminal);
    const bytes = Buffer.from("original");
    terminal.handlePaste(new PasteEvent(bytes));
    bytes.fill(120);
    terminal.write("\x1b[?2004h");
    const output: string[] = [];
    pending!.resume((value) => output.push(new TextDecoder().decode(value)));
    expect(output).toEqual(["\x1b[200~original\x1b[201~"]);
  } finally {
    setup.renderer.destroy();
    await setup.renderer.closed;
  }
});

test("installed native binary retains the exact URL on both hidden wide cells", async () => {
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
    setup.renderer.destroy();
    await setup.renderer.closed;
  }
});

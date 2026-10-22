import { expect, test } from "bun:test";

import { EmbeddedTerminalRenderable, KeyEvent, MouseEvent, parseKeypress } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

const encode = (text: string) => new TextEncoder().encode(text);
const modes = "\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1004h";
const expected = ["\x1bOA", "\x1b[200~paste\x1b[201~", "\x1b[<0;3;2M", "\x1b[O"];

function candidate(setup: TestRendererSetup) {
  const output: string[] = [];
  let resizing = false;
  const bytes: Uint8Array[] = [];
  const pending: (() => void)[] = [];
  let retained = 0;
  function write(data: Uint8Array): void {
    for (let offset = 0; offset < data.byteLength; offset += 8192) {
      terminal.write(data.subarray(offset, offset + 8192));
    }
  }
  const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
    width: 30,
    height: 6,
    selectable: false,
    onData: (bytes) => output.push(new TextDecoder().decode(bytes)),
    onTerminalResize(cols, rows) {
      if (!resizing || cols !== 40 || rows !== 7) {
        return;
      }
      resizing = false;
      for (const data of bytes.splice(0)) {
        write(data);
      }
      for (const resume of pending.splice(0)) {
        resume();
      }
      retained = 0;
    },
  });
  setup.renderer.root.add(terminal);
  terminal.focus();
  setup.renderer.keyInput.on("keypress", (event) => {
    if (resizing) {
      event.preventDefault();
      const key = new KeyEvent(event);
      pending.push(() => output.push(new TextDecoder().decode(terminal.encodeKey(key))));
    }
  });
  setup.renderer.keyInput.on("paste", (event) => {
    if (resizing) {
      event.preventDefault();
      const paste = new Uint8Array(event.bytes);
      pending.push(() => output.push(new TextDecoder().decode(terminal.encodePaste(paste))));
    }
  });
  return {
    terminal,
    output,
    receive(data: Uint8Array) {
      if (resizing) {
        if (retained + data.byteLength > 2 * 1024 * 1024) {
          throw new Error("Prototype output limit");
        }
        bytes.push(data);
        retained += data.byteLength;
      } else {
        write(data);
      }
    },
    resize() {
      resizing = true;
      terminal.width = 40;
      terminal.height = 7;
    },
  };
}

function physicalInput(setup: TestRendererSetup, terminal: EmbeddedTerminalRenderable): void {
  setup.renderer.keyInput.processParsedKey(parseKeypress("\x1b[A")!);
  setup.renderer.keyInput.processPaste(encode("paste"));
  terminal.processMouseEvent(
    new MouseEvent(terminal, {
      type: "down",
      button: 0,
      x: 2,
      y: 1,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
  terminal.blur();
}

test("received modes precede key paste mouse and focus encoding without backlog", async () => {
  const setup = await createTestRenderer({ width: 50, height: 10 });
  try {
    const client = candidate(setup);
    await setup.flush();
    client.receive(encode(modes));
    physicalInput(setup, client.terminal);
    expect(client.output).toEqual(expected);
  } finally {
    await setup.dispose();
  }
});

test("received modes after a pending canonical resize precede every input kind", async () => {
  const setup = await createTestRenderer({ width: 50, height: 10 });
  try {
    const client = candidate(setup);
    await setup.flush();
    client.resize();
    client.receive(encode(modes));
    physicalInput(setup, client.terminal);
    const beforeCommit = [...client.output];
    const physicallyBlurred = !client.terminal.focused;
    await setup.flush();
    const afterCommit = [...client.output];
    await Bun.write(
      "client-observation.json",
      JSON.stringify({ beforeCommit, afterCommit, physicallyBlurred, expected }, null, 2),
    );
    expect(physicallyBlurred).toBe(true);
    expect(beforeCommit).toEqual([]);
    expect(afterCommit).toEqual(expected);
  } finally {
    await setup.dispose();
  }
});

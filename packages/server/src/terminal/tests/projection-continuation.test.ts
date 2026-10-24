import { expect, test } from "bun:test";

import { createTerminalProjection } from "../projection";

const encode = (text: string) => new TextEncoder().encode(text);

function continuation(split: boolean, resize: boolean) {
  const parser = createTerminalProjection({ cols: 20, rows: 6 });
  try {
    const prefix = encode("\x1b[?1h\x1b[?2004hλ🙂\x1b[2;3H\x1b]2;title\x07");
    for (const chunk of split ? Array.from(prefix, (byte) => Uint8Array.of(byte)) : [prefix]) {
      parser.write(chunk);
    }
    if (resize) {
      parser.resize({ cols: 30, rows: 8 });
      parser.resize({ cols: 25, rows: 7 });
    }
    parser.write(encode("X\x1b[6n"));
    const reply = new TextDecoder().decode(parser.replies());
    expect(parser.replies()).toHaveLength(0);
    return {
      frame: parser.frame(0),
      reply,
      key: new TextDecoder().decode(parser.encode({ kind: "key", key: { key: "arrow_up" } })),
      paste: new TextDecoder().decode(parser.encodePaste(encode("paste"))),
    };
  } finally {
    parser.destroy();
  }
}

for (const resize of [false, true]) {
  test(`production parser preserves split UTF-8/CSI/OSC, input modes and one reply (resizes=${resize})`, () => {
    const full = continuation(false, resize);
    expect(continuation(true, resize)).toEqual(full);
    expect(full.reply).toBe("\x1b[2;4R");
    expect(full.key).toBe("\x1bOA");
    expect(full.paste).toBe("\x1b[200~paste\x1b[201~");
  });
}

import { expect, test } from "bun:test";

import { KeyEvent, parseKeypress, resolveRenderLib } from "@opentui/core";

import { semanticTerminalKey } from "@/workbench/terminal-semantic-input";

for (const [name, raw, expected] of [
  ["legacy Ctrl+backslash", "\x1c", [28]],
  ["legacy Ctrl+right bracket", "\x1d", [29]],
  ["legacy Ctrl+caret", "\x1e", [30]],
  ["legacy Ctrl+underscore", "\x1f", [31]],
  ["Kitty Ctrl+backslash", "\x1b[92;5u", [28]],
  ["Kitty Ctrl+right bracket", "\x1b[93;5u", [29]],
  ["Kitty Ctrl+caret", "\x1b[94;5u", [30]],
  ["Kitty Ctrl+underscore", "\x1b[95;5u", [31]],
  ["Alt+space", "\x1b ", [27, 32]],
  ["Ctrl+A", "\x01", [1]],
  ["Tab", "\t", [9]],
  ["Escape", "\x1b", [27]],
  ["up arrow", "\x1b[A", [27, 91, 65]],
  ["printable backslash", "\\", [92]],
] as const) {
  test(`${name} survives semantic translation into child bytes`, () => {
    const lib = resolveRenderLib();
    const context = lib.createContext({ objectCapacity: 8, renderCellsMax: 2000 });
    const terminal = lib.createContextEmbeddedTerminal(context, { cols: 20, rows: 5 });
    try {
      const parsed = parseKeypress(raw, { useKittyKeyboard: true });
      expect(parsed).toBeDefined();
      const input = semanticTerminalKey(new KeyEvent(parsed!));
      if (input.kind !== "key") {
        throw new Error("Expected semantic key input");
      }
      expect([...lib.contextEmbeddedTerminalEncodeKey(context, terminal, input.key)]).toEqual([
        ...expected,
      ]);
    } finally {
      lib.destroyContextEmbeddedTerminal(context, terminal);
      lib.destroyContext(context);
    }
  });
}

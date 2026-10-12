import { expect, test } from "bun:test";

import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";

import { Input } from "@/ui/controls/input";
import { Textarea } from "@/ui/controls/textarea";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

for (const { kind, selectable } of [
  { kind: "input", selectable: true },
  { kind: "textarea", selectable: true },
  { kind: "input", selectable: false },
  { kind: "textarea", selectable: false },
] as const) {
  test(`${kind} (selectable=${selectable}) consumes Ctrl+C to clear text and passes it through once empty`, async () => {
    const changes: string[] = [];
    const consumerKeys: KeyEvent[] = [];
    const appKeys: KeyEvent[] = [];
    let handleEmptyCtrlC = false;
    let editor: TextareaRenderable | null = null;
    function Fixture() {
      const [value, setValue] = useState("draft🐇界");
      function onInput(next: string) {
        changes.push(next);
        setValue(next);
      }
      const shared = {
        id: "editor",
        focused: true,
        selectable,
        onKeyDown: (event: KeyEvent) => {
          consumerKeys.push(event);
          if (handleEmptyCtrlC && event.ctrl && event.name === "c") {
            event.preventDefault();
            event.stopPropagation();
          }
        },
      };
      return (
        <ThemeProvider theme={defaultTheme}>
          {kind === "input" ? (
            <Input {...shared} value={value} onInput={onInput} />
          ) : (
            <Textarea
              {...shared}
              initialValue={"first🐇\nsecond界"}
              height={3}
              onContentChange={() => {
                if (editor) {
                  changes.push(editor.plainText);
                }
              }}
            />
          )}
          <Input id="sibling" value="untouched" />
          <Input id="disabled" value="disabled" disabled />
        </ThemeProvider>
      );
    }
    const { renderer, mockInput, flush } = await testRender(<Fixture />, {
      width: 40,
      height: 8,
      kittyKeyboard: true,
      exitOnCtrlC: false,
    });
    renderer.keyInput.on("keypress", (event) => {
      queueMicrotask(() => {
        if (!event.defaultPrevented && !event.propagationStopped) {
          appKeys.push(event);
        }
      });
    });
    try {
      await flush();
      editor = renderer.root.findDescendantById("editor") as TextareaRenderable;
      await act(async () => mockInput.pressKey("c", { ctrl: true, shift: true }));
      expect(editor.plainText).toBe(kind === "input" ? "draft🐇界" : "first🐇\nsecond界");
      expect(changes).toEqual([]);
      expect(consumerKeys).toHaveLength(1);
      consumerKeys.length = 0;
      appKeys.length = 0;
      // Clearing must replace a partial selection, not just delete that selection.
      act(() => {
        editor!.cursorOffset = 1;
        editor!.moveCursorRight({ select: true });
      });
      await act(async () => mockInput.pressKey("c", { ctrl: true }));
      expect(editor.plainText).toBe("");
      expect(editor.cursorOffset).toBe(0);
      expect(editor.hasSelection()).toBe(false);
      expect(editor.selectable).toBe(selectable);
      expect(changes).toEqual([""]);
      expect(consumerKeys).toEqual([]);
      expect(appKeys).toEqual([]);
      expect((renderer.root.findDescendantById("sibling") as TextareaRenderable).plainText).toBe(
        "untouched",
      );
      expect((renderer.root.findDescendantById("disabled") as TextareaRenderable).plainText).toBe(
        "disabled",
      );

      await act(async () => mockInput.pressKey("c", { ctrl: true }));
      expect(consumerKeys).toHaveLength(1);
      expect(appKeys).toHaveLength(1);
      expect(consumerKeys[0]!.defaultPrevented).toBe(false);
      expect(consumerKeys[0]!.propagationStopped).toBe(false);
      expect(changes).toEqual([""]);

      handleEmptyCtrlC = true;
      appKeys.length = 0;
      await act(async () => mockInput.pressKey("c", { ctrl: true }));
      expect(consumerKeys).toHaveLength(2);
      expect(appKeys).toEqual([]);
      handleEmptyCtrlC = false;

      await act(async () => mockInput.typeText(" "));
      consumerKeys.length = 0;
      appKeys.length = 0;
      changes.length = 0;
      await act(async () => mockInput.pressKey("c", { ctrl: true }));
      expect(editor.plainText).toBe("");
      expect(changes).toEqual([""]);
      expect(consumerKeys).toEqual([]);
      expect(appKeys).toEqual([]);
    } finally {
      act(() => renderer.destroy());
    }
  });
}

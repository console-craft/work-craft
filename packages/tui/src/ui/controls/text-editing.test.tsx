import { expect, test } from "bun:test";

import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
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

for (const kind of ["input", "textarea"] as const) {
  test(`${kind} preserves native submission alongside custom bindings and releases editing focus when disabled`, async () => {
    const submissions: string[] = [];
    let disable!: Dispatch<SetStateAction<boolean>>;
    let cancel = false;
    let editor: TextareaRenderable | null = null;
    function Fixture() {
      const [disabled, setDisabled] = useState(false);
      disable = setDisabled;
      const props = {
        id: "editor",
        focused: true,
        disabled,
        width: 20,
        keyBindings: [{ name: "s", ctrl: true, action: "submit" as const }],
        onKeyDown: (event: KeyEvent) => {
          if (cancel) {
            event.preventDefault();
          }
        },
      };
      return (
        <ThemeProvider theme={defaultTheme}>
          {kind === "input" ? (
            <Input {...props} value="draft" onSubmit={(value) => submissions.push(value)} />
          ) : (
            <Textarea
              {...props}
              height={3}
              initialValue="draft"
              onSubmit={() => submissions.push(editor!.plainText)}
            />
          )}
        </ThemeProvider>
      );
    }
    const setup = await testRender(<Fixture />, { width: 25, height: 5, kittyKeyboard: true });
    try {
      await act(async () => setup.flush());
      editor = setup.renderer.root.findDescendantById("editor") as TextareaRenderable;
      act(() => editor!.gotoBufferEnd());
      if (kind === "textarea") {
        act(() => setup.mockInput.pressEnter({ shift: true }));
        expect(editor.plainText).toBe("draft\n");
        expect(submissions).toEqual([]);
      }
      const text = editor.plainText;
      act(() => setup.mockInput.pressEnter(kind === "textarea" ? { ctrl: true } : {}));
      expect(submissions).toEqual([text]);
      act(() => setup.mockInput.pressKey("s", { ctrl: true }));
      expect(submissions).toEqual([text, text]);
      cancel = true;
      act(() => setup.mockInput.pressKey("s", { ctrl: true }));
      cancel = false;
      expect(submissions).toHaveLength(2);
      act(() => disable(true));
      await act(async () => setup.flush());
      expect(editor.focusable).toBe(false);
      expect(editor.focused).toBe(false);
      const disabledText = editor.plainText;
      await act(async () => setup.mockInput.typeText("ignored"));
      act(() => setup.mockInput.pressKey("s", { ctrl: true }));
      expect(editor.plainText).toBe(disabledText);
      expect(submissions).toHaveLength(2);
      act(() => disable(false));
      await act(async () => setup.flush());
      act(() => editor!.focus());
      act(() => setup.mockInput.pressKey("s", { ctrl: true }));
      expect(submissions.at(-1)).toBe(disabledText);
      expect(submissions).toHaveLength(3);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

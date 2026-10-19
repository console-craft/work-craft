import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor, type TextRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { Checkbox, type CheckboxProps } from "@/ui/controls/checkbox";
import { Switch } from "@/ui/controls/switch";
import { Toggle } from "@/ui/controls/toggle";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

// These controls deliberately share completed-click and caller-cancellation contracts.
for (const kind of ["button", "checkbox", "switch", "toggle"] as const) {
  test(`${kind} activates only on a completed primary click and cancels pending activation when disabled`, async () => {
    let activations = 0;
    let cancelDown = false;
    let cancelUp = false;
    let disable!: Dispatch<SetStateAction<boolean>>;
    function Fixture() {
      const [disabled, setDisabled] = useState(false);
      disable = setDisabled;
      const props = {
        id: "control",
        width: 12,
        disabled,
        onMouseDown: (event: Parameters<NonNullable<CheckboxProps["onMouseDown"]>>[0]) => {
          if (cancelDown) {
            event.preventDefault();
          }
        },
        onMouseUp: (event: Parameters<NonNullable<CheckboxProps["onMouseUp"]>>[0]) => {
          if (cancelUp) {
            event.preventDefault();
          }
        },
      } satisfies CheckboxProps;
      const activate = () => activations++;
      return (
        <ThemeProvider theme={defaultTheme}>
          {kind === "button" ? (
            <Button {...props} onPress={activate}>
              Label
            </Button>
          ) : kind === "checkbox" ? (
            <Checkbox {...props} onCheckedChange={activate}>
              Label
            </Checkbox>
          ) : kind === "switch" ? (
            <Switch {...props} onCheckedChange={activate}>
              Label
            </Switch>
          ) : (
            <Toggle {...props} onPressedChange={activate}>
              Label
            </Toggle>
          )}
        </ThemeProvider>
      );
    }
    const setup = await testRender(<Fixture />, { width: 20, height: 5 });
    try {
      await act(async () => setup.flush());
      const control = setup.renderer.root.findDescendantById("control")!;
      const x = control.screenX + 1;
      const y = control.screenY;
      await act(async () => setup.mockMouse.pressDown(x, y));
      expect(activations).toBe(0);
      await act(async () => setup.mockMouse.release(x, y));
      expect(activations).toBe(1);
      act(() =>
        setup.renderer.keyInput.processParsedKey({
          name: kind === "button" ? "return" : "space",
          repeated: true,
          ctrl: false,
          meta: false,
          shift: false,
          option: false,
          sequence: "",
          raw: "",
          number: false,
          eventType: "repeat",
          source: "kitty",
        }),
      );
      expect(activations).toBe(1);
      cancelDown = true;
      await act(async () => setup.mockMouse.click(x, y));
      cancelDown = false;
      cancelUp = true;
      await act(async () => setup.mockMouse.click(x, y));
      cancelUp = false;
      await act(async () => setup.mockMouse.click(x, y, 2));
      await act(async () => setup.mockMouse.pressDown(x, y));
      await act(async () => setup.mockMouse.moveTo(x, y + 3));
      await act(async () => setup.mockMouse.release(x, y + 3));
      expect(activations).toBe(1);
      await act(async () => setup.mockMouse.pressDown(x, y));
      act(() => disable(true));
      await act(async () => setup.flush());
      await act(async () => setup.mockMouse.release(x, y));
      await act(async () => setup.mockMouse.click(x, y));
      act(() => setup.mockInput.pressKey(" "));
      expect(activations).toBe(1);
      expect(control.focusable).toBe(false);
      expect(control.focused).toBe(false);
      expect(getControlHints(control)).toEqual([]);
      act(() => disable(false));
      await act(async () => setup.flush());
      await act(async () => setup.mockMouse.pressDown(x, y));
      act(() => disable(true));
      await act(async () => setup.flush());
      act(() => disable(false));
      await act(async () => setup.flush());
      await act(async () => setup.mockMouse.release(x, y));
      expect(activations).toBe(1);
      await act(async () => setup.mockMouse.click(x, y));
      expect(activations).toBe(2);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const [kind, Component] of [
  ["checkbox", Checkbox],
  ["switch", Switch],
] as const) {
  test(`${kind} keeps checked visuals parent-owned and updates focus and disabled colors`, async () => {
    const changes: boolean[] = [];
    let update!: Dispatch<SetStateAction<CheckboxProps>>;
    let cancel = false;
    function Fixture() {
      const [props, setProps] = useState<CheckboxProps>({ checked: false });
      update = setProps;
      return (
        <ThemeProvider theme={defaultTheme}>
          <Component
            id="control"
            width={12}
            onCheckedChange={(value) => changes.push(value)}
            onKeyDown={(event) => {
              if (cancel) {
                event.preventDefault();
              }
            }}
            {...props}
          >
            Label
          </Component>
        </ThemeProvider>
      );
    }
    const setup = await testRender(<Fixture />, { width: 20, height: 3 });
    try {
      await act(async () => setup.flush());
      const control = setup.renderer.root.findDescendantById("control") as BoxRenderable;
      const initial = setup.captureCharFrame();
      expect(initial).toContain(kind === "checkbox" ? "□" : "■□");
      act(() => control.focus());
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressKey(" "));
      await act(async () => setup.flush());
      expect(changes).toEqual([true]);
      expect(setup.captureCharFrame()).toBe(initial);
      expect(control.backgroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.focus).toInts(),
      );
      const label = control
        .getChildren()
        .find((node) => (node as TextRenderable).plainText === "Label") as TextRenderable;
      expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.focusForeground).toInts());
      cancel = true;
      act(() => setup.mockInput.pressKey(" "));
      cancel = false;
      expect(changes).toEqual([true]);
      act(() => update({ checked: true }));
      await act(async () => setup.flush());
      expect(setup.captureCharFrame()).not.toBe(initial);
      expect(setup.captureCharFrame()).toContain(kind === "checkbox" ? "▣" : "□■");
      act(() => setup.mockInput.pressKey(" "));
      expect(changes).toEqual([true, false]);
      act(() => update({ checked: true, disabled: true }));
      await act(async () => setup.flush());
      expect(label.fg.toInts()).toEqual(
        parseColor(
          defaultTheme.colors[kind === "checkbox" ? "mutedForeground" : "secondary"],
        ).toInts(),
      );
      expect(control.focused).toBe(false);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("indeterminate Checkbox requests checked and distinguishes all three indicators", async () => {
  const changes: boolean[] = [];
  let update!: Dispatch<SetStateAction<CheckboxProps>>;
  function Fixture() {
    const [props, setProps] = useState<CheckboxProps>({ indeterminate: true });
    update = setProps;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Checkbox id="control" focused onCheckedChange={(value) => changes.push(value)} {...props}>
          Label
        </Checkbox>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 20, height: 3 });
  try {
    await act(async () => setup.flush());
    const control = setup.renderer.root.findDescendantById("control")!;
    const indicator = control.getChildren()[0] as TextRenderable;
    expect(indicator.plainText).toBe("☒");
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual([true]);
    act(() => update({ checked: true, indeterminate: true }));
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual([true, true]);
    act(() => update({ checked: true }));
    await act(async () => setup.flush());
    expect(indicator.plainText).toBe("▣");
    act(() => update({ checked: false }));
    await act(async () => setup.flush());
    expect(indicator.plainText).toBe("□");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

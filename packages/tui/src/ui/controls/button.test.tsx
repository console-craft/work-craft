import { expect, test } from "bun:test";

import { parseColor, type TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { Spinner } from "@/ui/components/spinner";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("button accepts composed content while owning activation and disabled behavior", async () => {
  let presses = 0;
  let setDisabled!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [disabled, updateDisabled] = useState(false);
    setDisabled = updateDisabled;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Button id="button" focused disabled={disabled} onPress={() => presses++}>
          <HStack>
            <Spinner id="spinner" color="error" />
            <Icon name="check" fg="success" />
            <Text id="label" fg="info">
              Saving...
            </Text>
          </HStack>
        </Button>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 3 });
  try {
    await act(async () => setup.flush());
    const button = setup.renderer.root.findDescendantById("button")!;
    const label = setup.renderer.root.findDescendantById("label") as TextRenderable;
    const spinner = setup.renderer.root.findDescendantById("spinner") as TextRenderable;
    expect(setup.captureCharFrame()).toContain("Saving...");
    expect(spinner.fg.toInts()).toEqual(parseColor(defaultTheme.colors.error).toInts());
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.info).toInts());
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    expect(getControlHints(button)).toEqual([{ keys: "Enter/Space", label: "Activate" }]);

    act(() => setup.mockInput.pressEnter());
    expect(presses).toBe(1);
    act(() => setup.mockInput.pressKey(" "));
    expect(presses).toBe(2);
    await act(async () => setup.mockMouse.click(label.screenX + 1, label.screenY));
    expect(presses).toBe(3);

    act(() => setDisabled(true));
    await act(async () => setup.flush());
    expect(button.focusable).toBe(false);
    expect(button.focused).toBe(false);
    expect(getControlHints(button)).toEqual([]);
    await act(async () => setup.mockMouse.click(label.screenX + 1, label.screenY));
    act(() => setup.mockInput.pressEnter());
    expect(presses).toBe(3);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("plain button labels retain their state-dependent colors and render zero", async () => {
  let setDisabled!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [disabled, updateDisabled] = useState(false);
    setDisabled = updateDisabled;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Button id="plain" disabled={disabled}>
            Save
          </Button>
          <Button>{0}</Button>
        </Stack>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 20, height: 5 });
  try {
    await act(async () => setup.flush());
    const button = setup.renderer.root.findDescendantById("plain")!;
    const label = button.getChildren()[0] as TextRenderable;
    expect(setup.captureCharFrame()).toContain("Save");
    expect(setup.captureCharFrame()).toContain("0");
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.primaryForeground).toInts());

    act(() => button.focus());
    await act(async () => setup.flush());
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());

    act(() => setDisabled(true));
    await act(async () => setup.flush());
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.mutedForeground).toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

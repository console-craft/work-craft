import { expect, test } from "bun:test";

import { type BoxRenderable, type InputRenderable, parseColor } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createRef, type Dispatch, type SetStateAction, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/components/collapsible";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { FocusManager } from "@/ui/focus-manager";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("collapsible trigger forwards native refs, hints, and keyboard focus", async () => {
  const ref = createRef<BoxRenderable>();
  const changes: boolean[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Collapsible onOpenChange={(open) => changes.push(open)}>
        <CollapsibleTrigger id="trigger" ref={ref} focused>
          Settings
        </CollapsibleTrigger>
        <CollapsibleContent id="content">
          <Text>Details</Text>
        </CollapsibleContent>
      </Collapsible>
    </ThemeProvider>,
    { width: 30, height: 6, kittyKeyboard: true },
  );
  async function press(name: string) {
    act(() => setup.mockInput.pressKey(name));
    await act(async () => setup.flush());
  }
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger") as BoxRenderable;
    const content = setup.renderer.root.findDescendantById("content")!;
    expect(ref.current).toBe(trigger);
    expect(trigger.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.focus).toInts(),
    );
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space", label: "Expand" });
    expect(content.visible).toBe(false);
    await press("RETURN");
    expect(content.visible).toBe(true);
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space", label: "Collapse" });
    await press(" ");
    await press("ARROW_RIGHT");
    await press("l");
    await press("ARROW_LEFT");
    await press("h");
    expect(changes).toEqual([true, false, true, false]);

    // The terminal mock does not expose repeated events or raw Linefeed names.
    for (const [name, repeated] of [
      ["linefeed", false],
      ["return", true],
    ] as const) {
      act(() =>
        setup.renderer.keyInput.processParsedKey({
          name,
          repeated,
          ctrl: false,
          meta: false,
          shift: false,
          option: false,
          sequence: "",
          raw: "",
          number: false,
          eventType: repeated ? "repeat" : "press",
          source: "kitty",
        }),
      );
      await act(async () => setup.flush());
      expect(content.visible).toBe(true);
    }
    act(() => setup.mockInput.pressEnter({ ctrl: true }));
    await act(async () => setup.flush());
    expect(changes).toEqual([true, false, true, false, true]);
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(ref.current).toBeNull();
});

test("collapsible mouse activation waits for release and preserves callback receivers", async () => {
  const changes: boolean[] = [];
  const receivers: BoxRenderable[] = [];
  let cancelDown = false;
  let cancelUp = false;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Collapsible onOpenChange={(open) => changes.push(open)}>
        <CollapsibleTrigger
          id="trigger"
          onMouseDown={function (event) {
            receivers.push(this);
            if (cancelDown) {
              event.preventDefault();
            }
          }}
          onMouseUp={function (event) {
            receivers.push(this);
            if (cancelUp) {
              event.preventDefault();
            }
          }}
        >
          Settings
        </CollapsibleTrigger>
      </Collapsible>
    </ThemeProvider>,
    { width: 30, height: 5 },
  );
  try {
    await setup.flush();
    const trigger = setup.renderer.root.findDescendantById("trigger") as BoxRenderable;
    const x = trigger.screenX + 1;
    const y = trigger.screenY;
    await act(async () => setup.mockMouse.pressDown(x, y));
    expect(changes).toEqual([]);
    await act(async () => setup.mockMouse.release(x, y));
    await act(async () => setup.flush());
    expect(changes).toEqual([true]);
    expect(receivers).toEqual([trigger, trigger]);

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
    expect(changes).toEqual([true]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled collapse preserves content state and delegates hidden focus repair", async () => {
  let setOpen!: Dispatch<SetStateAction<boolean>>;
  const changes: boolean[] = [];
  function Fixture() {
    const [open, updateOpen] = useState(true);
    setOpen = updateOpen;
    return (
      <ThemeProvider theme={defaultTheme}>
        <FocusManager focusScopeId="scope" />
        <Stack id="scope" focusable>
          <Collapsible open={open} onOpenChange={(next) => changes.push(next)}>
            <CollapsibleTrigger id="trigger">Settings</CollapsibleTrigger>
            <CollapsibleContent id="content">
              <Input id="input" />
            </CollapsibleContent>
          </Collapsible>
          <Button id="after">After</Button>
        </Stack>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 8 });
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    const content = setup.renderer.root.findDescendantById("content")!;
    const input = setup.renderer.root.findDescendantById("input")!;
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(changes).toEqual([false]);
    expect(content.visible).toBe(true);
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    act(() => setup.mockInput.pressKey("t"));
    act(() => setOpen(false));
    await act(async () => setup.flush());
    expect(input.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    act(() => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
    act(() => setOpen(true));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("input")).toBe(input);
    expect((input as InputRenderable).value).toBe("t");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("read-only controlled collapsibles do not advertise actions", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Collapsible open>
        <CollapsibleTrigger id="trigger" focused>
          Settings
        </CollapsibleTrigger>
        <CollapsibleContent id="content">
          <Text>Details</Text>
        </CollapsibleContent>
      </Collapsible>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    expect(getControlHints(trigger)).toEqual([]);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("content")!.visible).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

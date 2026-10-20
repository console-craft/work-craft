import { expect, test } from "bun:test";

import { CliRenderEvents, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { act, type Dispatch, type SetStateAction, useLayoutEffect, useState } from "react";

import { testRender } from "@/tests/support/render";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { Radio, RadioGroup } from "@/ui/controls/radio";
import { Toggle, ToggleGroup } from "@/ui/controls/toggle";
import { FocusManager, useFocusScope, useNativeFocus } from "@/ui/focus-manager";
import type { FocusScopeController } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

for (const kind of ["radio", "toggle"] as const) {
  test(`${kind} mouse entry keeps keyboard activation on the clicked option`, async () => {
    const changes: (string | undefined)[] = [];
    function Fixture() {
      const [value, setValue] = useState<string | undefined>("first");
      function change(next: string | undefined) {
        changes.push(next);
        setValue(next);
      }
      return (
        <ThemeProvider theme={defaultTheme}>
          <Button focused>Outside</Button>
          {kind === "radio" ? (
            <RadioGroup id="group" value={value} onValueChange={change}>
              <Radio value="first">First</Radio>
              <Radio id="second" value="second">
                Second
              </Radio>
            </RadioGroup>
          ) : (
            <ToggleGroup id="group" type="single" value={value} onValueChange={change}>
              <Toggle value="first">First</Toggle>
              <Toggle id="second" value="second">
                Second
              </Toggle>
            </ToggleGroup>
          )}
        </ThemeProvider>
      );
    }
    const { renderer, mockInput, mockMouse, flush } = await testRender(<Fixture />, {
      width: 40,
      height: 10,
    });
    try {
      await flush();
      const group = renderer.root.findDescendantById("group")!;
      const second = renderer.root.findDescendantById("second")!;
      expect(group.focused).toBe(false);
      await act(async () => mockMouse.click(second.screenX + 1, second.screenY));
      expect(renderer.currentFocusedRenderable).toBe(group);
      expect(changes).toEqual(["second"]);
      await act(async () => mockInput.pressKey(" "));
      expect(changes).toEqual(kind === "radio" ? ["second"] : ["second", undefined]);
    } finally {
      act(() => renderer.destroy());
    }
  });

  test(`${kind} scope entry initializes its candidate and keeps local keys within one Tab stop`, async () => {
    const changes: (string | undefined)[] = [];
    let presses = 0;
    function Fixture() {
      const [value, setValue] = useState<string>();
      function change(next: string | undefined) {
        changes.push(next);
        setValue(next);
      }
      return (
        <ThemeProvider theme={defaultTheme}>
          <FocusManager focusScopeId="scope" />
          <Box id="scope" focusable>
            {kind === "radio" ? (
              <RadioGroup id="group" focused value={value} onValueChange={change}>
                <Radio value="disabled" disabled>
                  Disabled
                </Radio>
                <Radio value="first">First</Radio>
                <Radio value="second">Second</Radio>
              </RadioGroup>
            ) : (
              <ToggleGroup id="group" focused type="single" value={value} onValueChange={change}>
                <Toggle value="disabled" disabled>
                  Disabled
                </Toggle>
                <Toggle value="first">First</Toggle>
                <Toggle value="second">Second</Toggle>
              </ToggleGroup>
            )}
            <Button id="after" onPress={() => presses++}>
              After
            </Button>
          </Box>
          <Button id="outside">Outside</Button>
        </ThemeProvider>
      );
    }
    const { renderer, mockInput, flush } = await testRender(<Fixture />, {
      width: 40,
      height: 10,
      kittyKeyboard: true,
    });
    try {
      await act(async () => flush());
      const group = renderer.root.findDescendantById("group")!;
      expect(renderer.currentFocusedRenderable).toBe(group);
      expect(getControlHints(group)).toEqual([
        kind === "radio"
          ? { keys: "Space", label: "Select" }
          : { keys: "Enter/Space", label: "Toggle" },
      ]);
      // No blur/refocus or navigation key should be needed to initialize a candidate.
      await act(async () => mockInput.pressKey(" "));
      expect(changes).toEqual(["first"]);
      await act(async () => mockInput.pressKey("j"));
      expect(renderer.currentFocusedRenderable).toBe(group);
      expect(changes).toEqual(["first"]);
      await act(async () => mockInput.pressKey(" "));
      expect(changes).toEqual(["first", "second"]);
      await act(async () => mockInput.pressTab());
      expect(renderer.currentFocusedRenderable?.id).toBe("after");
      await act(async () => mockInput.pressKeys(["k", " "]));
      expect(presses).toBe(1);
      expect(changes).toEqual(["first", "second"]);
      await act(async () => mockInput.pressTab());
      expect(renderer.currentFocusedRenderable).toBe(group);
      await act(async () => mockInput.pressTab({ shift: true }));
      expect(renderer.currentFocusedRenderable?.id).toBe("after");
    } finally {
      act(() => renderer.destroy());
    }
  });
}

test("demo scope repairs lifecycle changes, wraps plain Tab, and cleans up subscriptions", async () => {
  let disable!: Dispatch<SetStateAction<boolean>>;
  let removeFirst!: Dispatch<SetStateAction<boolean>>;
  let removeSecond!: Dispatch<SetStateAction<boolean>>;
  let manage!: Dispatch<SetStateAction<boolean>>;
  let previousFrameCount = 0;
  let previousFocusCount = 0;

  function SubscriptionBaseline() {
    const renderer = useRenderer();
    useLayoutEffect(() => {
      previousFrameCount = renderer.listenerCount(CliRenderEvents.FRAME);
      previousFocusCount = renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE);
    }, [renderer]);
    return null;
  }

  function Fixture() {
    const [disabled, setDisabled] = useState(false);
    const [present, setPresent] = useState(true);
    const [remaining, setRemaining] = useState(true);
    const [managed, setManaged] = useState(true);
    disable = setDisabled;
    removeFirst = setPresent;
    removeSecond = setRemaining;
    manage = setManaged;
    return (
      <ThemeProvider theme={defaultTheme}>
        {managed ? <FocusManager focusScopeId="scope" /> : null}
        <Box id="scope" focusable>
          {present ? (
            <Button id="first" disabled={disabled}>
              First
            </Button>
          ) : null}
          <Box visible={false}>
            <Button id="hidden">Hidden</Button>
          </Box>
          {remaining ? <Button id="second">Second</Button> : null}
        </Box>
        <Button id="outside">Outside</Button>
      </ThemeProvider>
    );
  }

  const setup = await testRender(
    <>
      <SubscriptionBaseline />
      <Fixture />
    </>,
    { width: 40, height: 10, kittyKeyboard: true },
  );
  const { renderer, mockInput, flush } = setup;
  try {
    await flush();
    const first = renderer.root.findDescendantById("first") as Renderable;
    const scope = renderer.root.findDescendantById("scope") as Renderable;
    expect(renderer.currentFocusedRenderable?.id).toBe("first");
    expect(renderer.listenerCount(CliRenderEvents.FRAME)).toBe(previousFrameCount + 1);
    expect(renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE)).toBe(previousFocusCount + 1);
    act(() => mockInput.pressTab());
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("second");
    act(() => mockInput.pressTab());
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("first");
    act(() => mockInput.pressTab({ shift: true }));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("second");
    for (const modifiers of [{ ctrl: true }, { meta: true }, { super: true }, { hyper: true }]) {
      act(() => mockInput.pressTab(modifiers));
      await flush();
      expect(renderer.currentFocusedRenderable?.id).toBe("second");
    }
    act(() => mockInput.pressTab());
    await flush();
    act(() => disable(true));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("second");
    expect(first.focused).toBe(false);
    act(() => disable(false));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("second");
    act(() => removeSecond(false));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("first");
    act(() => removeFirst(false));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("scope");
    act(() => {
      scope.blur();
      manage(false);
    });
    await flush();
    expect(renderer.listenerCount(CliRenderEvents.FRAME)).toBe(previousFrameCount);
    expect(renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE)).toBe(previousFocusCount);
    const outside = renderer.root.findDescendantById("outside") as Renderable;
    act(() => outside.focus());
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => renderer.destroy());
  }
});

test("scope hooks use the current request and cache history by key and native root", async () => {
  type Request = Parameters<typeof useFocusScope>[0];
  let request!: Dispatch<SetStateAction<Request>>;
  let removeMiddle!: Dispatch<SetStateAction<boolean>>;
  let replaceRoot!: Dispatch<SetStateAction<number>>;
  let controller!: FocusScopeController;

  function Fixture() {
    const [current, setCurrent] = useState<Request>({
      scopeId: "scope",
      scopeKey: "one",
      initialFocusId: "middle",
    });
    const [middle, setMiddle] = useState(true);
    const [version, setVersion] = useState(0);
    request = setCurrent;
    removeMiddle = setMiddle;
    replaceRoot = setVersion;
    controller = useFocusScope(current);
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box key={version} id="scope" focusable>
          <Button id="first">First</Button>
          {middle ? <Button id="middle">Middle</Button> : null}
          <Button id="last">Last</Button>
        </Box>
        <Button id="outside">Outside</Button>
      </ThemeProvider>
    );
  }

  const { renderer, flush } = await testRender(<Fixture />, { width: 40, height: 10 });
  try {
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("middle");
    const buffered = controller;
    act(() => request({ scopeId: "scope", scopeKey: "one", initialFocusId: "first" }));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("middle");
    act(() => removeMiddle(false));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("last");
    act(() => request({ scopeId: "scope", scopeKey: "two", initialFocusId: "first" }));
    await flush();
    // A new policy key does not displace a still-eligible native target.
    expect(renderer.currentFocusedRenderable?.id).toBe("last");
    act(() => replaceRoot(1));
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("first");
    const scope = renderer.root.findDescendantById("scope") as Renderable;
    // Native mutation without a React rerender must be repaired on FRAME.
    await act(async () => {
      scope.visible = false;
      await flush();
    });
    expect(renderer.currentFocusedRenderable).toBeNull();
    await act(async () => {
      scope.visible = true;
      await flush();
    });
    expect(renderer.currentFocusedRenderable?.id).toBe("last");
    const outside = renderer.root.findDescendantById("outside") as Renderable;
    await act(async () => {
      outside.focus();
      await flush();
    });
    expect(renderer.currentFocusedRenderable?.id).toBe("first");
    for (const next of [null, { scopeId: "missing", scopeKey: "missing" }]) {
      act(() => request(next));
      act(() => outside.focus());
      // Retained methods see the committed request before queued focus work runs.
      expect(buffered.repair()).toBeNull();
      expect(buffered.move(1)).toBeNull();
      await flush();
      expect(renderer.currentFocusedRenderable?.id).toBe("outside");
    }
  } finally {
    act(() => renderer.destroy());
  }
});

test("native focus observation snapshots, publishes changes, and adds no keyboard policy", async () => {
  let observe!: Dispatch<SetStateAction<boolean>>;
  let observed!: Renderable | null;

  function Observer() {
    observed = useNativeFocus();
    return null;
  }

  function Fixture() {
    const [active, setActive] = useState(false);
    observe = setActive;
    return (
      <ThemeProvider theme={defaultTheme}>
        {active ? <Observer /> : null}
        <Button id="first">First</Button>
        <Button id="second">Second</Button>
      </ThemeProvider>
    );
  }

  const { renderer, mockInput, flush } = await testRender(<Fixture />, { width: 40, height: 10 });
  try {
    await flush();
    const first = renderer.root.findDescendantById("first") as Renderable;
    const second = renderer.root.findDescendantById("second") as Renderable;
    const keyCount = renderer.keyInput.listenerCount("keypress");
    const focusCount = renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE);
    act(() => {
      first.focus();
      observe(true);
    });
    await flush();
    expect(observed?.id).toBe("first");
    expect(renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE)).toBe(focusCount + 1);
    expect(renderer.keyInput.listenerCount("keypress")).toBe(keyCount);
    act(() => second.focus());
    await flush();
    expect(observed?.id).toBe("second");
    act(() => mockInput.pressTab());
    await flush();
    expect(renderer.currentFocusedRenderable?.id).toBe("second");
    act(() => second.blur());
    await flush();
    expect(observed).toBeNull();
    act(() => observe(false));
    await flush();
    expect(renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE)).toBe(focusCount);
    expect(renderer.keyInput.listenerCount("keypress")).toBe(keyCount);
  } finally {
    act(() => renderer.destroy());
  }
});

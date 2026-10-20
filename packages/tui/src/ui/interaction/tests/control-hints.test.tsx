import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  CliRenderEvents,
  type InputRenderable,
  KeyEvent,
  type Renderable,
  type SelectRenderable,
} from "@opentui/core";
import {
  act,
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import { testRender } from "@/tests/support/render";
import { Button } from "@/ui/controls/button";
import { Input, type InputProps } from "@/ui/controls/input";
import { NumberInput } from "@/ui/controls/number";
import { Radio, RadioGroup } from "@/ui/controls/radio";
import { Select, type SelectProps } from "@/ui/controls/select";
import { Textarea, type TextareaProps } from "@/ui/controls/textarea";
import { Toggle, ToggleGroup } from "@/ui/controls/toggle";
import {
  type ControlHint,
  getControlHints,
  useControlHints,
  useFocusedControlHints,
} from "@/ui/interaction/control-hints";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

test("focused metadata updates callbacks and visibility without rerendering on ordinary frames", async () => {
  type State = {
    callback: boolean;
    disabled: boolean;
    hidden: boolean;
    observer: boolean;
    metadata: boolean;
    newer: boolean;
  };
  let update!: Dispatch<SetStateAction<State>>;
  let observed: readonly ControlHint[] = [];
  let renders = 0;
  function Observer() {
    observed = useFocusedControlHints();
    renders++;
    return null;
  }
  const sharedHints = [{ keys: "x", label: "Custom" }];
  const Metadata = memo(function Metadata({ target }: { target: RefObject<Renderable | null> }) {
    useControlHints(target, sharedHints);
    return null;
  });
  function Fixture() {
    const [state, setState] = useState({
      callback: true,
      disabled: false,
      hidden: false,
      observer: false,
      metadata: true,
      newer: false,
    });
    update = setState;
    const target = useRef<BoxRenderable | null>(null);
    return (
      <ThemeProvider theme={defaultTheme}>
        {state.observer ? <Observer /> : null}
        <Box id="parent" visible={!state.hidden}>
          <Button
            id="button"
            focused
            disabled={state.disabled}
            onPress={state.callback ? () => {} : undefined}
          >
            Go
          </Button>
          <Input id="input" onSubmit={state.callback ? () => {} : undefined} />
        </Box>
        <Box id="custom" ref={target} focusable />
        {state.metadata ? <Metadata target={target} /> : null}
        {state.newer ? <Metadata target={target} /> : null}
      </ThemeProvider>
    );
  }
  const { renderer, mockMouse, renderOnce, flush } = await testRender(<Fixture />, {
    width: 40,
    height: 10,
  });
  const change = async (patch: Partial<State>) => {
    act(() => update((state) => ({ ...state, ...patch })));
    await act(async () => flush());
  };
  try {
    await flush();
    const button = renderer.root.findDescendantById("button")!;
    const input = renderer.root.findDescendantById("input")!;
    const parent = renderer.root.findDescendantById("parent")!;
    const custom = renderer.root.findDescendantById("custom")!;
    const frames = renderer.listenerCount(CliRenderEvents.FRAME);
    const focuses = renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE);
    await change({ observer: true });
    expect(observed).toEqual([{ keys: "Enter/Space", label: "Activate" }]);
    expect(getControlHints(input)).toEqual([]);
    const count = renders;
    await act(async () => {
      await renderOnce();
      await renderOnce();
    });
    expect(renders).toBe(count);
    await change({ callback: false });
    expect(observed).toEqual([]);
    await change({ callback: true });
    expect(observed).toContainEqual({ keys: "Enter/Space", label: "Activate" });
    await act(async () => {
      input.focus();
      await flush();
    });
    expect(observed).toContainEqual({ keys: "Enter", label: "Submit" });
    await change({ callback: false });
    expect(observed).toEqual([]);
    await change({ callback: true });
    await act(async () => {
      parent.visible = false;
      await flush();
    });
    expect(getControlHints(input)).toEqual([]);
    expect(observed).toEqual([]);
    await change({ hidden: true });
    await change({ hidden: false });
    await act(async () => mockMouse.click(button.screenX + 1, button.screenY));
    await act(async () => flush());
    expect(observed).toEqual([{ keys: "Enter/Space", label: "Activate" }]);
    await change({ disabled: true });
    expect(getControlHints(button)).toEqual([]);
    await act(async () => {
      custom.focus();
      await flush();
    });
    expect(observed).toEqual([{ keys: "x", label: "Custom" }]);
    await change({ newer: true });
    await change({ metadata: false });
    expect(getControlHints(custom)).toEqual([{ keys: "x", label: "Custom" }]);
    await change({ newer: false });
    expect(getControlHints(custom)).toEqual([]);
    expect(observed).toEqual([]);
    await change({ observer: false });
    expect(renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames);
    expect(renderer.listenerCount(CliRenderEvents.FOCUSED_RENDERABLE)).toBe(focuses);
  } finally {
    act(() => renderer.destroy());
  }
});

test("native acceptance hints resolve overrides, raw chords and one-hop aliases truthfully", async () => {
  let inputProps!: Dispatch<SetStateAction<Partial<InputProps>>>;
  let selectProps!: Dispatch<SetStateAction<Partial<SelectProps>>>;
  let textareaProps!: Dispatch<SetStateAction<Partial<TextareaProps>>>;
  let submits = 0;
  let selects = 0;
  function Fixture() {
    const [input, setInput] = useState<Partial<InputProps>>({
      keyBindings: [{ name: "h", ctrl: true, action: "backspace" }],
    });
    const [select, setSelect] = useState<Partial<SelectProps>>({});
    const [textarea, setTextarea] = useState<Partial<TextareaProps>>({});
    inputProps = setInput;
    selectProps = setSelect;
    textareaProps = setTextarea;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Input id="input" onSubmit={() => submits++} {...input} />
        <Select
          id="select"
          options={[
            { name: "First", description: "" },
            { name: "Second", description: "" },
          ]}
          onSelect={() => selects++}
          {...select}
        />
        <Textarea id="textarea" height={3} onSubmit={() => submits++} {...textarea} />
      </ThemeProvider>
    );
  }
  const { renderer, mockInput, flush } = await testRender(<Fixture />, {
    width: 40,
    height: 10,
    kittyKeyboard: true,
  });
  const hints = (id: string) => getControlHints(renderer.root.findDescendantById(id)!);
  async function focus(id: string) {
    await act(async () => {
      renderer.root.findDescendantById(id)!.focus();
      await flush();
    });
  }
  // Dispatch raw native names as well as terminal bytes: aliases are binding-map entries,
  // not parser normalization, and keypad Enter is deliberately one-hop.
  function rawKey(name: string) {
    renderer.currentFocusedRenderable!.handleKeyPress!(
      new KeyEvent({
        name,
        ctrl: false,
        shift: false,
        meta: false,
        super: false,
        option: false,
        number: false,
        eventType: "press",
        source: "kitty",
        sequence: "",
        raw: "",
      }),
    );
  }
  try {
    await flush();
    await focus("input");
    expect(hints("input")).toContainEqual({ keys: "Enter", label: "Submit" });
    await act(async () => mockInput.pressEnter());
    expect(submits).toBe(1); // Custom editing bindings must not drop constructor submit defaults.
    act(() =>
      inputProps({
        keyBindings: [
          { name: "return", action: "move-left" },
          { name: "kpenter", action: "move-left" },
        ],
      }),
    );
    await flush();
    expect(hints("input")).not.toContainEqual({ keys: "Enter", label: "Submit" });
    expect(hints("input")).toContainEqual({ keys: "Linefeed", label: "Submit" });
    await act(async () => mockInput.pressEnter());
    expect(submits).toBe(1);
    act(() => inputProps({ keyBindings: [{ name: "enter", action: "move-left" }] }));
    await flush();
    expect(hints("input")).not.toContainEqual({ keys: "Enter", label: "Submit" });
    await act(async () => {
      rawKey("kpenter");
    });
    expect(submits).toBe(2); // Raw kpenter survives even though its alias entry is overwritten.
    await act(async () => mockInput.pressEnter());
    expect(submits).toBe(2);
    act(() =>
      inputProps({
        keyAliasMap: { enter: "x", kpenter: "enter" },
        keyBindings: [{ name: "enter", action: "move-left" }],
      }),
    );
    await flush();
    expect(hints("input")).toContainEqual({ keys: "Enter", label: "Submit" });
    await act(async () => mockInput.pressEnter());
    expect(submits).toBe(3); // kpenter->enter does not recurse through enter->x.

    await focus("select");
    expect(hints("select")).toEqual([{ keys: "Enter", label: "Select" }]);
    act(() =>
      selectProps({
        keyBindings: [
          { name: "return", action: "move-down" },
          { name: "j", action: "select-current" },
          { name: "g", action: "select-current" },
        ],
      }),
    );
    await flush();
    expect(hints("select")).not.toContainEqual({ keys: "Enter", label: "Select" });
    expect(hints("select")).toContainEqual({ keys: "j", label: "Select" });
    expect(hints("select")).not.toContainEqual({ keys: "g", label: "Select" });
    await act(async () => mockInput.pressEnter());
    expect((renderer.currentFocusedRenderable as SelectRenderable).getSelectedIndex()).toBe(1);
    expect(selects).toBe(0);
    await act(async () => mockInput.pressKey("j"));
    expect(selects).toBe(1);
    act(() => selectProps({ keyBindings: [{ name: "enter", action: "move-up" }] }));
    await flush();
    expect(hints("select")).not.toContainEqual({ keys: "Enter", label: "Select" });
    await act(async () => mockInput.pressEnter());
    expect(selects).toBe(1);

    // Replacing native j retains its ORIGINAL merge position. Its alias runs
    // before the later enter alias even though j is the last caller override.
    act(() =>
      selectProps({
        keyAliasMap: { j: "return" },
        keyBindings: [
          { name: "enter", action: "select-current" },
          { name: "j", action: "move-down" },
        ],
      }),
    );
    await flush();
    expect(hints("select")).toContainEqual({ keys: "Enter", label: "Select" });
    await act(async () => mockInput.pressEnter());
    expect(selects).toBe(2);

    await focus("textarea");
    expect(hints("textarea")).toContainEqual({ keys: "Ctrl+Enter", label: "Submit" });
    expect(hints("textarea")).toContainEqual({ keys: "Meta+Enter", label: "Submit" });
    act(() =>
      textareaProps({
        keyBindings: [
          { name: "return", ctrl: true, action: "newline" },
          { name: "return", super: true, action: "submit" },
          { name: "s", ctrl: true, shift: true, meta: true, action: "submit" },
        ],
      }),
    );
    await flush();
    expect(hints("textarea")).not.toContainEqual({ keys: "Ctrl+Enter", label: "Submit" });
    expect(hints("textarea")).toContainEqual({ keys: "Super+Enter", label: "Submit" });
    expect(hints("textarea")).toContainEqual({ keys: "Ctrl+Shift+Meta+s", label: "Submit" });
  } finally {
    act(() => renderer.destroy());
  }
});

test("number commit and composite group actions require their own usable candidates", async () => {
  const selections: string[] = [];
  const disable = {} as Record<"radio" | "toggle", Dispatch<SetStateAction<boolean>>>;
  let numberSubmit!: Dispatch<SetStateAction<boolean>>;
  let callbacks!: Dispatch<SetStateAction<boolean>>;
  function Candidate({ kind }: { kind: "radio" | "toggle" }) {
    const [disabled, setDisabled] = useState(false);
    disable[kind] = setDisabled;
    return kind === "radio" ? (
      <Radio id="radio-child" value="r" disabled={disabled}>
        R
      </Radio>
    ) : (
      <Toggle id="toggle-child" value="t" disabled={disabled}>
        T
      </Toggle>
    );
  }
  function Fixture() {
    const [submit, setSubmit] = useState(false);
    const [canChange, setCanChange] = useState(true);
    numberSubmit = setSubmit;
    callbacks = setCanChange;
    return (
      <ThemeProvider theme={defaultTheme}>
        <NumberInput id="number" value={20} max={10} onSubmit={submit ? () => {} : undefined} />
        <RadioGroup
          id="radio"
          onValueChange={canChange ? (value) => selections.push(value) : undefined}
        >
          <Candidate kind="radio" />
          <Radio value="second">Second</Radio>
        </RadioGroup>
        <ToggleGroup id="toggle" type="single" onValueChange={canChange ? () => {} : undefined}>
          <Candidate kind="toggle" />
        </ToggleGroup>
      </ThemeProvider>
    );
  }
  const { renderer, mockInput, flush } = await testRender(<Fixture />, { width: 40, height: 10 });
  async function focus(id: string) {
    await act(async () => {
      renderer.root.findDescendantById(id)!.focus();
      await flush();
    });
    return getControlHints(renderer.currentFocusedRenderable);
  }
  try {
    await flush();
    expect(await focus("number")).toContainEqual({ keys: "Enter", label: "Commit" });
    await act(async () => mockInput.pressEnter());
    expect((renderer.currentFocusedRenderable as InputRenderable).value).toBe("10");
    act(() => numberSubmit(true));
    await flush();
    expect(getControlHints(renderer.currentFocusedRenderable)).toContainEqual({
      keys: "Enter",
      label: "Submit",
    });
    expect(await focus("radio")).toEqual([{ keys: "Space", label: "Select" }]);
    expect(getControlHints(renderer.root.findDescendantById("radio-child")!)).toEqual([]);
    act(() => callbacks(false));
    await flush();
    expect(getControlHints(renderer.currentFocusedRenderable)).toEqual([]);
    act(() => callbacks(true));
    await flush();
    act(() => disable.radio(true));
    await flush();
    expect(getControlHints(renderer.currentFocusedRenderable)).toEqual([]);
    act(() => disable.radio(false));
    await flush();
    act(() => renderer.currentFocusedRenderable!.blur());
    await focus("radio");
    await act(async () => mockInput.pressKey(" "));
    expect(selections).toEqual(["r"]);
    expect(await focus("toggle")).toEqual([{ keys: "Enter/Space", label: "Toggle" }]);
    expect(getControlHints(renderer.root.findDescendantById("toggle-child")!)).toEqual([]);
    act(() => callbacks(false));
    await flush();
    expect(getControlHints(renderer.currentFocusedRenderable)).toEqual([]);
    act(() => callbacks(true));
    await flush();
    act(() => disable.toggle(true));
    await flush();
    expect(getControlHints(renderer.currentFocusedRenderable)).toEqual([]);
  } finally {
    act(() => renderer.destroy());
  }
});

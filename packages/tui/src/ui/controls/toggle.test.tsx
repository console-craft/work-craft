import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor, type TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { Toggle, ToggleGroup } from "@/ui/controls/toggle";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

async function renderCursorGroup({
  focused = false,
  multiple = false,
  selected = "a",
  empty = false,
} = {}) {
  const changes: (string | string[] | undefined)[] = [];
  let update!: Dispatch<SetStateAction<{ value: string; disabled?: boolean }[]>>;
  function Fixture() {
    const [rows, setRows] = useState<{ value: string; disabled?: boolean }[]>(
      empty ? [] : [{ value: "a" }, { value: "b" }, { value: "c" }],
    );
    update = setRows;
    const children = rows.map(({ value, disabled }) => (
      <Toggle key={value} id={value} value={value} disabled={disabled}>
        {value}
      </Toggle>
    ));
    return (
      <ThemeProvider theme={defaultTheme}>
        {multiple ? (
          <ToggleGroup
            id="group"
            type="multiple"
            value={[selected]}
            focused={focused}
            onValueChange={(next) => changes.push(next)}
          >
            {children}
          </ToggleGroup>
        ) : (
          <ToggleGroup
            id="group"
            type="single"
            value={selected}
            focused={focused}
            onValueChange={(next) => changes.push(next)}
          >
            {children}
          </ToggleGroup>
        )}
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 20, height: 3, kittyKeyboard: true });
  await act(async () => setup.flush());
  return { ...setup, changes, update };
}

for (const multiple of [false, true]) {
  test(`ToggleGroup buffered browsing activates the latest candidate (multiple=${multiple})`, async () => {
    const setup = await renderCursorGroup({ multiple });
    try {
      act(() => setup.renderer.root.findDescendantById("group")!.focus());
      await act(async () => setup.flush());
      act(() => {
        setup.mockInput.pressKey("l");
        setup.mockInput.pressKey("l");
        setup.mockInput.pressEnter();
      });
      expect(setup.changes).toEqual(multiple ? [["a", "c"]] : ["c"]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("ToggleGroup initializes a cursor after focused child registration", async () => {
  const setup = await renderCursorGroup({ focused: true, selected: "b" });
  try {
    act(() => setup.mockInput.pressEnter());
    expect(setup.changes).toEqual([undefined]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("ToggleGroup initializes late items without requiring native refocus", async () => {
  const setup = await renderCursorGroup({ empty: true, selected: "b" });
  try {
    act(() => setup.renderer.root.findDescendantById("group")!.focus());
    await act(async () => setup.update([{ value: "a" }, { value: "b" }]));
    await act(async () => setup.flush());
    expect(setup.changes).toEqual([]);
    act(() => setup.mockInput.pressEnter());
    expect(setup.changes).toEqual([undefined]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const removed of [false, true]) {
  test(`ToggleGroup repairs an ineligible cursor without selection (removed=${removed})`, async () => {
    const setup = await renderCursorGroup();
    try {
      act(() => setup.renderer.root.findDescendantById("group")!.focus());
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressKey("l"));
      await act(async () => setup.flush());
      await act(async () =>
        setup.update(
          removed
            ? [{ value: "a" }, { value: "c" }]
            : [{ value: "a" }, { value: "b", disabled: true }, { value: "c" }],
        ),
      );
      await act(async () => setup.flush());
      expect(setup.changes).toEqual([]);
      act(() => setup.mockInput.pressEnter());
      expect(setup.changes).toEqual([undefined]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("ToggleGroup pointer candidate feeds buffered browsing", async () => {
  const setup = await renderCursorGroup();
  try {
    const row = setup.renderer.root.findDescendantById("b")!;
    await act(async () => setup.mockMouse.pressDown(row.screenX, row.screenY));
    expect(setup.changes).toEqual([]);
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
    });
    expect(setup.changes).toEqual(["c"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("standalone Toggle keeps pressed visuals parent-owned and suppresses canceled and repeated keys", async () => {
  const changes: boolean[] = [];
  let press!: Dispatch<SetStateAction<boolean>>;
  let cancel = false;
  function Fixture() {
    const [pressed, setPressed] = useState(false);
    press = setPressed;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Toggle
          id="toggle"
          pressed={pressed}
          onPressedChange={(next) => changes.push(next)}
          onKeyDown={(event) => {
            if (cancel) {
              event.preventDefault();
            }
          }}
        >
          Bold
        </Toggle>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 20, height: 3, kittyKeyboard: true });
  try {
    await act(async () => setup.flush());
    const toggle = setup.renderer.root.findDescendantById("toggle") as BoxRenderable;
    const label = toggle.getChildren()[0] as TextRenderable;
    expect(toggle.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.secondary).toInts(),
    );
    act(() => toggle.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual([true, true]);
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.focusForeground).toInts());
    act(() => press(true));
    await act(async () => setup.flush());
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());
    act(() => setup.mockInput.pressEnter());
    expect(changes).toEqual([true, true, false]);
    cancel = true;
    act(() => setup.mockInput.pressEnter());
    cancel = false;
    act(() =>
      setup.renderer.keyInput.processParsedKey({
        name: "space",
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
    act(() => setup.mockInput.pressEnter({ ctrl: true }));
    expect(changes).toEqual([true, true, false]);
    act(() => toggle.blur());
    await act(async () => setup.flush());
    expect(toggle.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.primaryForeground).toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const multiple of [false, true]) {
  test(`${multiple ? "multiple" : "single"} ToggleGroup requests deselection without changing parent-owned pressed values`, async () => {
    const changes: (string | undefined | string[])[] = [];
    let acknowledge!: () => void;
    let disable!: Dispatch<SetStateAction<boolean>>;
    function Fixture() {
      const [single, setSingle] = useState<string | undefined>("a");
      const [values, setValues] = useState(["a", "c"]);
      const [disabled, setDisabled] = useState(false);
      disable = setDisabled;
      acknowledge = () =>
        multiple
          ? setValues(changes.at(-1) as string[])
          : setSingle(changes.at(-1) as string | undefined);
      const children = (
        <>
          <Toggle id="a" value="a">
            A
          </Toggle>
          <Toggle value="disabled" disabled>
            Disabled
          </Toggle>
          <Toggle id="b" value="b">
            B
          </Toggle>
          <Toggle value="c">C</Toggle>
        </>
      );
      return (
        <ThemeProvider theme={defaultTheme}>
          {multiple ? (
            <ToggleGroup
              id="group"
              type="multiple"
              disabled={disabled}
              value={values}
              onValueChange={(next) => changes.push(next)}
            >
              {children}
            </ToggleGroup>
          ) : (
            <ToggleGroup
              id="group"
              type="single"
              disabled={disabled}
              value={single}
              onValueChange={(next) => changes.push(next)}
            >
              {children}
            </ToggleGroup>
          )}
        </ThemeProvider>
      );
    }
    const setup = await testRender(<Fixture />, { width: 40, height: 3 });
    try {
      await act(async () => setup.flush());
      const group = setup.renderer.root.findDescendantById("group")!;
      const a = setup.renderer.root.findDescendantById("a") as BoxRenderable;
      expect(a.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());
      act(() => group.focus());
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressEnter());
      expect(changes).toEqual(multiple ? [["c"]] : [undefined]);
      expect((a.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
        parseColor(defaultTheme.colors.primary).toInts(),
      );
      act(() => acknowledge());
      await act(async () => setup.flush());
      expect((a.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
        parseColor(defaultTheme.colors.focusForeground).toInts(),
      );
      act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressKey(" "));
      expect(changes.at(-1)).toEqual(multiple ? ["c", "b"] : "b");
      act(() => acknowledge());
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressKey("ARROW_LEFT"));
      act(() => setup.mockInput.pressKey("ARROW_LEFT"));
      await act(async () => setup.flush());
      act(() => setup.mockInput.pressEnter());
      expect(changes.at(-1)).toEqual(multiple ? ["b"] : "c");
      const label = a.getChildren()[0]!;
      const beforeClick = [...changes];
      await act(async () => setup.mockMouse.pressDown(label.screenX, label.screenY));
      act(() => disable(true));
      await act(async () => setup.flush());
      act(() => disable(false));
      await act(async () => setup.flush());
      await act(async () => setup.mockMouse.release(label.screenX, label.screenY));
      expect(changes).toEqual(beforeClick);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

import { expect, test } from "bun:test";

import type { InputRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { NumberInput } from "@/ui/controls/number";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

test("number input preserves value precision across commits, steps, and prop updates", async () => {
  const changes: (number | undefined)[] = [];
  const submissions: (number | undefined)[] = [];
  let setValue!: Dispatch<SetStateAction<number | undefined>>;

  function Fixture() {
    const [value, updateValue] = useState<number>();
    setValue = updateValue;
    return (
      <ThemeProvider theme={defaultTheme}>
        <NumberInput
          id="number"
          focused
          value={value}
          step={0.1}
          max={1.37}
          onValueChange={(next) => {
            changes.push(next);
            updateValue(next);
          }}
          onSubmit={(next) => submissions.push(next)}
        />
      </ThemeProvider>
    );
  }

  const { renderer, mockInput, flush } = await testRender(<Fixture />, {
    width: 40,
    height: 5,
    exitOnCtrlC: false,
  });
  try {
    await flush();
    const input = renderer.root.findDescendantById("number") as InputRenderable;
    await act(async () => mockInput.typeText("1.25"));
    await act(async () => mockInput.pressEnter());
    expect(submissions).toEqual([1.25]);
    expect(input.value).toBe("1.25");

    await act(async () => mockInput.pressKey("ARROW_UP"));
    expect(changes.at(-1)).toBe(1.35);
    expect(input.value).toBe("1.35");
    await act(async () => mockInput.pressKey("ARROW_UP"));
    expect(changes.at(-1)).toBe(1.37);
    expect(input.value).toBe("1.37");

    await act(async () => setValue(0.125));
    expect(input.value).toBe("0.125");
    await act(async () => setValue(undefined));
    expect(input.value).toBe("");

    await act(async () => setValue(0.125));
    await act(async () => mockInput.pressKey("c", { ctrl: true }));
    expect(input.value).toBe("");
    expect(changes.at(-1)).toBeUndefined();
    await act(async () => mockInput.pressKey("ARROW_UP"));
    expect(input.value).toBe("0.1");
  } finally {
    act(() => renderer.destroy());
  }
});

test("number input keeps small committed and supplied values editable as decimals", async () => {
  const submissions: (number | undefined)[] = [];
  let setValue!: Dispatch<SetStateAction<number | undefined>>;
  function Fixture() {
    const [value, updateValue] = useState<number>();
    setValue = updateValue;
    return (
      <ThemeProvider theme={defaultTheme}>
        <NumberInput
          id="number"
          focused
          value={value}
          step={0.0000001}
          onValueChange={updateValue}
          onSubmit={(next) => submissions.push(next)}
        />
      </ThemeProvider>
    );
  }

  const { renderer, mockInput, flush } = await testRender(<Fixture />, { width: 40, height: 5 });
  try {
    await flush();
    const input = renderer.root.findDescendantById("number") as InputRenderable;
    await act(async () => mockInput.typeText("0.0000001"));
    await act(async () => mockInput.pressEnter());
    expect(submissions).toEqual([1e-7]);
    expect(input.value).toBe("0.0000001");
    await act(async () => mockInput.typeText("2"));
    await act(async () => mockInput.pressEnter());
    expect(submissions).toEqual([1e-7, 1.2e-7]);
    expect(input.value).toBe("0.00000012");
    await act(async () => mockInput.pressBackspace());
    expect(input.value).toBe("0.0000001");

    await act(async () => setValue(-1e-7));
    expect(input.value).toBe("-0.0000001");
    await act(async () => mockInput.pressBackspace());
    expect(input.value).toBe("-0.000000");
  } finally {
    act(() => renderer.destroy());
  }
});

test("number input retains decimal drafts, rejects invalid characters and clamps only on commit", async () => {
  const changes: (number | undefined)[] = [];
  const submissions: (number | undefined)[] = [];
  function Fixture() {
    const [value, setValue] = useState<number>();
    return (
      <ThemeProvider theme={defaultTheme}>
        <NumberInput
          id="number"
          focused
          value={value}
          min={0}
          max={10}
          onValueChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
          onSubmit={(next) => submissions.push(next)}
        />
        <NumberInput id="after" />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 5, exitOnCtrlC: false });
  try {
    await act(async () => setup.flush());
    const input = setup.renderer.root.findDescendantById("number") as InputRenderable;
    await act(async () => setup.mockInput.typeText("-."));
    expect(input.value).toBe("-.");
    expect(changes).toEqual([]);
    await act(async () => setup.mockInput.typeText("5"));
    expect(input.value).toBe("-.5");
    expect(changes).toEqual([-0.5]);
    await act(async () => setup.mockInput.typeText("x"));
    expect(input.value).toBe("-.5");
    expect(changes).toEqual([-0.5]);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(input.value).toBe("0");
    expect(submissions).toEqual([0]);
    act(() => setup.mockInput.pressKey("c", { ctrl: true }));
    await act(async () => setup.flush());
    await act(async () => setup.mockInput.typeText("01."));
    expect(input.value).toBe("01.");
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(input.value).toBe("1");
    act(() => setup.mockInput.pressKey("c", { ctrl: true }));
    await act(async () => setup.flush());
    await act(async () => setup.mockInput.typeText("25"));
    expect(input.value).toBe("25");
    expect(changes.at(-1)).toBe(25);
    act(() => setup.renderer.root.findDescendantById("after")!.focus());
    await act(async () => setup.flush());
    expect(input.value).toBe("10");
    expect(changes.at(-1)).toBe(10);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

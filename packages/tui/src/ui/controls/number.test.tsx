import { expect, test } from "bun:test";

import type { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { NumberInput } from "@/ui/controls/number";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

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

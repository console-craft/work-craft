import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor, type TextRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Radio, RadioGroup } from "@/ui/controls/radio";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

test("RadioGroup previews enabled candidates without changing selection until the parent acknowledges", async () => {
  const changes: string[] = [];
  let select!: Dispatch<SetStateAction<string>>;
  function Fixture() {
    const [value, setValue] = useState("a");
    select = setValue;
    return (
      <ThemeProvider theme={defaultTheme}>
        <RadioGroup id="group" value={value} onValueChange={(next) => changes.push(next)}>
          <Radio id="a" value="a">
            Alpha
          </Radio>
          <Radio disabled value="disabled">
            Disabled
          </Radio>
          <Radio id="b" value="b">
            Beta
          </Radio>
        </RadioGroup>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 5 });
  try {
    await act(async () => setup.flush());
    const group = setup.renderer.root.findDescendantById("group")!;
    const a = setup.renderer.root.findDescendantById("a") as BoxRenderable;
    const b = setup.renderer.root.findDescendantById("b") as BoxRenderable;
    const aIndicator = a.getChildren()[0] as TextRenderable;
    const bIndicator = b.getChildren()[0] as TextRenderable;
    act(() => group.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual([]);
    act(() => setup.mockInput.pressKey("ARROW_DOWN"));
    await act(async () => setup.flush());
    expect(b.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    expect(aIndicator.plainText).toBe("◉");
    expect(bIndicator.plainText).toBe("○");
    expect(changes).toEqual([]);
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual(["b"]);
    expect(bIndicator.plainText).toBe("○");
    act(() => select("b"));
    await act(async () => setup.flush());
    expect(aIndicator.plainText).toBe("○");
    expect(bIndicator.plainText).toBe("◉");
    act(() => setup.mockInput.pressKey("ARROW_DOWN"));
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey(" "));
    expect(changes).toEqual(["b", "a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

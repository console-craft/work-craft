import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Slider, type SliderProps } from "@/ui/controls/slider";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("Slider requests decimal steps and endpoints without taking ownership of its value", async () => {
  const changes: number[] = [];
  let update!: Dispatch<SetStateAction<Partial<SliderProps>>>;
  let cancel = false;
  function Fixture() {
    const [props, setProps] = useState<Partial<SliderProps>>({ value: 0.2 });
    update = setProps;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Slider
          id="slider"
          focused
          min={0.2}
          max={0.65}
          step={0.1}
          onValueChange={(value) => changes.push(value)}
          onKeyDown={(event) => {
            if (cancel) {
              event.preventDefault();
            }
          }}
          {...props}
        />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 25, height: 3, kittyKeyboard: true });
  try {
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    act(() => setup.mockInput.pressKey("l"));
    expect(changes).toEqual([0.3, 0.3]);
    act(() => update({ value: 0.6 }));
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(changes.at(-1)).toBe(0.65);
    act(() => update({ value: 0.65, orientation: "vertical" }));
    await act(async () => setup.flush());
    const before = changes.length;
    act(() => setup.mockInput.pressKey("ARROW_UP"));
    expect(changes).toHaveLength(before);
    act(() => setup.mockInput.pressKey("ARROW_DOWN"));
    expect(changes.at(-1)).toBe(0.55);
    act(() => setup.mockInput.pressKey("HOME"));
    expect(changes.at(-1)).toBe(0.2);
    act(() => update({ value: 0.2 }));
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("END"));
    expect(changes.at(-1)).toBe(0.65);
    const accepted = [...changes];
    act(() => setup.mockInput.pressKey("ARROW_RIGHT", { ctrl: true }));
    cancel = true;
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(changes).toEqual(accepted);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const orientation of ["horizontal", "vertical"] as const) {
  test(`${orientation} Slider maps pointer cells to snapped values and clamps captured drags`, async () => {
    const changes: number[] = [];
    let disable!: Dispatch<SetStateAction<boolean>>;
    function Fixture() {
      const [disabled, setDisabled] = useState(false);
      const [value, setValue] = useState(13);
      disable = setDisabled;
      return (
        <ThemeProvider theme={defaultTheme}>
          <Slider
            id="slider"
            left={2}
            top={2}
            position="absolute"
            width={orientation === "horizontal" ? 11 : 1}
            height={orientation === "horizontal" ? 1 : 11}
            orientation={orientation}
            min={10}
            max={20}
            step={3}
            value={value}
            disabled={disabled}
            onValueChange={(next) => {
              changes.push(next);
              setValue(next);
            }}
          />
        </ThemeProvider>
      );
    }
    const setup = await testRender(<Fixture />, { width: 20, height: 16 });
    try {
      await act(async () => setup.flush());
      const slider = setup.renderer.root.findDescendantById("slider")!;
      const midpoint = {
        x: slider.screenX + (orientation === "horizontal" ? 5 : 0),
        y: slider.screenY + (orientation === "vertical" ? 5 : 0),
      };
      await act(async () => setup.mockMouse.pressDown(midpoint.x, midpoint.y));
      expect(changes).toEqual([16]);
      await act(async () => setup.mockMouse.release(midpoint.x, midpoint.y));
      expect(setup.renderer.currentFocusedRenderable).toBe(slider);
      await act(async () =>
        setup.mockMouse.drag(
          midpoint.x,
          midpoint.y,
          orientation === "horizontal" ? slider.screenX + 15 : slider.screenX,
          orientation === "vertical" ? slider.screenY - 2 : slider.screenY,
        ),
      );
      expect(changes.at(-1)).toBe(20);
      // Native capture excludes the dragged node from hits until the release frame.
      await act(async () => setup.flush());
      await act(async () =>
        setup.mockMouse.click(
          slider.screenX,
          slider.screenY + (orientation === "vertical" ? 10 : 0),
        ),
      );
      expect(changes.at(-1)).toBe(10);
      const accepted = [...changes];
      await act(async () => setup.mockMouse.click(midpoint.x, midpoint.y, 2));
      expect(changes).toEqual(accepted);
      await act(async () => setup.mockMouse.pressDown(midpoint.x, midpoint.y));
      act(() => disable(true));
      await act(async () => setup.flush());
      const disabledChanges = [...changes];
      await act(async () =>
        setup.mockMouse.release(
          slider.screenX + (orientation === "horizontal" ? 10 : 0),
          slider.screenY,
        ),
      );
      expect(changes).toEqual(disabledChanges);
      expect(slider.focused).toBe(false);
      expect(slider.focusable).toBe(false);
      act(() => disable(false));
      await act(async () => setup.flush());
      await act(async () => setup.mockMouse.pressDown(midpoint.x, midpoint.y));
      act(() => disable(true));
      await act(async () => setup.flush());
      act(() => disable(false));
      await act(async () => setup.flush());
      const beforeRelease = [...changes];
      await act(async () =>
        setup.mockMouse.release(
          slider.screenX + (orientation === "horizontal" ? 10 : 0),
          slider.screenY,
        ),
      );
      expect(changes).toEqual(beforeRelease);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("Slider paints the thumb and fill in the correct direction through focus, disable and resize", async () => {
  let update!: Dispatch<SetStateAction<Partial<SliderProps>>>;
  function Fixture() {
    const [props, setProps] = useState<Partial<SliderProps>>({ value: 25 });
    update = setProps;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Slider id="slider" width={5} {...props} />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 10, height: 7 });
  try {
    await act(async () => setup.flush());
    const slider = setup.renderer.root.findDescendantById("slider") as BoxRenderable;
    expect(setup.captureCharFrame().split("\n")[0]!.trim()).toBe("━●───");
    let spans = setup.renderer.currentRenderBuffer.getSpanLines()[0]!.spans;
    expect(spans.find((span) => span.text.includes("●"))!.fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    act(() => slider.focus());
    await act(async () => setup.flush());
    spans = setup.renderer.currentRenderBuffer.getSpanLines()[0]!.spans;
    const focused = spans.find((span) => span.text.includes("●"))!;
    expect(focused.fg.toInts()).toEqual(parseColor(defaultTheme.colors.focusForeground).toInts());
    expect(focused.bg.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    act(() => update({ disabled: true, orientation: "vertical", width: 1, height: 5, value: 25 }));
    await act(async () => setup.flush());
    expect(
      setup
        .captureCharFrame()
        .split("\n")
        .slice(0, 5)
        .map((line) => line.trim()),
    ).toEqual(["│", "│", "│", "●", "┃"]);
    const thumb = setup.renderer.currentRenderBuffer
      .getSpanLines()[3]!
      .spans.find((span) => span.text.includes("●"))!;
    expect(thumb.fg.toInts()).toEqual(parseColor(defaultTheme.colors.mutedForeground).toInts());
    act(() => update({ width: 1, height: 1, min: 4, max: 4, value: 4 }));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame().trim()).toBe("●");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

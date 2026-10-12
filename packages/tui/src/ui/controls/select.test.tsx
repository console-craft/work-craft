import { expect, test } from "bun:test";

import { MouseButton, parseColor, type SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { getControlHints } from "@/ui/control-hints";
import { Select, type SelectProps } from "@/ui/controls/select";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

const options = [
  { name: "Unavailable first", description: "First description", disabled: true },
  { name: "Alpha", description: "Alpha description", value: "a" },
  { name: "Unavailable middle", description: "Middle description", disabled: true },
  { name: "Beta", description: "Beta description", value: "b" },
  { name: "Unavailable last", description: "Last description", disabled: true },
];

function Fixture(props: SelectProps) {
  return (
    <ThemeProvider theme={defaultTheme}>
      <Select id="select" width={40} height={10} options={options} {...props} />
    </ThemeProvider>
  );
}

async function renderSelect(props: SelectProps = {}) {
  const setup = await act(async () =>
    testRender(<Fixture {...props} />, { width: 40, height: 14, kittyKeyboard: true }),
  );
  await act(async () => setup.flush());
  const select = setup.renderer.root.findDescendantById("select") as SelectRenderable;
  return { ...setup, select };
}

test("Select skips disabled options with native bindings, fast movement, wrapping and g/G", async () => {
  const changed: number[] = [];
  const selected: [number, unknown][] = [];
  const setup = await renderSelect({
    focused: true,
    wrapSelection: true,
    fastScrollStep: 2,
    keyAliasMap: { j: "x" },
    keyBindings: [{ name: "s", action: "select-current" }],
    onChange: (index) => changed.push(index),
    onSelect: (index, option) => selected.push([index, option?.value]),
  });
  try {
    expect(setup.select.getSelectedIndex()).toBe(1);
    act(() => setup.mockInput.pressKey("x"));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("j"));
    expect(setup.select.getSelectedIndex()).toBe(1);
    act(() => setup.mockInput.pressKey("k"));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("g"));
    expect(setup.select.getSelectedIndex()).toBe(1);
    act(() => setup.mockInput.pressKey("g", { shift: true }));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("u", { ctrl: true }));
    expect(setup.select.getSelectedIndex()).toBe(1);
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("s"));
    expect(selected).toEqual([[3, "b"]]);
    expect(changed.every((index) => index === 1 || index === 3)).toBe(true);
    act(() => setup.select.setSelectedIndex(2));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.select.setSelectedIndex(4));
    expect(setup.select.getSelectedIndex()).toBe(3);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Select repairs a newly disabled cursor and suppresses activation when no option is enabled", async () => {
  let update!: Dispatch<SetStateAction<Partial<SelectProps>>>;
  const changed: number[] = [];
  const selected: number[] = [];
  function DynamicFixture() {
    const [props, setProps] = useState<Partial<SelectProps>>({});
    update = setProps;
    return (
      <Fixture
        focused
        onChange={(index) => changed.push(index)}
        onSelect={(index) => selected.push(index)}
        {...props}
      />
    );
  }
  const setup = await act(async () =>
    testRender(<DynamicFixture />, { width: 40, height: 14, kittyKeyboard: true }),
  );
  const select = setup.renderer.root.findDescendantById("select") as SelectRenderable;
  try {
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(1);
    act(() =>
      update({ options: options.map((option, index) => ({ ...option, disabled: index !== 3 })) }),
    );
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(3);
    expect(changed).toContain(3);
    act(() =>
      update({ options: options.map((option, index) => ({ ...option, disabled: index !== 1 })) }),
    );
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(1);
    act(() => update({ options: options.map((option) => ({ ...option, disabled: true })) }));
    await act(async () => setup.flush());
    expect(getControlHints(select)).toEqual([]);
    const previousChanges = [...changed];
    act(() => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("g");
      setup.mockInput.pressEnter();
      select.selectCurrent();
    });
    expect(selected).toEqual([]);
    expect(changed).toEqual(previousChanges);
    expect(setup.captureCharFrame()).not.toContain("▶");
    act(() => update({ options }));
    await act(async () => setup.flush());
    expect(select.getSelectedIndex()).toBe(1);
    expect(getControlHints(select)).toContainEqual({ keys: "Enter", label: "Select" });
    act(() => setup.mockInput.pressEnter());
    expect(selected).toEqual([1]);
    act(() => update({ disabled: true, options }));
    await act(async () => setup.flush());
    expect(select.focusable).toBe(false);
    expect(getControlHints(select)).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Select renders disabled names and descriptions in the muted theme color", async () => {
  const setup = await renderSelect({ focused: true });
  try {
    const lines = setup.renderer.currentRenderBuffer.getSpanLines();
    for (const row of [0, 1, 4, 5, 8, 9]) {
      const spans = lines[row]!.spans.filter((span) => span.text.trim().length > 0);
      expect(spans.length).toBeGreaterThan(0);
      for (const span of spans) {
        expect(span.fg.toInts()).toEqual(parseColor(defaultTheme.colors.mutedForeground).toInts());
      }
    }
    expect(setup.captureCharFrame()).toContain("Unavailable middle");
    expect(setup.captureCharFrame()).toContain("Middle description");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("non-wrapping Select fast movement reaches the enabled endpoints without reversing", async () => {
  const setup = await renderSelect({ focused: true, fastScrollStep: 5, selectedIndex: 2 });
  try {
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("u", { ctrl: true }));
    expect(setup.select.getSelectedIndex()).toBe(1);
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("j"));
    expect(setup.select.getSelectedIndex()).toBe(3);
    act(() => setup.mockInput.pressKey("g"));
    act(() => setup.mockInput.pressKey("k"));
    expect(setup.select.getSelectedIndex()).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disabled option tint follows the native viewport with hidden descriptions and item spacing", async () => {
  const setup = await renderSelect({
    focused: true,
    showDescription: false,
    itemSpacing: 1,
    height: 6,
  });
  try {
    act(() => setup.mockInput.pressKey("g", { shift: true }));
    await act(async () => setup.flush());
    let lines = setup.renderer.currentRenderBuffer.getSpanLines();
    for (const row of [0, 4]) {
      const text = lines[row]!.spans.find((span) => span.text.includes("Unavailable"))!;
      expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.mutedForeground).toInts());
    }
    expect(setup.captureCharFrame()).not.toContain("description");
    act(() => {
      setup.select.height = 8;
    });
    await act(async () => setup.flush());
    lines = setup.renderer.currentRenderBuffer.getSpanLines();
    for (const row of [2, 6]) {
      const text = lines[row]!.spans.find((span) => span.text.includes("Unavailable"))!;
      expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.mutedForeground).toInts());
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("all-disabled options use the effective background of a disabled Select", async () => {
  const setup = await renderSelect({
    disabled: true,
    backgroundColor: "#ff0000",
    options: options.map((option) => ({ ...option, disabled: true })),
  });
  try {
    const lines = setup.renderer.currentRenderBuffer.getSpanLines();
    for (const row of [0, 2]) {
      const text = lines[row]!.spans.find((span) => span.text.trim().length > 0)!;
      expect(text.bg.toInts()).toEqual(parseColor(defaultTheme.colors.muted).toInts());
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disabled option tint preserves the native scroll indicator color", async () => {
  const setup = await renderSelect({ height: 4, showScrollIndicator: true });
  try {
    const marker = setup.renderer.currentRenderBuffer
      .getSpanLines()
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("█"))!;
    expect(marker.fg.toInts()).toEqual(parseColor("#666666").toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("left-clicking a Select option name or description changes and activates its original index", async () => {
  const events: string[] = [];
  const setup = await renderSelect({
    onChange: (index) => events.push(`change:${index}`),
    onSelect: (index, option) => events.push(`select:${index}:${option?.value}`),
  });
  try {
    const x = setup.select.screenX + 4;
    await act(async () => setup.mockMouse.click(x, setup.select.screenY + 6));
    expect(setup.select.focused).toBe(true);
    expect(setup.select.getSelectedIndex()).toBe(3);
    expect(events).toEqual(["change:3", "select:3:b"]);
    await act(async () => setup.mockMouse.click(x, setup.select.screenY + 3));
    expect(setup.select.getSelectedIndex()).toBe(1);
    expect(events).toEqual(["change:3", "select:3:b", "change:1", "select:1:a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Select ignores disabled rows, spacing, empty space, non-primary clicks and cancelled presses", async () => {
  for (const props of [
    {},
    { disabled: true },
    { onMouseDown: (event) => event.preventDefault() },
  ] satisfies SelectProps[]) {
    const events: number[] = [];
    const setup = await renderSelect({
      height: 14,
      itemSpacing: 1,
      onSelect: (index) => events.push(index),
      ...props,
    });
    try {
      const x = setup.select.screenX + 4;
      for (const row of [0, 1, 2, 5, 6, 12, 13]) {
        await act(async () => setup.mockMouse.click(x, setup.select.screenY + row));
      }
      await act(async () => setup.mockMouse.click(x, setup.select.screenY + 9, MouseButton.RIGHT));
      expect(setup.select.getSelectedIndex()).toBe(1);
      expect(events).toEqual([]);
      await act(async () => setup.mockMouse.click(x, setup.select.screenY + 9));
      expect(events).toEqual(Object.keys(props).length === 0 ? [3] : []);
    } finally {
      act(() => setup.renderer.destroy());
    }
  }
});

test("Select click hit-testing follows scrolling and resizing with descriptions hidden", async () => {
  const selected: number[] = [];
  const setup = await renderSelect({
    focused: true,
    height: 4,
    showDescription: false,
    showScrollIndicator: true,
    options: Array.from({ length: 12 }, (_, index) => ({ name: `Row ${index}`, description: "" })),
    onSelect: (index) => selected.push(index),
  });
  try {
    act(() => setup.mockInput.pressKey("g", { shift: true }));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("Row 8");
    await act(async () => setup.mockMouse.click(setup.select.screenX + 4, setup.select.screenY));
    expect(selected).toEqual([8]);
    act(() => {
      setup.select.height = 6;
    });
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("Row 5");
    await act(async () =>
      setup.mockMouse.click(setup.select.screenX + 4, setup.select.screenY + 1),
    );
    expect(selected).toEqual([8, 6]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Select clicks respect ASCII font height and the scroll marker", async () => {
  const selected: number[] = [];
  const setup = await renderSelect({
    height: 12,
    font: "tiny",
    itemSpacing: 1,
    options: [
      { name: "A", description: "Alpha" },
      { name: "B", description: "Disabled", disabled: true },
      { name: "C", description: "Gamma" },
      { name: "D", description: "Delta" },
    ],
    showScrollIndicator: true,
    onSelect: (index) => selected.push(index),
  });
  try {
    const x = setup.select.screenX + 4;
    // Tiny names occupy two lines; descriptions add one and spacing adds another.
    await act(async () =>
      setup.mockMouse.click(
        setup.select.screenX + setup.select.width - 1,
        setup.select.screenY + 1,
      ),
    );
    await act(async () => setup.mockMouse.click(x, setup.select.screenY + 6));
    await act(async () => setup.mockMouse.click(x, setup.select.screenY + 7));
    expect(selected).toEqual([]);
    await act(async () => setup.mockMouse.click(x, setup.select.screenY + 9));
    expect(selected).toEqual([2]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Select clicks ignore empty space and enabled options that cannot fit a complete row", async () => {
  for (const height of [1, 6]) {
    const events: number[] = [];
    const setup = await renderSelect({
      height,
      options: [{ name: "Enabled", description: "Description" }],
      onChange: (index) => events.push(index),
      onSelect: (index) => events.push(index),
    });
    try {
      await act(async () =>
        setup.mockMouse.click(setup.select.screenX + 4, setup.select.screenY + height - 1),
      );
      expect(events).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  }
});

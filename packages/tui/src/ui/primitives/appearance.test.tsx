import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor, TextAttributes, type TextRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
import { Box } from "@/ui/primitives/box";
import { Text, type TextVariant } from "@/ui/primitives/text";
import type { ColorToken, Theme } from "@/ui/theme";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("Box and Text adopt live theme tokens while preserving explicit colors and native identity", async () => {
  let changeTheme!: Dispatch<SetStateAction<Theme>>;
  function Fixture() {
    const [theme, setTheme] = useState<Theme>(defaultTheme);
    changeTheme = setTheme;
    return (
      <ThemeProvider theme={theme}>
        <Box id="box" border bg="background" width={12} height={3} focusable>
          <Text id="text" variant="heading">
            Title
          </Text>
        </Box>
        <Text id="literal" fg="#123456" bg="#abcdef">
          Literal
        </Text>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 20, height: 5 });
  try {
    await act(async () => setup.flush());
    const box = setup.renderer.root.findDescendantById("box") as BoxRenderable;
    const text = setup.renderer.root.findDescendantById("text") as TextRenderable;
    const literal = setup.renderer.root.findDescendantById("literal") as TextRenderable;
    expect(setup.captureCharFrame().split("\n")[0]!.trim()).toBe("╭──────────╮");
    expect(box.borderColor.toInts()).toEqual(parseColor(defaultTheme.colors.border).toInts());
    expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());
    act(() => box.focus());
    await act(async () => setup.flush());
    const border = setup.renderer.currentRenderBuffer
      .getSpanLines()[0]!
      .spans.find((span) => span.text.includes("╭"))!;
    expect(border.fg.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    act(() =>
      changeTheme({
        ...defaultTheme,
        name: "test",
        borders: { default: "double", strong: "heavy" },
        colors: {
          ...defaultTheme.colors,
          background: "#102030",
          primary: "#405060",
          border: "#708090",
          focus: "#a0b0c0",
        },
      }),
    );
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("box")).toBe(box);
    expect(setup.renderer.currentFocusedRenderable).toBe(box);
    expect(box.backgroundColor.toInts()).toEqual(parseColor("#102030").toInts());
    expect(box.borderColor.toInts()).toEqual(parseColor("#708090").toInts());
    expect(text.fg.toInts()).toEqual(parseColor("#405060").toInts());
    expect(literal.fg.toInts()).toEqual(parseColor("#123456").toInts());
    expect(literal.bg.toInts()).toEqual(parseColor("#abcdef").toInts());
    expect(setup.captureCharFrame().split("\n")[0]!.trim()).toBe("╔══════════╗");
    const updatedBorder = setup.renderer.currentRenderBuffer
      .getSpanLines()[0]!
      .spans.find((span) => span.text.includes("╔"))!;
    expect(updatedBorder.fg.toInts()).toEqual(parseColor("#a0b0c0").toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Box preserves explicit, custom and absent borders instead of applying themed defaults", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Box id="plain" width={8} height={1}>
        <Text>Plain</Text>
      </Box>
      <Box id="explicit" width={8} height={3} border borderStyle="single" borderColor="#123456" />
      <Box
        id="custom"
        width={8}
        height={3}
        border
        customBorderChars={{
          topLeft: "+",
          topRight: "+",
          bottomLeft: "+",
          bottomRight: "+",
          horizontal: "-",
          vertical: "|",
          topT: "+",
          bottomT: "+",
          leftT: "+",
          rightT: "+",
          cross: "+",
        }}
      />
    </ThemeProvider>,
    { width: 12, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    const rows = setup.captureCharFrame().split("\n");
    expect(rows[0]!.trim()).toBe("Plain");
    expect(rows[1]!.trim()).toBe("┌──────┐");
    expect(rows[4]!.trim()).toBe("+------+");
    const border = setup.renderer.currentRenderBuffer
      .getSpanLines()[1]!
      .spans.find((span) => span.text.includes("┌"))!;
    expect(border.fg.toInts()).toEqual(parseColor("#123456").toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Text applies semantic variants and string transforms while preserving explicit styling and rich children", async () => {
  const variants: [TextVariant, ColorToken, number][] = [
    ["default", "foreground", 0],
    ["muted", "mutedForeground", 0],
    ["heading", "primary", TextAttributes.BOLD],
    ["label", "foreground", TextAttributes.BOLD],
    ["success", "success", 0],
    ["warning", "warning", 0],
    ["error", "error", 0],
    ["info", "info", 0],
  ];
  const transforms = [
    ["none", "hello WORLD"],
    ["uppercase", "HELLO WORLD"],
    ["lowercase", "hello world"],
    ["capitalize", "Hello WORLD"],
  ] as const;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      {variants.map(([variant]) => (
        <Text id={variant} key={variant} variant={variant}>
          {variant}
        </Text>
      ))}
      <Text id="override" variant="heading" attributes={0} fg="error">
        Override
      </Text>
      {transforms.map(([transform]) => (
        <Text id={transform} key={transform} transform={transform}>
          hello WORLD
        </Text>
      ))}
      <Text id="rich" transform="uppercase">
        keep <span fg="#123456">Mixed</span> {0}
      </Text>
    </ThemeProvider>,
    { width: 30, height: 16 },
  );
  try {
    await act(async () => setup.flush());
    for (const [variant, color, attributes] of variants) {
      const text = setup.renderer.root.findDescendantById(variant) as TextRenderable;
      expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors[color]).toInts());
      expect(text.attributes & TextAttributes.BOLD).toBe(attributes);
    }
    const override = setup.renderer.root.findDescendantById("override") as TextRenderable;
    expect(override.fg.toInts()).toEqual(parseColor(defaultTheme.colors.error).toInts());
    expect(override.attributes & TextAttributes.BOLD).toBe(0);
    for (const [transform, expected] of transforms) {
      expect((setup.renderer.root.findDescendantById(transform) as TextRenderable).plainText).toBe(
        expected,
      );
    }
    expect(setup.captureCharFrame()).toContain("keep Mixed 0");
    const richSpan = setup.renderer.currentRenderBuffer
      .getSpanLines()
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("Mixed"))!;
    expect(richSpan.fg.toInts()).toEqual(parseColor("#123456").toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

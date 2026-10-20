import { expect, test } from "bun:test";

import {
  CliRenderEvents,
  type InputRenderable,
  parseColor,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { act, createRef, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { Box } from "@/ui/primitives/box";
import { Container } from "@/ui/primitives/container";
import { HStack } from "@/ui/primitives/hstack";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import type { Theme } from "@/ui/theme";
import { ThemeProvider } from "@/ui/theme-provider";
import { catppuccinTheme } from "@/ui/themes/catppuccin";
import { defaultTheme } from "@/ui/themes/default";

test("horizontal overflow does not create vertical overflow for short content", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  let resize!: Dispatch<SetStateAction<{ width: number; contentHeight: number }>>;
  function Fixture() {
    const [size, setSize] = useState({ width: 20, contentHeight: 2 });
    resize = setSize;
    return (
      <ThemeProvider theme={defaultTheme}>
        <ScrollArea ref={ref} width={size.width} height={8} scrollX>
          <Box width={60} height={size.contentHeight} />
        </ScrollArea>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 12 });
  try {
    await act(async () => setup.flush());
    const area = ref.current!;
    expect(area.horizontalScrollBar.visible).toBe(true);
    expect(area.verticalScrollBar.visible).toBe(false);
    expect(area.scrollHeight).toBeLessThanOrEqual(area.viewport.height);

    act(() => resize({ width: 20, contentHeight: 7 }));
    await act(async () => setup.flush());
    expect(area.viewport.height).toBe(7);
    expect(area.verticalScrollBar.visible).toBe(false);

    act(() => resize({ width: 20, contentHeight: 8 }));
    await act(async () => setup.flush());
    expect(area.horizontalScrollBar.visible).toBe(true);
    expect(area.verticalScrollBar.visible).toBe(true);

    act(() => resize({ width: 80, contentHeight: 2 }));
    await act(async () => setup.flush());
    expect(area.horizontalScrollBar.visible).toBe(false);
    expect(area.verticalScrollBar.visible).toBe(false);

    act(() => resize({ width: 20, contentHeight: 2 }));
    await act(async () => setup.flush());
    expect(ref.current).toBe(area);
    expect(area.horizontalScrollBar.visible).toBe(true);
    expect(area.verticalScrollBar.visible).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("two-axis scrolling preserves explicit content minimum height", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ScrollArea ref={ref} width={20} height={8} scrollX contentOptions={{ minHeight: 12 }}>
        <Box width={60} height={2} />
      </ScrollArea>
    </ThemeProvider>,
    { width: 30, height: 12 },
  );
  try {
    await act(async () => setup.flush());
    expect(ref.current!.content.height).toBe(12);
    expect(ref.current!.horizontalScrollBar.visible).toBe(true);
    expect(ref.current!.verticalScrollBar.visible).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("scroll area adopts themed borders, React props, refs, and local key hints", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  let setTheme!: Dispatch<SetStateAction<Theme>>;
  let cancel = false;
  function Fixture() {
    const [theme, updateTheme] = useState<Theme>(defaultTheme);
    setTheme = updateTheme;
    return (
      <ThemeProvider theme={theme}>
        <ScrollArea
          ref={ref}
          focused
          border
          bg="background"
          style={{ width: 30, height: 8 }}
          onKeyDown={(event) => {
            if (cancel) {
              event.preventDefault();
            }
          }}
        >
          <Text height={40}>Content</Text>
        </ScrollArea>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 40, height: 10, kittyKeyboard: true });
  try {
    await act(async () => setup.flush());
    const area = ref.current!;
    expect(area.height).toBe(8);
    expect(setup.renderer.currentFocusedRenderable).toBe(area);
    expect(area.borderStyle).toBe(defaultTheme.borders.default);
    expect(area.borderColor.toInts()).toEqual(parseColor(defaultTheme.colors.border).toInts());
    expect(area.focusedBorderColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.focus).toInts(),
    );
    expect(getControlHints(area)).toContainEqual({ keys: "Ctrl+d/u", label: "Half-page" });
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBeGreaterThan(0);
    act(() => setup.mockInput.pressKey("g"));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(0);
    cancel = true;
    act(() => setup.mockInput.pressKey("d", { ctrl: true }));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(0);
    cancel = false;
    act(() => setup.mockInput.pressKey("g", { shift: true }));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(area.scrollHeight - area.viewport.height);
    act(() => setTheme(catppuccinTheme));
    await act(async () => setup.flush());
    expect(ref.current).toBe(area);
    expect(area.backgroundColor.toInts()).toEqual(
      parseColor(catppuccinTheme.colors.background).toInts(),
    );
    expect(area.borderColor.toInts()).toEqual(parseColor(catppuccinTheme.colors.border).toInts());
    expect(area.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor(catppuccinTheme.colors.primary).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(ref.current).toBeNull();
});

test("focused descendants are revealed locally without overriding manual scrolling", async () => {
  const left = createRef<ScrollBoxRenderable>();
  const right = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <HStack>
        <ScrollArea ref={left} width={30} height={6} focusable={false}>
          <Container>
            <Input id="input" focused />
            {Array.from({ length: 12 }, (_, index) => (
              <Button key={index} id={`left:${index}`}>{`Left ${index}`}</Button>
            ))}
          </Container>
        </ScrollArea>
        <ScrollArea ref={right} width={30} height={6} focusable={false}>
          <Stack>
            {Array.from({ length: 12 }, (_, index) => (
              <Button key={index} id={`right:${index}`}>{`Right ${index}`}</Button>
            ))}
          </Stack>
        </ScrollArea>
      </HStack>
    </ThemeProvider>,
    { width: 62, height: 10 },
  );
  try {
    await act(async () => setup.flush());
    const area = left.current!;
    const tail = setup.renderer.root.findDescendantById("left:11")!;
    act(() => tail.focus());
    await act(async () => setup.flush());
    await act(async () =>
      setup.waitFor(
        () => tail.screenY + tail.height <= area.viewport.screenY + area.viewport.height,
      ),
    );
    expect(area.scrollTop).toBeGreaterThan(0);
    expect(right.current!.scrollTop).toBe(0);
    expect(tail.screenY + tail.height).toBeLessThanOrEqual(
      area.viewport.screenY + area.viewport.height,
    );
    act(() => area.scrollTo(0));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(0);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 2, area.viewport.screenY + 2, "down"),
    );
    await act(async () => setup.flush());
    const manualPosition = area.scrollTop;
    expect(manualPosition).toBeGreaterThan(0);
    await act(async () => setup.renderOnce());
    expect(area.scrollTop).toBe(manualPosition);
    const input = setup.renderer.root.findDescendantById("input") as InputRenderable;
    act(() => input.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("g"));
    await act(async () => setup.flush());
    expect(input.value).toBe("g");
    act(() => setup.renderer.root.findDescendantById("right:11")!.focus());
    await act(async () => setup.flush());
    expect(right.current!.scrollTop).toBeGreaterThan(0);
    expect(area.scrollTop).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("scroll area cancels pending focus reveal when unmounted and preserves native overrides", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  let setPresent!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [present, updatePresent] = useState(false);
    setPresent = updatePresent;
    return (
      <ThemeProvider theme={defaultTheme}>
        {present ? (
          <ScrollArea
            ref={ref}
            width={30}
            height={6}
            focusable={false}
            scrollbarColor="error"
            scrollbarOptions={{ trackOptions: { foregroundColor: "#123456" } }}
          >
            <Stack>
              <Text height={20}>Content</Text>
              <Button id="tail">Tail</Button>
            </Stack>
          </ScrollArea>
        ) : null}
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 8 });
  try {
    const unmountedFrames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
    const unmountedInputListeners = setup.renderer.stdin.listenerCount("data");
    act(() => setPresent(true));
    await act(async () => setup.flush());
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor("#123456").toInts(),
    );
    await act(async () => setup.mockMouse.moveTo(2, 2));
    await act(async () => setup.flush());
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor("#123456").toInts(),
    );
    const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
    act(() => setup.renderer.root.findDescendantById("tail")!.focus());
    expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + 1);
    act(() => setPresent(false));
    expect(ref.current).toBeNull();
    expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(unmountedFrames);
    expect(setup.renderer.stdin.listenerCount("data")).toBe(unmountedInputListeners);
    await act(async () => setup.flush());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("nested wheel scrolling stays in the hovered viewport, including at its limits", async () => {
  const outerRef = createRef<ScrollBoxRenderable>();
  const innerRef = createRef<ScrollBoxRenderable>();
  const receivers: string[] = [];
  const mouseReceivers: string[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ScrollArea ref={outerRef} width={40} height={12} scrollX>
        <Stack width={80} gap={0}>
          <Text height={2}>Page above</Text>
          <ScrollArea
            ref={innerRef}
            width={20}
            height={5}
            scrollX
            onMouse={function (event) {
              if (event.type === "scroll") {
                mouseReceivers.push(this.id);
              }
            }}
            onMouseScroll={function () {
              receivers.push(this.id);
            }}
          >
            <Stack width={60} gap={0}>
              {Array.from({ length: 20 }, (_, index) => (
                <Text key={index}>{`Row ${index}`}</Text>
              ))}
            </Stack>
          </ScrollArea>
          <Text height={30}>Page below</Text>
        </Stack>
      </ScrollArea>
    </ThemeProvider>,
    { width: 40, height: 12 },
  );
  try {
    await act(async () => setup.flush());
    const outer = outerRef.current!;
    const inner = innerRef.current!;
    const x = inner.viewport.screenX + 1;
    const y = inner.viewport.screenY + 1;
    async function wheel(direction: "up" | "down" | "left" | "right", shift = false) {
      await act(async () => setup.mockMouse.scroll(x, y, direction, { modifiers: { shift } }));
      await act(async () => setup.flush());
      expect(outer.scrollTop).toBe(0);
      expect(outer.scrollLeft).toBe(0);
      expect(outer.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.mutedForeground).toInts(),
      );
      expect(inner.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.primary).toInts(),
      );
    }
    expect(outer.scrollHeight).toBeGreaterThan(outer.viewport.height);
    expect(outer.scrollWidth).toBeGreaterThan(outer.viewport.width);
    await wheel("down");
    expect(inner.scrollTop).toBeGreaterThan(0);
    await wheel("right");
    expect(inner.scrollLeft).toBeGreaterThan(0);
    act(() => inner.scrollTo({ x: 0, y: 0 }));
    await act(async () => setup.flush());
    await wheel("down", true);
    expect(inner.scrollTop).toBe(0);
    expect(inner.scrollLeft).toBeGreaterThan(0);
    act(() => inner.scrollTo({ x: 0, y: 0 }));
    await act(async () => setup.flush());
    await wheel("up");
    await wheel("left");
    act(() => inner.scrollTo({ x: inner.scrollWidth, y: inner.scrollHeight }));
    await act(async () => setup.flush());
    const bottom = inner.scrollTop;
    const right = inner.scrollLeft;
    await wheel("down");
    await wheel("right");
    expect(inner.scrollTop).toBe(bottom);
    expect(inner.scrollLeft).toBe(right);
    expect(receivers).toEqual(Array(7).fill(inner.id));
    expect(mouseReceivers).toEqual(Array(7).fill(inner.id));
    await act(async () =>
      setup.mockMouse.scroll(outer.viewport.screenX + 30, outer.viewport.screenY + 10, "down"),
    );
    await act(async () => setup.flush());
    expect(outer.scrollTop).toBeGreaterThan(0);
    expect(inner.scrollTop).toBe(bottom);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("scrollbar colors independently follow keyboard and nested wheel targets", async () => {
  const outerRef = createRef<ScrollBoxRenderable>();
  const innerRef = createRef<ScrollBoxRenderable>();
  let cancel = true;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <HStack gap={0} alignItems="flex-start">
        <ScrollArea
          ref={outerRef}
          width={40}
          height={14}
          scrollX
          keyboardFallback
          focusable={false}
        >
          <Stack id="page" width={70} gap={0} focused focusable>
            <Input id="input" />
            <Button
              id="blocked"
              onKeyDown={(key) => {
                if (cancel) {
                  key.preventDefault();
                }
              }}
            >
              Custom navigation
            </Button>
            <ScrollArea ref={innerRef} width={20} height={5} scrollX>
              <Stack width={60} gap={0}>
                {Array.from({ length: 20 }, (_, index) => (
                  <Text key={index}>{`Row ${index}`}</Text>
                ))}
              </Stack>
            </ScrollArea>
            <Text height={30}>Page below</Text>
          </Stack>
        </ScrollArea>
        <Stack width={20} height={14}>
          <Text>Outside</Text>
        </Stack>
      </HStack>
    </ThemeProvider>,
    { width: 60, height: 16 },
  );
  function expectColor(area: ScrollBoxRenderable, color: "primary" | "mutedForeground") {
    const expected = parseColor(defaultTheme.colors[color]).toInts();
    expect(area.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(expected);
    expect(area.horizontalScrollBar.slider.foregroundColor.toInts()).toEqual(expected);
  }
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  try {
    await settle();
    const outer = outerRef.current!;
    const inner = innerRef.current!;
    expectColor(outer, "primary");
    expectColor(inner, "mutedForeground");
    await act(async () =>
      setup.mockMouse.moveTo(inner.viewport.screenX + 1, inner.viewport.screenY + 1),
    );
    await settle();
    expectColor(outer, "primary");
    expectColor(inner, "primary");
    act(() => inner.focus());
    await settle();
    expectColor(outer, "mutedForeground");
    expectColor(inner, "primary");
    await act(async () => setup.mockMouse.moveTo(30, 3));
    await settle();
    expectColor(outer, "primary");
    expectColor(inner, "primary");
    act(() => setup.renderer.root.findDescendantById("input")!.focus());
    await act(async () => setup.mockMouse.moveTo(50, 1));
    await settle();
    expectColor(outer, "mutedForeground");
    expectColor(inner, "mutedForeground");
    act(() => setup.mockInput.pressKey("g"));
    await settle();
    expectColor(outer, "mutedForeground");
    expect((setup.renderer.root.findDescendantById("input") as InputRenderable).value).toBe("g");
    act(() => setup.renderer.root.findDescendantById("blocked")!.focus());
    await settle();
    act(() => setup.mockInput.pressKey("j"));
    await settle();
    expectColor(outer, "mutedForeground");
    cancel = false;
    act(() => setup.mockInput.pressKey("j"));
    await settle();
    expectColor(outer, "primary");
    expect(outer.scrollTop).toBeGreaterThan(0);
    await act(async () =>
      setup.mockMouse.moveTo(inner.viewport.screenX + 1, inner.viewport.screenY + 1),
    );
    await settle();
    expectColor(inner, "primary");
    act(() => setup.mockInput.pressKey("j"));
    await settle();
    expectColor(outer, "primary");
    expectColor(inner, "primary");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("focused scrollbars stay muted without overflow and react to content size changes", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  let setHeight!: Dispatch<SetStateAction<number>>;
  function Fixture() {
    const [height, updateHeight] = useState(2);
    setHeight = updateHeight;
    return (
      <ThemeProvider theme={defaultTheme}>
        <ScrollArea ref={ref} focused width={30} height={6}>
          <Text height={height}>Content</Text>
        </ScrollArea>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 8 });
  try {
    for (const [height, color] of [
      [2, "mutedForeground"],
      [20, "primary"],
      [2, "mutedForeground"],
    ] as const) {
      act(() => setHeight(height));
      await act(async () => setup.flush());
      await act(async () => setup.flush());
      expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors[color]).toInts(),
      );
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("explicit scrollbar colors and native axis overrides survive activity changes", async () => {
  const customRef = createRef<ScrollBoxRenderable>();
  const axesRef = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <HStack>
        <ScrollArea ref={customRef} focused scrollbarColor="error" scrollX width={30} height={8}>
          <Text width={50} height={20}>
            Custom
          </Text>
        </ScrollArea>
        <ScrollArea
          ref={axesRef}
          scrollX
          width={30}
          height={8}
          scrollbarOptions={{ trackOptions: { foregroundColor: "#123456" } }}
          verticalScrollbarOptions={{ trackOptions: { foregroundColor: "#abcdef" } }}
          horizontalScrollbarOptions={{ trackOptions: { foregroundColor: "#fedcba" } }}
        >
          <Text width={50} height={20}>
            Axis overrides
          </Text>
        </ScrollArea>
      </HStack>
    </ThemeProvider>,
    { width: 62, height: 10 },
  );
  try {
    await act(async () => setup.flush());
    for (const ref of [axesRef, customRef]) {
      act(() => ref.current!.focus());
      await act(async () => setup.flush());
      await act(async () => setup.flush());
      expect(customRef.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.error).toInts(),
      );
      expect(axesRef.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor("#abcdef").toInts(),
      );
      expect(axesRef.current!.horizontalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor("#fedcba").toInts(),
      );
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an outside wheel report clears hover activity without requiring a mouse move", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ScrollArea ref={ref} width={30} height={6}>
        <Text height={20}>Content</Text>
      </ScrollArea>
    </ThemeProvider>,
    { width: 60, height: 8 },
  );
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  try {
    await settle();
    for (const afterEscape of [false, true]) {
      await act(async () => setup.mockMouse.moveTo(2, 2));
      await settle();
      expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.primary).toInts(),
      );
      if (afterEscape) {
        act(() => setup.mockInput.pressKey("ESCAPE"));
        await Bun.sleep(80);
      }
      await act(async () => setup.mockMouse.scroll(50, 1, "down"));
      await settle();
      expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.mutedForeground).toInts(),
      );
    }
    expect(ref.current!.scrollTop).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("pointer observation ignores pasted mouse escapes and handles fragmented reports", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ScrollArea ref={ref} width={30} height={6}>
        <Text height={20}>Content</Text>
      </ScrollArea>
    </ThemeProvider>,
    { width: 60, height: 8 },
  );
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  try {
    await settle();
    await act(async () => setup.mockMouse.moveTo(2, 2));
    await settle();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[200~\x1b[<65;51;2M\x1b[201~")));
    await settle();
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    act(() => {
      setup.renderer.stdin.emit("data", Buffer.from("\x1b[<65;51;"));
      setup.renderer.stdin.emit("data", Buffer.from("2M"));
    });
    await settle();
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    expect(ref.current!.scrollTop).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("blank-space wheel input highlights the native focused-target fallback", async () => {
  const ref = createRef<ScrollBoxRenderable>();
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ScrollArea ref={ref} width={30} height={6} keyboardFallback>
        <Input focused />
        <Text height={20}>Content</Text>
      </ScrollArea>
    </ThemeProvider>,
    { width: 60, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    await act(async () => setup.mockMouse.scroll(50, 1, "down"));
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(ref.current!.scrollTop).toBeGreaterThan(0);
    expect(ref.current!.verticalScrollBar.slider.foregroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

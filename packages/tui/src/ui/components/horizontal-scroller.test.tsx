import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  CliRenderEvents,
  MouseButton,
  parseColor,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createRef, type Dispatch, type SetStateAction, useState } from "react";

import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

const rows = [
  { id: "a", width: 20, label: "Alpha" },
  { id: "b", width: 20, label: "Beta" },
  { id: "c", width: 20, label: "Gamma" },
];

async function renderScroller(height?: number, onScrollInteraction?: () => void) {
  const ref = createRef<BoxRenderable>();
  let update!: Dispatch<
    SetStateAction<{ rows: typeof rows; width: number; height?: number; revealId?: string }>
  >;
  function Fixture() {
    const [state, setState] = useState<{
      rows: typeof rows;
      width: number;
      height?: number;
      revealId?: string;
    }>({
      rows,
      width: 23,
      height,
      revealId: undefined as string | undefined,
    });
    update = setState;
    return (
      <ThemeProvider theme={defaultTheme}>
        <ScrollArea id="outer" width={70} height={3} focusable={false} scrollX>
          <Box id="page" width={120} height={6} focusable>
            <HorizontalScroller
              id="scroller"
              ref={ref}
              width={state.width}
              height={state.height}
              revealId={state.revealId}
              onScrollInteraction={onScrollInteraction}
            >
              {state.rows.map((row) => (
                <Box
                  key={row.id}
                  id={row.id}
                  width={row.width}
                  height={state.height ?? 1}
                  flexShrink={0}
                >
                  <Text wrapMode="none">{row.label}</Text>
                  {state.height === 2 ? <Text wrapMode="none">underline {row.label}</Text> : null}
                </Box>
              ))}
            </HorizontalScroller>
            <Box id="outside" height={1} focusable focused />
          </Box>
        </ScrollArea>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 3, kittyKeyboard: true });
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  await settle();
  return {
    ...setup,
    ref,
    update,
    settle,
    area: () => setup.renderer.root.findDescendantById("scroller:viewport") as ScrollBoxRenderable,
  };
}

test("contained scrolling notifies pointer intent, not programmatic movement or release", async () => {
  let interactions = 0;
  const setup = await renderScroller(undefined, () => interactions++);
  try {
    const area = setup.area();
    act(() => area.scrollTo({ x: 20, y: 0 }));
    await setup.settle();
    expect(interactions).toBe(0);
    const left = setup.renderer.root.findDescendantById("scroller:left")!;
    await act(async () => setup.mockMouse.pressDown(left.screenX, left.screenY));
    expect(interactions).toBe(1);
    expect(area.scrollLeft).toBe(20);
    await act(async () => setup.mockMouse.release(left.screenX, left.screenY));
    expect(interactions).toBe(1);
    expect(area.scrollLeft).toBe(10);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX, area.viewport.screenY, "down"),
    );
    expect(interactions).toBe(2);
    await act(async () => setup.mockMouse.scroll(left.screenX, left.screenY, "down"));
    expect(interactions).toBe(3);
    act(() => area.scrollTo({ x: 0, y: 0 }));
    await setup.settle();
    expect(interactions).toBe(3);
    await act(async () => setup.mockMouse.click(left.screenX, left.screenY));
    expect(interactions).toBe(4);
    expect(area.scrollLeft).toBe(0);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX, area.viewport.screenY, "up"),
    );
    expect(interactions).toBe(5);
    expect(area.scrollLeft).toBe(0);
    for (const button of [MouseButton.RIGHT, MouseButton.MIDDLE] as const) {
      await act(async () => setup.mockMouse.click(left.screenX, left.screenY, button));
    }
    expect(interactions).toBe(5);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    expect(setup.ref.current!.height).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("two-row content scrolls and reveals without clipping its second row", async () => {
  const setup = await renderScroller(2);
  try {
    const root = setup.ref.current!;
    const area = setup.area();
    const frame = setup.captureCharFrame();
    const rightArrow = setup.renderer.root.findDescendantById("scroller:right")!;
    expect(root.height).toBe(2);
    expect(area.viewport.height).toBe(2);
    expect(frame.split("\n")[1]).toContain("underline");
    expect(rightArrow.screenY).toBe(root.screenY);
    expect(rightArrow.height).toBe(1);
    expect(getFocusableRenderables(root)).toEqual([]);

    act(() => area.scrollTo({ x: 10, y: 0 }));
    await setup.settle();
    expect(area.scrollLeft).toBe(10);
    expect(setup.captureCharFrame().split("\n")[1]).toContain("und");
    await act(async () => setup.update((state) => ({ ...state, revealId: "c" })));
    await setup.settle();
    expect(area.scrollLeft).toBe(39);
    expect(setup.captureCharFrame().split("\n")[0]).toContain("Gamma");
    expect(setup.captureCharFrame().split("\n")[1]).toContain("underline Gamma");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("two-row overflow arrows preserve release cancellation and outside focus", async () => {
  const setup = await renderScroller(2);
  try {
    const area = setup.area();
    const rightArrow = setup.renderer.root.findDescendantById("scroller:right")!;
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    await act(async () => setup.mockMouse.pressDown(rightArrow.screenX, rightArrow.screenY));
    expect(area.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    await act(async () => setup.mockMouse.release(rightArrow.screenX, rightArrow.screenY));
    expect(area.scrollLeft).toBe(10);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");

    await act(async () => setup.mockMouse.pressDown(rightArrow.screenX, rightArrow.screenY));
    await act(async () => setup.mockMouse.release(rightArrow.screenX, rightArrow.screenY + 1));
    expect(area.scrollLeft).toBe(10);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    await act(async () => setup.mockMouse.release(rightArrow.screenX, rightArrow.screenY));
    expect(area.scrollLeft).toBe(10);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal scroller fits, overflows, and returns to fit without arrow oscillation", async () => {
  const setup = await renderScroller();
  try {
    const root = setup.ref.current!;
    const area = setup.area();
    expect(root.height).toBe(1);
    expect(area.viewport.width).toBe(21);
    expect(setup.renderer.root.findDescendantById("scroller:left")!.width).toBe(1);
    expect(setup.renderer.root.findDescendantById("scroller:right")!.width).toBe(1);
    expect(getFocusableRenderables(root)).toEqual([]);
    act(() => area.scrollTo({ x: 30, y: 0 }));
    await act(async () =>
      setup.update((state) => ({
        ...state,
        rows: [{ id: "a", width: 23, label: "Fits exactly" }],
      })),
    );
    await setup.settle();
    expect(area.viewport.width).toBe(23);
    expect(area.scrollLeft).toBe(0);
    expect(setup.renderer.root.findDescendantById("scroller:left")).toBeUndefined();
    for (let frame = 0; frame < 3; frame++) {
      await act(async () => setup.renderOnce());
      expect(area.viewport.width).toBe(23);
    }
    await act(async () => setup.update((state) => ({ ...state, rows })));
    await setup.settle();
    expect(area.viewport.width).toBe(21);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal arrows scroll on primary release and preserve outside focus", async () => {
  const setup = await renderScroller();
  try {
    const area = setup.area();
    const outside = setup.renderer.currentFocusedRenderable;
    const right = setup.renderer.root.findDescendantById("scroller:right")!;
    const left = setup.renderer.root.findDescendantById("scroller:left")!;
    expect((left.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    expect((right.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.foreground).toInts(),
    );
    await act(async () => setup.mockMouse.pressDown(right.screenX, right.screenY));
    expect(area.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(outside?.id);
    await act(async () => setup.mockMouse.release(right.screenX, right.screenY));
    expect(area.scrollLeft).toBe(10);
    act(() =>
      setup.renderer.stdin.emit(
        "data",
        Buffer.from("\x1b[<0;23;1M\x1b[<0;23;1m\x1b[<0;23;1M\x1b[<0;23;1m"),
      ),
    );
    expect(area.scrollLeft).toBe(30);
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    expect(area.scrollLeft).toBe(39);
    await setup.settle();
    expect((right.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    expect(area.scrollLeft).toBe(39);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(outside?.id);
    await act(async () => setup.mockMouse.click(left.screenX, left.screenY));
    expect(area.scrollLeft).toBe(29);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal arrow gestures cancel at boundaries and after content or size changes", async () => {
  const setup = await renderScroller();
  try {
    const area = setup.area();
    const outside = setup.renderer.currentFocusedRenderable;
    const right = setup.renderer.root.findDescendantById("scroller:right")!;
    const left = setup.renderer.root.findDescendantById("scroller:left")!;
    await act(async () => setup.mockMouse.click(left.screenX, left.screenY));
    expect(area.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(outside?.id);
    await act(async () => setup.mockMouse.pressDown(right.screenX, right.screenY));
    await act(async () => setup.mockMouse.release(40, 2));
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY, MouseButton.RIGHT));
    expect(area.scrollLeft).toBe(0);
    await act(async () => setup.mockMouse.pressDown(right.screenX, right.screenY));
    await act(async () =>
      setup.update((state) => ({ ...state, rows: [{ id: "a", width: 23, label: "Fits" }] })),
    );
    await setup.settle();
    await act(async () => setup.mockMouse.release(22, 0));
    expect(area.scrollLeft).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(outside?.id);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal arrows reject a later gesture's release after an outside cancellation", async () => {
  const setup = await renderScroller();
  try {
    act(() =>
      setup.renderer.stdin.emit(
        "data",
        Buffer.from("\x1b[<0;23;1M\x1b[<0;41;3m\x1b[<0;41;3M\x1b[<0;23;1m"),
      ),
    );
    expect(setup.area().scrollLeft).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each([
  { button: MouseButton.RIGHT, name: "right" },
  { button: MouseButton.MIDDLE, name: "middle" },
])("horizontal arrows preserve a buffered primary click after $name button", async ({ button }) => {
  const setup = await renderScroller();
  try {
    const reports = `\x1b[<${button};23;1M\x1b[<${button};23;1m\x1b[<0;23;1M\x1b[<0;23;1m`;
    act(() => setup.renderer.stdin.emit("data", Buffer.from(reports)));
    expect(setup.area().scrollLeft).toBe(10);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each([
  { direction: "right", x: 23, start: 0, toward: 65, away: 64, expected: 29 },
  { direction: "left", x: 1, start: 39, toward: 64, away: 65, expected: 10 },
])(
  "horizontal arrows cancel buffered boundary reversal ($direction)",
  async ({ x, start, toward, away, expected }) => {
    const setup = await renderScroller();
    try {
      act(() => setup.area().scrollTo({ x: start, y: 0 }));
      await setup.settle();
      const reports =
        `\x1b[<0;${x};1M` +
        `\x1b[<${toward};${x};1M`.repeat(39) +
        `\x1b[<${away};${x};1M`.repeat(10) +
        `\x1b[<0;${x};1m`;
      act(() => setup.renderer.stdin.emit("data", Buffer.from(reports)));
      expect(setup.area().scrollLeft).toBe(expected);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("horizontal wheel input stays local across directions, Shift, arrows, and edges", async () => {
  const setup = await renderScroller();
  try {
    const area = setup.area();
    const outer = setup.renderer.root.findDescendantById("outer") as ScrollBoxRenderable;
    const outside = setup.renderer.currentFocusedRenderable;
    for (const shift of [false, true]) {
      for (const direction of ["down", "right", "up", "left"] as const) {
        const backwards = direction === "up" || direction === "left";
        const before = backwards ? 39 : 0;
        act(() => area.scrollTo({ x: before, y: 0 }));
        await setup.settle();
        await act(async () =>
          setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, direction, {
            modifiers: { shift },
          }),
        );
        const moved = area.scrollLeft;
        expect(backwards ? moved < before : moved > before).toBe(true);
        act(() => area.scrollTo({ x: before, y: 0 }));
        const arrow = setup.renderer.root.findDescendantById("scroller:right")!;
        await act(async () =>
          setup.mockMouse.scroll(arrow.screenX, arrow.screenY, direction, { modifiers: { shift } }),
        );
        expect(area.scrollLeft).toBe(moved);
        expect(area.scrollTop).toBe(0);
        expect(outer.scrollLeft).toBe(0);
        expect(outer.scrollTop).toBe(0);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(outside?.id);
      }
    }
    act(() => area.scrollTo({ x: 39, y: 0 }));
    await act(async () => setup.mockMouse.scroll(1, 0, "down"));
    expect(area.scrollLeft).toBe(39);
    expect(outer.scrollTop).toBe(0);
    expect(outer.scrollLeft).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal reveal follows target changes but preserves manual offsets", async () => {
  const setup = await renderScroller();
  try {
    const area = setup.area();
    await act(async () => setup.update((state) => ({ ...state, revealId: "c" })));
    await setup.settle();
    const target = setup.renderer.root.findDescendantById("c")!;
    expect(target.screenX + target.width).toBe(area.viewport.screenX + area.viewport.width);
    expect(area.scrollLeft).toBe(39);
    act(() => area.scrollTo({ x: 0, y: 0 }));
    await setup.settle();
    await act(async () => setup.update((state) => ({ ...state, rows: [...state.rows] })));
    await setup.settle();
    expect(area.scrollLeft).toBe(0);
    await act(async () =>
      setup.update((state) => ({
        ...state,
        revealId: "b",
        rows: [rows[0]!, { ...rows[1]!, width: 40 }, rows[2]!],
      })),
    );
    await setup.settle();
    const oversized = setup.renderer.root.findDescendantById("b")!;
    expect(oversized.screenX).toBe(area.viewport.screenX);
    act(() => area.scrollTo({ x: 30, y: 0 }));
    await setup.settle();
    expect(area.scrollLeft).toBe(30);
    await act(async () => setup.update((state) => ({ ...state, width: 17 })));
    await setup.settle();
    expect(oversized.screenX).toBe(area.viewport.screenX);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal reveal follows native ancestor refocus without changing props", async () => {
  const setup = await renderScroller();
  try {
    await act(async () => setup.update((state) => ({ ...state, revealId: "c" })));
    await setup.settle();
    act(() => setup.area().scrollTo({ x: 0, y: 0 }));
    await setup.settle();
    expect(setup.area().scrollLeft).toBe(0);
    act(() => setup.renderer.root.findDescendantById("page")!.focus());
    await setup.settle();
    expect(setup.area().scrollLeft).toBe(39);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("page");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal geometry handles missing targets, mutations, and tiny widths", async () => {
  const setup = await renderScroller();
  try {
    const area = setup.area();
    await act(async () => setup.update((state) => ({ ...state, revealId: "a" })));
    await setup.settle();
    await act(async () =>
      setup.update((state) => ({ ...state, rows: [rows[1]!, rows[2]!, rows[0]!] })),
    );
    await setup.settle();
    expect(area.scrollLeft).toBe(39);
    await act(async () =>
      setup.update((state) => ({
        ...state,
        rows: [{ ...rows[1]!, width: 40 }, rows[2]!, rows[0]!],
      })),
    );
    await setup.settle();
    expect(area.scrollLeft).toBe(59);
    await act(async () =>
      setup.update((state) => ({ ...state, revealId: "missing", rows: [rows[0]!] })),
    );
    await setup.settle();
    expect(area.scrollLeft).toBe(0);
    for (const width of [2, 1, 0, 23]) {
      await act(async () => setup.update((state) => ({ ...state, width })));
      await setup.settle();
      expect(setup.ref.current!.height).toBe(1);
      expect(setup.renderer.root.findDescendantById("scroller:left")).toBeUndefined();
      expect(area.scrollLeft).toBeLessThanOrEqual(
        Math.max(0, area.scrollWidth - area.viewport.width),
      );
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal scroller disposes native observers and forwards its layout ref", async () => {
  const ref = createRef<BoxRenderable>();
  let show!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [present, setPresent] = useState(false);
    show = setPresent;
    return (
      <ThemeProvider theme={defaultTheme}>
        {present ? (
          <HorizontalScroller ref={ref} width={10} revealId="label">
            <Text id="label" wrapMode="none">
              工作 workspace tail
            </Text>
          </HorizontalScroller>
        ) : null}
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 3 });
  try {
    const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
    const input = setup.renderer.stdin.listenerCount("data");
    await act(async () => show(true));
    await act(async () => setup.flush());
    expect(ref.current !== null).toBe(true);
    expect((ref.current!.findDescendantById("label") as TextRenderable).plainText).toBe(
      "工作 workspace tail",
    );
    expect(getFocusableRenderables(setup.renderer.root)).toEqual([]);
    act(() => show(false));
    expect(ref.current).toBeNull();
    expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames);
    expect(setup.renderer.stdin.listenerCount("data")).toBe(input);
    await act(async () => setup.flush());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal scroller gives direct text its full intrinsic row width", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <HorizontalScroller id="text-scroll" width={10}>
        <Text wrapMode="none" flexShrink={0}>
          工作 workspace readable tail
        </Text>
      </HorizontalScroller>
    </ThemeProvider>,
    { width: 30, height: 3 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const area = setup.renderer.root.findDescendantById(
      "text-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area.scrollWidth).toBeGreaterThan(10);
    act(() => area.scrollTo({ x: area.scrollWidth, y: 0 }));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("tail");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  parseColor,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { act, createRef, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Button } from "@/ui/controls/button";
import { getControlHints } from "@/ui/interaction/control-hints";
import { FocusManager } from "@/ui/interaction/focus-manager";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

for (const source of ["array", "getter"] as const) {
  test(`TabsList owns ${source} hint overrides through native refocus`, async () => {
    let eligible = true;
    const hints = [{ keys: "Enter/Space", label: "Enter destination" }];
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Tabs defaultValue="first">
            <TabsList
              id="list"
              focused
              controlHints={source === "array" ? [] : () => (eligible ? hints : [])}
            >
              <TabsTrigger value="first">First</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button id="outside">Outside</Button>
        </Stack>
      </ThemeProvider>,
      { width: 40, height: 8 },
    );
    try {
      await act(async () => setup.flush());
      const list = setup.renderer.root.findDescendantById("list")!;
      expect(getControlHints(list)).toEqual(source === "array" ? [] : hints);
      act(() => setup.renderer.root.findDescendantById("outside")!.focus());
      await act(async () => setup.flush());
      act(() => list.focus());
      await act(async () => setup.flush());
      expect(getControlHints(list)).toEqual(source === "array" ? [] : hints);
      eligible = false;
      expect(getControlHints(list)).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const [refocusValue, destination] of [
  ["first", "middle"],
  [undefined, "last"],
  ["disabled", "last"],
  ["missing", "last"],
] as const) {
  test(`native refocus resets buffered browsing from ${refocusValue ?? "controlled selection"} without selecting`, async () => {
    const changes: string[] = [];
    const entered: string[] = [];
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Tabs
            value="middle"
            onValueChange={(value) => changes.push(value)}
            onActivate={(value) => entered.push(value)}
          >
            <TabsList id="list" focused refocusValue={refocusValue}>
              <TabsTrigger value="first">First</TabsTrigger>
              <TabsTrigger value="middle">Middle</TabsTrigger>
              <TabsTrigger value="last">Last</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent id="first-panel" value="first">
              <Text>First panel</Text>
            </TabsContent>
            <TabsContent id="middle-panel" value="middle">
              <Text>Middle panel</Text>
            </TabsContent>
          </Tabs>
          <Button id="outside">Outside</Button>
        </Stack>
      </ThemeProvider>,
      { width: 60, height: 10 },
    );
    try {
      await act(async () => setup.flush());
      const list = setup.renderer.root.findDescendantById("list")!;
      act(() => setup.mockInput.pressKey("END"));
      await act(async () => setup.flush());
      expect(changes).toEqual(["last"]);
      act(() => {
        setup.renderer.root.findDescendantById("outside")!.focus();
        list.focus();
        expect(changes).toEqual(["last"]);
        setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r"));
      });
      expect(changes).toEqual(["last", destination]);
      expect(entered).toEqual([destination]);
      expect(setup.renderer.root.findDescendantById("list")).toBe(list);
      await act(async () => setup.flush());
      expect(setup.renderer.root.findDescendantById("middle-panel")!.visible).toBe(true);
      expect(setup.renderer.root.findDescendantById("first-panel")!.visible).toBe(false);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("tabs expose native refs and hints while keyboard navigation skips disabled triggers", async () => {
  const listRef = createRef<BoxRenderable>();
  const triggerRef = createRef<BoxRenderable>();
  const changes: string[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs gap={2} onValueChange={(value) => changes.push(value)}>
        <TabsList id="list" ref={listRef} focused>
          <TabsTrigger value="first" ref={triggerRef}>
            First
          </TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Disabled
          </TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent id="first" value="first">
          <Text>First panel</Text>
          <Text>Second line</Text>
        </TabsContent>
        <TabsContent id="last" value="last">
          <Text>Last panel</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 40, height: 10, kittyKeyboard: true },
  );
  async function press(key: string, ctrl = false) {
    act(() => setup.mockInput.pressKey(key, { ctrl }));
    await act(async () => setup.flush());
  }
  try {
    await act(async () => setup.flush());
    const list = setup.renderer.root.findDescendantById("list") as BoxRenderable;
    const first = setup.renderer.root.findDescendantById("first")!;
    const last = setup.renderer.root.findDescendantById("last")!;
    expect(listRef.current).toBe(list);
    expect(triggerRef.current?.parent !== null).toBe(true);
    expect(list.findDescendantById(triggerRef.current!.id)).toBe(triggerRef.current!);
    expect(getControlHints(list)).toContainEqual({ keys: "→/l", label: "Next" });
    expect(first.visible).toBe(true);
    expect(first.screenY - (list.screenY + list.height)).toBe(2);
    const rows = setup.captureCharFrame().split("\n");
    expect(rows[first.screenY]).toContain("First panel");
    expect(rows[first.screenY + 2]).toContain("Second line");
    await press("ARROW_RIGHT");
    expect(last.visible).toBe(true);
    expect(first.visible).toBe(false);
    await press("l");
    expect(first.visible).toBe(true);
    await press("h");
    await press("HOME");
    await press("g", true);
    expect(first.visible).toBe(true);
    expect(changes).toEqual(["last", "first", "last", "first"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(listRef.current).toBeNull();
  expect(triggerRef.current).toBeNull();
});

test("expanded custom tab labels retain full-width visuals and activate only on release", async () => {
  const changes: string[] = [];
  const receivers: BoxRenderable[] = [];
  let cancelUp = false;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs defaultValue="first" width={60} onValueChange={(value) => changes.push(value)}>
        <TabsList>
          <TabsTrigger
            value="first"
            bg="accent"
            flexGrow={1}
            flexBasis={0}
            justifyContent="center"
            onMouseUp={(event) => {
              if (cancelUp) {
                event.preventDefault();
              }
            }}
          >
            First
          </TabsTrigger>
          <TabsTrigger
            id="custom"
            value="custom"
            bg="accent"
            flexGrow={1}
            flexBasis={0}
            justifyContent="center"
            onMouseDown={function () {
              receivers.push(this);
            }}
            onMouseUp={function (event) {
              receivers.push(this);
              if (cancelUp) {
                event.preventDefault();
              }
            }}
          >
            <Text id="label">Custom</Text>
          </TabsTrigger>
          <TabsTrigger value="disabled" disabled flexGrow={1} flexBasis={0} justifyContent="center">
            Disabled
          </TabsTrigger>
        </TabsList>
        <TabsContent value="first">
          <Text>First panel</Text>
        </TabsContent>
        <TabsContent value="custom">
          <Text>Custom panel</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 60, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("custom") as BoxRenderable;
    const label = setup.renderer.root.findDescendantById("label")!;
    expect(trigger.width).toBe(20);
    expect(setup.captureCharFrame().split("\n")[1]).toBe("━".repeat(60));
    expect(label.screenX - trigger.screenX).toBe(7);
    const x = trigger.screenX + 1;
    const y = trigger.screenY;
    await act(async () => setup.mockMouse.pressDown(x, y));
    expect(changes).toEqual([]);
    await act(async () => setup.mockMouse.release(x, y));
    await act(async () => setup.flush());
    expect(changes).toEqual(["custom"]);
    expect(receivers).toEqual([trigger, trigger]);
    expect(setup.captureCharFrame()).toContain("Custom panel");
    expect((label.parent as BoxRenderable).backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.accent).toInts(),
    );
    act(() => setup.renderer.currentFocusedRenderable?.blur());
    await act(async () => setup.flush());
    expect((label.parent as BoxRenderable).backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.accent).toInts(),
    );
    cancelUp = true;
    await act(async () => setup.mockMouse.click(1, y));
    cancelUp = false;
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(x, y + 4));
    await act(async () => setup.mockMouse.release(x, y + 4));
    await act(async () => setup.mockMouse.click(41, y));
    expect(changes).toEqual(["custom"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

async function renderActivation(
  options: { controlled?: boolean; override?: boolean; width?: number } = {},
) {
  const changes: string[] = [];
  const activations: string[] = [];
  let controlPresses = 0;
  let scrollInteractions = 0;
  let update!: Dispatch<
    SetStateAction<{ value: string; present: boolean; disabled: boolean; cancel: boolean }>
  >;
  function Fixture() {
    const [state, setState] = useState({
      value: "first",
      present: true,
      disabled: false,
      cancel: false,
    });
    update = setState;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Tabs
            {...(options.controlled ? { value: state.value } : { defaultValue: "first" })}
            onValueChange={(value) => changes.push(value)}
            {...(options.override
              ? { onActivate: (value: string) => activations.push(value) }
              : {})}
          >
            <TabsList id="list" focused onScrollInteraction={() => scrollInteractions++}>
              <TabsTrigger value="first">First</TabsTrigger>
              <TabsTrigger value="second">Second</TabsTrigger>
              <TabsTrigger value="third">Third</TabsTrigger>
              {state.present ? (
                <TabsTrigger
                  id="last-trigger"
                  value="last"
                  disabled={state.disabled}
                  onMouseUp={(event) => {
                    if (state.cancel) {
                      event.preventDefault();
                    }
                  }}
                >
                  Last
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent id="first-panel" value="first">
              <Text>First panel</Text>
            </TabsContent>
            <TabsContent value="second">
              <Button id="second-target">Second</Button>
            </TabsContent>
            <TabsContent value="third">
              <Button id="third-target">Third</Button>
            </TabsContent>
            {state.present ? (
              <TabsContent value="last" focusable={false}>
                <Button disabled>Disabled</Button>
                <Button visible={false}>Hidden</Button>
                <Button id="last-target" onPress={() => controlPresses++}>
                  Last
                </Button>
              </TabsContent>
            ) : null}
          </Tabs>
          <Button id="outside">Outside</Button>
        </Stack>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, {
    width: options.width ?? 60,
    height: 12,
    kittyKeyboard: true,
  });
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  await settle();
  return {
    ...setup,
    changes,
    activations,
    update,
    settle,
    presses: () => controlPresses,
    scrollInteractions: () => scrollInteractions,
    list: () => setup.renderer.root.findDescendantById("list")!,
    trigger: () => setup.renderer.root.findDescendantById("last-trigger")!,
  };
}

test("primary release selects and enters the clicked panel; reclick enters again", async () => {
  const setup = await renderActivation();
  const { renderer, changes } = setup;
  try {
    const trigger = setup.trigger();
    await act(async () => setup.mockMouse.pressDown(trigger.screenX + 1, trigger.screenY));
    expect(changes).toEqual([]);
    expect(renderer.currentFocusedRenderable?.id).toBe("list");
    await act(async () => setup.mockMouse.release(trigger.screenX + 1, trigger.screenY));
    await setup.settle();
    expect(changes).toEqual(["last"]);
    expect(renderer.currentFocusedRenderable?.id).toBe("last-target");
    const controlPresses = setup.presses();
    expect(controlPresses).toBe(0);
    act(() => setup.list().focus());
    await act(async () => setup.mockMouse.click(trigger.screenX + 1, trigger.screenY + 1));
    await setup.settle();
    expect(changes).toEqual(["last"]);
    expect(renderer.currentFocusedRenderable?.id).toBe("last-target");
    expect(setup.presses()).toBe(0);
  } finally {
    act(() => renderer.destroy());
  }
});

test("activation override receives the requested value without generic focus", async () => {
  const setup = await renderActivation({ controlled: true, override: true });
  const { renderer, activations } = setup;
  try {
    const trigger = setup.trigger();
    await act(async () => setup.mockMouse.click(trigger.screenX + 1, trigger.screenY));
    await setup.settle();
    expect(activations).toEqual(["last"]);
    expect(renderer.currentFocusedRenderable?.id).toBe("list");
    expect(setup.renderer.root.findDescendantById("first-panel")!.visible).toBe(true);
    act(() => setup.update((state) => ({ ...state, value: "last" })));
    await setup.settle();
    expect(renderer.currentFocusedRenderable?.id).toBe("list");
    for (const key of ["RETURN", " "]) {
      act(() => setup.mockInput.pressKey(key));
      await setup.settle();
    }
    expect(activations).toEqual(["last", "last", "last"]);
    expect(renderer.currentFocusedRenderable?.id).toBe("list");
  } finally {
    act(() => renderer.destroy());
  }
});

test("two buffered controlled next keys request two distinct tabs", async () => {
  const setup = await renderActivation({ controlled: true });
  const { changes } = setup;
  try {
    act(() => {
      setup.mockInput.pressKey("ARROW_RIGHT");
      setup.mockInput.pressKey("ARROW_RIGHT");
    });
    await setup.settle();
    expect(changes).toEqual(["second", "third"]);
    expect(setup.renderer.root.findDescendantById("first-panel")!.visible).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each(["browse", "enter"])(
  "intermediate controlled commits preserve the latest requested %s",
  async (action) => {
    const setup = await renderActivation({ controlled: true });
    try {
      act(() => {
        setup.mockInput.pressKey("ARROW_RIGHT");
        setup.mockInput.pressKey("ARROW_RIGHT");
        if (action === "enter") {
          setup.mockInput.pressEnter();
        }
      });
      await setup.settle();
      act(() => setup.update((state) => ({ ...state, value: "second" })));
      await setup.settle();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
      if (action === "browse") {
        act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
        await setup.settle();
        expect(setup.changes).toEqual(["second", "third", "last"]);
      } else {
        act(() => setup.update((state) => ({ ...state, value: "third" })));
        await setup.settle();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("third-target");
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test.each(["mouse", "buffered browse+Enter"])(
  "delayed controlled %s enters only the requested committed content",
  async (source) => {
    const setup = await renderActivation({ controlled: true });
    try {
      if (source === "mouse") {
        const trigger = setup.trigger();
        await act(async () => setup.mockMouse.click(trigger.screenX + 1, trigger.screenY));
      } else {
        act(() => {
          setup.mockInput.pressKey("END");
          setup.mockInput.pressEnter();
        });
      }
      await setup.settle();
      expect(setup.changes).toEqual(["last"]);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
      act(() => setup.update((state) => ({ ...state, value: "last" })));
      await setup.settle();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("last-target");
      expect(setup.presses()).toBe(0);
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test.each(["outside focus", "leave and return", "new input", "new selection", "target removal"])(
  "late controlled activation yields to %s",
  async (cancellation) => {
    const setup = await renderActivation({ controlled: true });
    try {
      const trigger = setup.trigger();
      await act(async () => setup.mockMouse.click(trigger.screenX + 1, trigger.screenY));
      await setup.settle();
      act(() => {
        if (cancellation === "outside focus" || cancellation === "leave and return") {
          setup.renderer.root.findDescendantById("outside")!.focus();
          if (cancellation === "leave and return") {
            setup.list().focus();
          }
        } else if (cancellation === "new input") {
          setup.mockInput.pressKey("x");
        } else if (cancellation === "new selection") {
          setup.mockInput.pressKey("HOME");
        } else {
          setup.update((state) => ({ ...state, present: false }));
        }
      });
      await setup.settle();
      act(() => setup.update((state) => ({ ...state, value: "last", present: true })));
      await setup.settle();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        cancellation === "outside focus" ? "outside" : "list",
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

for (const source of ["mouse", "buffered browse+Enter"] as const) {
  test.each(["wheel", "arrow", "arrow wheel", "edge arrow"])(
    `delayed controlled ${source} entry yields to contained %s input`,
    async (pointer) => {
      const setup = await renderActivation({ controlled: true, width: 20 });
      try {
        const area = setup.renderer.root.findDescendantById(
          "list:scroller:viewport",
        ) as ScrollBoxRenderable;
        if (source === "mouse") {
          act(() => area.scrollTo({ x: area.scrollWidth, y: 0 }));
          await setup.settle();
          const trigger = setup.trigger();
          await act(async () => setup.mockMouse.click(trigger.screenX + 1, trigger.screenY));
        } else {
          act(() => {
            setup.mockInput.pressKey("END");
            setup.mockInput.pressEnter();
          });
        }
        await setup.settle();
        expect(setup.changes).toEqual(["last"]);
        expect(setup.renderer.currentFocusedRenderable).toBe(setup.list());
        expect(setup.renderer.root.findDescendantById("first-panel")!.visible).toBe(true);
        const before = area.scrollLeft;
        expect(before).toBeGreaterThan(0);
        const left = setup.renderer.root.findDescendantById("list:scroller:left")!;
        if (pointer === "arrow" || pointer === "edge arrow") {
          const arrow =
            pointer === "edge arrow"
              ? setup.renderer.root.findDescendantById("list:scroller:right")!
              : left;
          await act(async () => setup.mockMouse.pressDown(arrow.screenX, arrow.screenY));
          expect(area.scrollLeft).toBe(before);
          expect(setup.scrollInteractions()).toBe(1);
          await act(async () => setup.mockMouse.release(arrow.screenX, arrow.screenY));
        } else {
          const target = pointer === "arrow wheel" ? left : area.viewport;
          await act(async () => setup.mockMouse.scroll(target.screenX, target.screenY, "up"));
        }
        await setup.settle();
        if (pointer === "edge arrow") {
          expect(area.scrollLeft).toBe(before);
          expect(area.scrollLeft).toBe(area.scrollWidth - area.viewport.width);
        } else {
          expect(area.scrollLeft).toBeLessThan(before);
        }
        expect(setup.scrollInteractions()).toBe(1);
        expect(setup.changes).toEqual(["last"]);
        expect(setup.renderer.currentFocusedRenderable).toBe(setup.list());
        act(() => setup.update((state) => ({ ...state, value: "last" })));
        await setup.settle();
        expect(setup.renderer.root.findDescendantById("last-target")!.parent!.visible).toBe(true);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
        expect(setup.presses()).toBe(0);
        act(() => setup.mockInput.pressEnter());
        await setup.settle();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("last-target");
      } finally {
        act(() => setup.renderer.destroy());
      }
    },
  );
}

test("cancelled, outside, disabled, right and middle releases neither select nor activate", async () => {
  const setup = await renderActivation({ override: true });
  try {
    const trigger = setup.trigger();
    const x = trigger.screenX + 1;
    const y = trigger.screenY;
    for (const button of [MouseButton.RIGHT, MouseButton.MIDDLE] as const) {
      await act(async () => setup.mockMouse.click(x, y, button));
    }
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.release(x, y + 5));
    act(() => setup.update((state) => ({ ...state, cancel: true })));
    await setup.settle();
    await act(async () => setup.mockMouse.click(x, y));
    act(() => setup.update((state) => ({ ...state, cancel: false, disabled: true })));
    await setup.settle();
    await act(async () => setup.mockMouse.click(x, y));
    act(() => setup.mockInput.pressKey("END"));
    await setup.settle();
    expect(setup.changes).toEqual(["third"]);
    expect(setup.activations).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a later gesture's release cannot complete an abandoned tab press", async () => {
  const setup = await renderActivation({ override: true });
  try {
    const trigger = setup.trigger();
    const x = trigger.screenX + 2;
    const y = trigger.screenY + 1;
    act(() =>
      setup.renderer.stdin.emit(
        "data",
        Buffer.from(`\x1b[<0;${x};${y}M\x1b[<0;59;12m\x1b[<0;59;12M\x1b[<0;${x};${y}m`),
      ),
    );
    await setup.settle();
    expect(setup.changes).toEqual([]);
    expect(setup.activations).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

async function renderOverflow() {
  const changes: string[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Tabs onValueChange={(value) => changes.push(value)}>
          <TabsList id="overflow-list" focused>
            <TabsTrigger id="unicode" value="unicode">
              研究
            </TabsTrigger>
            <TabsTrigger id="tail" value="tail">
              Tail
            </TabsTrigger>
          </TabsList>
          <TabsContent value="unicode">
            <Text>Unicode panel</Text>
          </TabsContent>
          <TabsContent value="tail">
            <Text>Tail panel</Text>
          </TabsContent>
        </Tabs>
        <Button id="outside">Outside</Button>
      </Stack>
    </ThemeProvider>,
    { width: 12, height: 8 },
  );
  async function settle() {
    for (let frame = 0; frame < 4; frame++) {
      await act(async () => setup.flush());
    }
  }
  await settle();
  return {
    ...setup,
    settle,
    changes,
    area: () =>
      setup.renderer.root.findDescendantById(
        "overflow-list:scroller:viewport",
      ) as ScrollBoxRenderable,
  };
}

test("pointer scrolling preserves selection and native focus", async () => {
  const setup = await renderOverflow();
  try {
    act(() => setup.resize(9, 8));
    await setup.settle();
    const area = setup.area();
    const outside = setup.renderer.root.findDescendantById("outside")!;
    act(() => outside.focus());
    await setup.settle();
    const right = setup.renderer.root.findDescendantById("overflow-list:scroller:right")!;
    expect(right).toBeDefined();
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await setup.settle();
    expect(area.scrollLeft).toBeGreaterThan(0);
    expect(setup.renderer.currentFocusedRenderable).toBe(outside);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    await setup.settle();
    expect(setup.changes).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable).toBe(outside);
    expect(setup.captureCharFrame()).toContain("Unicode");
    expect(setup.captureCharFrame()).not.toContain("Tail panel");
    act(() => setup.renderer.root.findDescendantById("overflow-list")!.focus());
    await setup.settle();
    expect(area.scrollLeft).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("expanded triggers keep equal fitting widths and unabridged labels when narrowed", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs>
        <TabsList id="expanded" focused>
          <TabsTrigger id="short" value="short" flexGrow={1} flexBasis={0}>
            Short
          </TabsTrigger>
          <TabsTrigger id="long" value="long" flexGrow={1} flexBasis={0}>
            研究 complete label
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </ThemeProvider>,
    { width: 60, height: 4 },
  );
  async function settle() {
    for (let frame = 0; frame < 4; frame++) {
      await act(async () => setup.flush());
    }
  }
  try {
    await settle();
    const short = setup.renderer.root.findDescendantById("short")!;
    const long = setup.renderer.root.findDescendantById("long")!;
    expect([short.width, long.width]).toEqual([30, 30]);
    act(() => setup.resize(12, 4));
    await settle();
    expect(short.width).toBeGreaterThanOrEqual(7);
    expect(long.width).toBeGreaterThanOrEqual(21);
    const area = setup.renderer.root.findDescendantById(
      "expanded:scroller:viewport",
    ) as ScrollBoxRenderable;
    expect(area.scrollWidth).toBeGreaterThan(12);
    act(() => setup.mockInput.pressKey("END"));
    await settle();
    expect(long.screenX).toBe(area.viewport.screenX);
    for (let frame = 0; frame < 5; frame++) {
      await act(async () => setup.renderOnce());
      expect(long.width).toBeGreaterThanOrEqual(21);
      expect(area.scrollWidth).toBeGreaterThan(12);
    }
    act(() => area.scrollTo({ x: area.scrollWidth, y: 0 }));
    await settle();
    expect(setup.captureCharFrame()).toContain("label");
    act(() => setup.resize(60, 4));
    await settle();
    expect([short.width, long.width]).toEqual([30, 30]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled selection and rendered reordering reveal triggers without requesting entry", async () => {
  const changes: string[] = [];
  const activations: string[] = [];
  let update!: Dispatch<SetStateAction<{ value: string; reversed: boolean }>>;
  const triggerRef = createRef<BoxRenderable>();
  function Fixture() {
    const [state, setState] = useState({ value: "first", reversed: false });
    update = setState;
    const values = state.reversed ? ["last", "middle", "first"] : ["first", "middle", "last"];
    return (
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Tabs
            value={state.value}
            onValueChange={(value) => changes.push(value)}
            onActivate={(value) => activations.push(value)}
          >
            <TabsList id="ordered" gap={2}>
              {values.map((value) => (
                <TabsTrigger
                  key={value}
                  id={`ordered:${value}`}
                  value={value}
                  ref={value === "last" ? triggerRef : undefined}
                >
                  {value}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button id="outside" focused>
            Outside
          </Button>
        </Stack>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 12, height: 6 });
  async function settle() {
    for (let frame = 0; frame < 4; frame++) {
      await act(async () => setup.flush());
    }
  }
  try {
    await settle();
    const last = triggerRef.current!;
    const area = setup.renderer.root.findDescendantById(
      "ordered:scroller:viewport",
    ) as ScrollBoxRenderable;
    act(() => update((state) => ({ ...state, value: "last" })));
    await settle();
    expect(last.screenX + last.width).toBe(area.viewport.screenX + area.viewport.width);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    expect(changes).toEqual([]);
    expect(activations).toEqual([]);
    act(() => update((state) => ({ ...state, reversed: true })));
    await settle();
    expect(triggerRef.current).toBe(last);
    expect(last.screenX).toBe(area.viewport.screenX);
    act(() => setup.renderer.root.findDescendantById("ordered")!.focus());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    await settle();
    expect(changes).toEqual(["middle"]);
    act(() => {
      setup.renderer.root.findDescendantById("outside")!.focus();
      setup.renderer.root.findDescendantById("ordered")!.focus();
      setup.mockInput.pressEnter();
    });
    await settle();
    expect(activations).toEqual(["last"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("ordered");
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(triggerRef.current).toBeNull();
});

test("controlled tabs request changes without mutating their selected panel", async () => {
  const changes: string[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs value="first" onValueChange={(value) => changes.push(value)}>
        <TabsList focused>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent value="first">
          <Text>First panel</Text>
        </TabsContent>
        <TabsContent value="last">
          <Text>Last panel</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    await act(async () => setup.flush());
    expect(changes).toEqual(["last"]);
    expect(setup.captureCharFrame()).toContain("First panel");
    expect(setup.captureCharFrame()).not.toContain("Last panel");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("read-only tabs omit navigation hints and leave keys available for caller fallback", async () => {
  const keys: KeyEvent[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs value="first">
        <TabsList id="readonly" focused onKeyDown={(key) => keys.push(key)}>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent value="first">
          <Text>First panel</Text>
        </TabsContent>
        <TabsContent value="last">
          <Text>Last panel</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("ARROW_RIGHT"));
    await act(async () => setup.flush());
    expect(keys.at(-1)?.defaultPrevented).toBe(false);
    expect(keys.at(-1)?.propagationStopped).toBe(false);
    expect(getControlHints(setup.renderer.root.findDescendantById("readonly")!)).toEqual([
      { keys: "Enter/Space", label: "Activate" },
    ]);
    expect(setup.captureCharFrame()).toContain("First panel");
    expect(setup.captureCharFrame()).not.toContain("Last panel");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Enter and Space enter selected content without changing selection or activating its controls", async () => {
  const panelRef = createRef<BoxRenderable>();
  const changes: string[] = [];
  let presses = 0;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="scope" />
      <Stack id="scope">
        <Tabs defaultValue="controls" onValueChange={(value) => changes.push(value)}>
          <TabsList id="list" focused>
            <TabsTrigger value="controls">Controls</TabsTrigger>
            <TabsTrigger value="plain">Plain</TabsTrigger>
          </TabsList>
          <TabsContent value="controls">
            <Button disabled>Disabled</Button>
            <Button visible={false}>Hidden</Button>
            <Button id="target" onPress={() => presses++}>
              Action
            </Button>
            <Button id="later">Later</Button>
          </TabsContent>
          <TabsContent value="plain" id="plain" ref={panelRef}>
            <Text>Text-only panel</Text>
          </TabsContent>
        </Tabs>
      </Stack>
    </ThemeProvider>,
    { width: 40, height: 12 },
  );
  async function press(key: string) {
    act(() => setup.mockInput.pressKey(key));
    await act(async () => setup.flush());
  }
  try {
    await act(async () => setup.flush());
    const list = setup.renderer.root.findDescendantById("list")!;
    expect(getControlHints(list)).toContainEqual({ keys: "Enter/Space", label: "Activate" });
    for (const key of ["RETURN", " "]) {
      act(() => list.focus());
      await press(key);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("target");
      expect(presses).toBe(0);
      expect(changes).toEqual([]);
    }
    act(() => list.focus());
    await press("ARROW_RIGHT");
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    expect(setup.captureCharFrame()).toContain("Text-only panel");
    expect(changes).toEqual(["plain"]);
    await press(" ");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("plain");
    expect(panelRef.current).toBe(setup.renderer.currentFocusedRenderable as BoxRenderable);
    await press("TAB");
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    expect(changes).toEqual(["plain"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(panelRef.current).toBeNull();
});

test("activation works for read-only tabs and respects canceled, modified, and repeated keys", async () => {
  let cancel = false;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs value="plain">
        <TabsList
          id="list"
          focused
          onKeyDown={(key) => {
            if (cancel) {
              key.preventDefault();
            }
          }}
        >
          <TabsTrigger value="plain">Plain</TabsTrigger>
        </TabsList>
        <TabsContent id="plain" value="plain">
          <Text>Content</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6, kittyKeyboard: true },
  );
  try {
    await act(async () => setup.flush());
    const list = setup.renderer.root.findDescendantById("list")!;
    cancel = true;
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    cancel = false;
    for (const modifiers of [{ ctrl: true }, { shift: true }, { meta: true }]) {
      act(() => setup.mockInput.pressEnter(modifiers));
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable).toBe(list);
    }
    for (const repeated of [true, false]) {
      act(() =>
        setup.renderer.keyInput.processParsedKey({
          name: "linefeed",
          repeated,
          ctrl: false,
          meta: false,
          shift: false,
          option: false,
          sequence: "",
          raw: "",
          number: false,
          eventType: repeated ? "repeat" : "press",
          source: "kitty",
        }),
      );
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(repeated ? "list" : "plain");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("activation leaves keys unconsumed when the selected panel has no eligible focus target", async () => {
  const keys: KeyEvent[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs defaultValue="plain">
        <TabsList id="list" focused onKeyDown={(key) => keys.push(key)}>
          <TabsTrigger value="plain">Plain</TabsTrigger>
          <TabsTrigger value="missing">Missing</TabsTrigger>
        </TabsList>
        <TabsContent value="plain" focusable={false}>
          <Text>Content</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    for (const key of ["RETURN", "ARROW_RIGHT", " "]) {
      act(() => setup.mockInput.pressKey(key));
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
      expect(keys.at(-1)?.defaultPrevented).toBe(key === "ARROW_RIGHT");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered switching and Enter focus the new panel's controls after visibility commits", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs defaultValue="first">
        <TabsList focused>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent value="first">
          <Text>First panel</Text>
        </TabsContent>
        <TabsContent value="last" focusable={false}>
          <Button id="last-target">Last panel</Button>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    act(() => {
      setup.mockInput.pressKey("ARROW_RIGHT");
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("last-target");
    expect(setup.captureCharFrame()).toContain("Last panel");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered activation leaves Enter unconsumed when the new panel has no focus target", async () => {
  const keys: KeyEvent[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Tabs defaultValue="first">
        <TabsList id="list" focused onKeyDown={(key) => keys.push(key)}>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent value="first">
          <Text>First panel</Text>
        </TabsContent>
        <TabsContent value="last" focusable={false}>
          <Text>Last panel</Text>
        </TabsContent>
      </Tabs>
    </ThemeProvider>,
    { width: 30, height: 6 },
  );
  try {
    await act(async () => setup.flush());
    act(() => {
      setup.mockInput.pressKey("ARROW_RIGHT");
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(keys.at(-1)?.defaultPrevented).toBe(false);
    expect(keys.at(-1)?.propagationStopped).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("pending activation yields to a newer native focus change", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Tabs defaultValue="first">
          <TabsList focused>
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="last">Last</TabsTrigger>
          </TabsList>
          <TabsContent value="first">
            <Text>First panel</Text>
          </TabsContent>
          <TabsContent value="last">
            <Text>Last panel</Text>
          </TabsContent>
        </Tabs>
        <Button id="outside">Outside</Button>
      </Stack>
    </ThemeProvider>,
    { width: 30, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    act(() => {
      setup.mockInput.pressKey("ARROW_RIGHT");
      setup.mockInput.pressEnter();
      setup.renderer.root.findDescendantById("outside")!.focus();
    });
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

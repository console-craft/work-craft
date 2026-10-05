import { expect, test } from "bun:test";

import { type BoxRenderable, type KeyEvent, parseColor } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createRef } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { FocusManager } from "@/ui/focus-manager";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

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
    expect(triggerRef.current).toBe(list.getChildren()[0] as BoxRenderable);
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
      parseColor(defaultTheme.colors.focus).toInts(),
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

import { expect, test } from "bun:test";

import { type BoxRenderable, type InputRenderable, parseColor } from "@opentui/core";
import { act, createRef, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  type AccordionItemProps,
  AccordionTrigger,
  type AccordionTriggerProps,
} from "@/ui/components/accordion";
import { getControlHints } from "@/ui/control-hints";
import { Input } from "@/ui/controls/input";
import { FocusManager } from "@/ui/focus-manager";
import { Stack } from "@/ui/primitives/stack";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

function Item({
  value,
  triggerProps,
  ...props
}: AccordionItemProps & { triggerProps?: AccordionTriggerProps }) {
  return (
    <AccordionItem value={value} {...props}>
      <AccordionTrigger id={`trigger:${value}`} {...triggerProps}>
        {value || "Empty"}
      </AccordionTrigger>
      <AccordionContent id={`content:${value}`}>
        <Input id={`input:${value}`} />
      </AccordionContent>
    </AccordionItem>
  );
}

test("accordion trigger forwards refs, observes native focus, and safely disables", async () => {
  const ref = createRef<BoxRenderable>();
  const rootRef = createRef<BoxRenderable>();
  let setDisabled!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [disabled, updateDisabled] = useState(false);
    setDisabled = updateDisabled;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Accordion ref={rootRef} id="root">
          <Item value="a" disabled={disabled} triggerProps={{ ref, focused: true }} />
          <Item value="b" />
        </Accordion>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 8 });
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger:a") as BoxRenderable;
    expect(ref.current).toBe(trigger);
    expect(rootRef.current).toBe(setup.renderer.root.findDescendantById("root") as BoxRenderable);
    expect(trigger.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.focus).toInts(),
    );
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space", label: "Expand" });
    act(() => setDisabled(true));
    await act(async () => setup.flush());
    expect(trigger.focusable).toBe(false);
    expect(trigger.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable).not.toBe(trigger);
    expect(getControlHints(trigger)).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(ref.current).toBeNull();
  expect(rootRef.current).toBeNull();
});

test("accordion mouse activation uses completed clicks and preserves cancellation", async () => {
  const changes: (string | undefined)[] = [];
  const receivers: BoxRenderable[] = [];
  let cancelUp = false;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Accordion onValueChange={(value) => changes.push(value)}>
        <Item
          value="a"
          triggerProps={{
            onMouseDown: function () {
              receivers.push(this);
            },
            onMouseUp: function (event) {
              receivers.push(this);
              if (cancelUp) {
                event.preventDefault();
              }
            },
          }}
        />
      </Accordion>
    </ThemeProvider>,
    { width: 30, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger:a") as BoxRenderable;
    const x = trigger.screenX + 1;
    const y = trigger.screenY;
    await act(async () => setup.mockMouse.pressDown(x, y));
    expect(changes).toEqual([]);
    await act(async () => setup.mockMouse.release(x, y));
    await act(async () => setup.flush());
    expect(changes).toEqual(["a"]);
    expect(receivers).toEqual([trigger, trigger]);
    cancelUp = true;
    await act(async () => setup.mockMouse.click(x, y));
    cancelUp = false;
    await act(async () => setup.mockMouse.click(x, y, 2));
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(x, y + 6));
    await act(async () => setup.mockMouse.release(x, y + 6));
    expect(changes).toEqual(["a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("accordion header navigation follows rendered order and skips ineligible items", async () => {
  let update!: Dispatch<SetStateAction<string[]>>;
  function Fixture() {
    const [order, setOrder] = useState(["a", "b", "c"]);
    update = setOrder;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Accordion defaultValue="a">
          {order.map((value) => (
            <Item key={value} value={value} />
          ))}
          <Item value="hidden" visible={false} />
          <Item value="disabled" disabled />
        </Accordion>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 15, kittyKeyboard: true });
  async function press(key: string, expected: string) {
    act(() => setup.mockInput.pressKey(key));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(`trigger:${expected}`);
  }
  try {
    await act(async () => setup.flush());
    act(() => setup.renderer.root.findDescendantById("trigger:a")!.focus());
    await press("ARROW_DOWN", "b");
    await press("END", "c");
    await press("j", "a");
    act(() => update(["c", "a", "b"]));
    await act(async () => setup.flush());
    await press("HOME", "c");
    await press("ARROW_DOWN", "a");
    await press("ARROW_UP", "c");
    await press("k", "b");
    await press("g", "c");
    act(() => setup.mockInput.pressKey("g", { shift: true }));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger:b");
    act(() => update(["c", "a"]));
    await act(async () => setup.flush());
    act(() => setup.renderer.root.findDescendantById("trigger:a")!.focus());
    await press("END", "a");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const multiple of [false, true]) {
  test(`${multiple ? "multiple" : "single"} accordion preserves state and empty-string values`, async () => {
    const changes: (string | string[] | undefined)[] = [];
    const items = (
      <>
        <Item value="" />
        <Item value="b" />
      </>
    );
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        {multiple ? (
          <Accordion multiple defaultValue={[""]} onValueChange={(value) => changes.push(value)}>
            {items}
          </Accordion>
        ) : (
          <Accordion defaultValue="" onValueChange={(value) => changes.push(value)}>
            {items}
          </Accordion>
        )}
      </ThemeProvider>,
      { width: 30, height: 12 },
    );
    try {
      await act(async () => setup.flush());
      const first = setup.renderer.root.findDescendantById("content:")!;
      const second = setup.renderer.root.findDescendantById("content:b")!;
      expect(first.visible).toBe(true);
      act(() => setup.renderer.root.findDescendantById("trigger:b")!.focus());
      act(() => setup.mockInput.pressEnter());
      await act(async () => setup.flush());
      expect(first.visible).toBe(multiple);
      expect(second.visible).toBe(true);
      act(() => setup.mockInput.pressKey(" "));
      await act(async () => setup.flush());
      expect(second.visible).toBe(false);
      expect(changes).toEqual(multiple ? [["", "b"], [""]] : ["b", undefined]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("controlled accordion preserves empty ownership, child state, and read-only navigation", async () => {
  let update!: Dispatch<SetStateAction<{ value: string | undefined; writable: boolean }>>;
  const changes: (string | undefined)[] = [];
  function Fixture() {
    const [state, setState] = useState<{ value: string | undefined; writable: boolean }>({
      value: undefined,
      writable: true,
    });
    update = setState;
    return (
      <ThemeProvider theme={defaultTheme}>
        <FocusManager focusScopeId="scope" />
        <Stack id="scope" focusable>
          <Accordion
            value={state.value}
            defaultValue="b"
            onValueChange={state.writable ? (value) => changes.push(value) : undefined}
          >
            <Item value="a" />
            <Item value="b" />
          </Accordion>
        </Stack>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 12 });
  try {
    await act(async () => setup.flush());
    const content = setup.renderer.root.findDescendantById("content:a")!;
    const input = setup.renderer.root.findDescendantById("input:a") as InputRenderable;
    expect(content.visible).toBe(false);
    expect(setup.renderer.root.findDescendantById("content:b")!.visible).toBe(false);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(changes).toEqual(["a"]);
    expect(content.visible).toBe(false);
    act(() => update({ value: "a", writable: true }));
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressTab());
    act(() => setup.mockInput.pressKey("x"));
    act(() => update({ value: undefined, writable: false }));
    await act(async () => setup.flush());
    expect(input.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger:b");
    act(() => setup.mockInput.pressKey("HOME"));
    await act(async () => setup.flush());
    const trigger = setup.renderer.currentFocusedRenderable!;
    expect(getControlHints(trigger).length).toBeGreaterThan(0);
    expect(
      getControlHints(trigger).some(({ label }) => ["Expand", "Collapse"].includes(label)),
    ).toBe(false);
    act(() => setup.mockInput.pressEnter());
    expect(changes).toEqual(["a"]);
    act(() => setup.mockInput.pressKey("ARROW_DOWN"));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger:b");
    act(() => update({ value: "a", writable: true }));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("input:a")).toBe(input);
    expect(input.value).toBe("x");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const multiple of [false, true]) {
  test(`${multiple ? "multiple" : "single"} accordion applies buffered requests to the latest local state`, async () => {
    const changes: (string | string[] | undefined)[] = [];
    const items = (
      <>
        <Item value="a" triggerProps={{ focused: true }} />
        <Item value="b" />
      </>
    );
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        {multiple ? (
          <Accordion multiple onValueChange={(value) => changes.push(value)}>
            {items}
          </Accordion>
        ) : (
          <Accordion onValueChange={(value) => changes.push(value)}>{items}</Accordion>
        )}
      </ThemeProvider>,
      { width: 30, height: 12 },
    );
    try {
      await act(async () => setup.flush());
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\rj\r")));
      await act(async () => setup.flush());
      expect(setup.renderer.root.findDescendantById("content:a")!.visible).toBe(multiple);
      expect(setup.renderer.root.findDescendantById("content:b")!.visible).toBe(true);
      expect(changes).toEqual(multiple ? [["a"], ["a", "b"]] : ["a", "b"]);

      act(() => setup.renderer.stdin.emit("data", Buffer.from("hllhh\r\r")));
      await act(async () => setup.flush());
      expect(setup.renderer.root.findDescendantById("content:b")!.visible).toBe(false);
      expect(changes.slice(2)).toEqual(
        multiple
          ? [["a"], ["a", "b"], ["a"], ["a", "b"], ["a"]]
          : [undefined, "b", undefined, "b", undefined],
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("accordion ignores repeated toggles but accepts linefeed and repeated navigation", async () => {
  const changes: (string | undefined)[] = [];
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Accordion onValueChange={(value) => changes.push(value)}>
        <Item value="a" triggerProps={{ focused: true }} />
        <Item value="b" />
      </Accordion>
    </ThemeProvider>,
    { width: 30, height: 12 },
  );
  try {
    await act(async () => setup.flush());
    for (const [name, repeated] of [
      ["linefeed", false],
      ["return", true],
      ["down", true],
    ] as const) {
      act(() =>
        setup.renderer.keyInput.processParsedKey({
          name,
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
      expect(changes).toEqual(["a"]);
    }
    expect(changes).toEqual(["a"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger:b");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled multiple accordion waits for parent values and can become read-only", async () => {
  let setValues!: Dispatch<SetStateAction<string[]>>;
  let setWritable!: Dispatch<SetStateAction<boolean>>;
  const changes: string[][] = [];
  function Fixture() {
    const [values, updateValues] = useState<string[]>([]);
    const [writable, updateWritable] = useState(true);
    setValues = updateValues;
    setWritable = updateWritable;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Accordion
          multiple
          value={values}
          defaultValue={["b"]}
          onValueChange={writable ? (value) => changes.push(value) : undefined}
        >
          <Item value="a" triggerProps={{ focused: true }} />
          <Item value="b" />
        </Accordion>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 12 });
  try {
    await act(async () => setup.flush());
    const first = setup.renderer.root.findDescendantById("content:a")!;
    const second = setup.renderer.root.findDescendantById("content:b")!;
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(changes).toEqual([["a"]]);
    expect(first.visible).toBe(false);
    act(() => setValues(["a", "b"]));
    act(() => setWritable(false));
    await act(async () => setup.flush());
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    const hints = getControlHints(setup.renderer.currentFocusedRenderable);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(({ label }) => ["Expand", "Collapse"].includes(label))).toBe(false);
    act(() => setup.mockInput.pressEnter());
    expect(changes).toEqual([["a"]]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("accordion mouse gestures distinguish header bounds from child hit targets", async () => {
  const changes: (string | undefined)[] = [];
  let cancelDown = false;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Accordion onValueChange={(value) => changes.push(value)}>
        <AccordionItem value="a">
          <AccordionTrigger
            id="trigger"
            onMouseDown={(event) => {
              if (cancelDown) {
                event.preventDefault();
              }
            }}
          >
            Label
          </AccordionTrigger>
        </AccordionItem>
      </Accordion>
    </ThemeProvider>,
    { width: 30, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    const label = trigger.getChildren()[1]!;
    const x = label.screenX;
    const y = label.screenY;
    const paddingX = trigger.screenX + trigger.width - 2;
    const outsideY = trigger.screenY + trigger.height + 3;

    // Native text selection can swallow the first gesture's mouse-out/up.
    await act(async () => setup.mockMouse.moveTo(x, y));
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(paddingX, outsideY));
    await act(async () => setup.mockMouse.release(paddingX, outsideY));
    cancelDown = true;
    await act(async () => setup.mockMouse.click(paddingX, y));
    await act(async () => setup.flush());
    expect(changes).toEqual([]);

    cancelDown = false;
    // A captured child can bubble mouse-up from outside without mouse-out.
    await act(async () => setup.mockMouse.moveTo(paddingX, y));
    await act(async () => setup.mockMouse.pressDown(paddingX, y));
    await act(async () => setup.mockMouse.moveTo(x, y));
    await act(async () => setup.mockMouse.moveTo(paddingX, outsideY));
    await act(async () => setup.mockMouse.release(paddingX, outsideY));
    await act(async () => setup.flush());
    expect(changes).toEqual([]);

    await act(async () => setup.mockMouse.moveTo(paddingX, y));
    await act(async () => setup.mockMouse.pressDown(paddingX, y));
    await act(async () => setup.mockMouse.moveTo(x, y));
    await act(async () => setup.mockMouse.release(x, y));
    await act(async () => setup.flush());
    expect(changes).toEqual(["a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

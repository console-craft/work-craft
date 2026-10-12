import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  CliRenderEvents,
  type KeyEvent,
  parseColor,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import {
  act,
  createRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from "react";

import { List, ListItem, type ListProps } from "@/ui/components/list";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { FocusManager } from "@/ui/focus-manager";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box";
import { HStack } from "@/ui/primitives/hstack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

function Fixture({ children, ...props }: ListProps) {
  return (
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page" width={40} height={20}>
        <Button id="before">Before</Button>
        <List id="list" height={6} {...props}>
          {children ?? (
            <>
              <ListItem id="a" value="a">
                Alpha
              </ListItem>
              <ListItem id="disabled" value="disabled" disabled>
                Disabled
              </ListItem>
              <Box visible={false}>
                <ListItem value="hidden">Hidden</ListItem>
              </Box>
              <ListItem id="b" value="b">
                Beta
              </ListItem>
              <ListItem id="c" value="c">
                Gamma
              </ListItem>
            </>
          )}
        </List>
        <Button id="after">After</Button>
      </Box>
    </ThemeProvider>
  );
}

async function renderList(children: ReactNode) {
  const setup = await act(async () =>
    testRender(children, { width: 40, height: 20, kittyKeyboard: true, exitOnCtrlC: false }),
  );
  await act(async () => setup.flush());
  return setup;
}

function background(node: BoxRenderable, token: keyof typeof defaultTheme.colors): void {
  expect(node.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors[token]).toInts());
}

test("disabled List skips focus and activation, adopts Select colors, and still scrolls", async () => {
  const events: string[] = [];
  const setup = await renderList(
    <Fixture
      disabled
      focused
      defaultValue="2"
      defaultActiveValue="4"
      bg="error"
      onActiveValueChange={(value) => events.push(`active:${value}`)}
      onValueChange={(value) => events.push(`selected:${value}`)}
      onActivate={(value) => events.push(`open:${value}`)}
    >
      {Array.from({ length: 12 }, (_, index) => (
        <ListItem
          key={index}
          id={`row-${index}`}
          value={String(index)}
          bg="error"
        >{`Row ${index}`}</ListItem>
      ))}
    </Fixture>,
  );
  try {
    const list = setup.renderer.root.findDescendantById("list") as BoxRenderable;
    const area = list.getChildren()[0] as ScrollBoxRenderable;
    const row = setup.renderer.root.findDescendantById("row-2") as BoxRenderable;
    expect(
      getFocusableRenderables(setup.renderer.root.findDescendantById("page")!).map(
        (node) => node.id,
      ),
    ).toEqual(["before", "after"]);
    expect(list.focusable).toBe(false);
    expect(getControlHints(list)).toEqual([]);
    background(list, "error");
    background(row, "secondary");
    background(setup.renderer.root.findDescendantById("row-4") as BoxRenderable, "error");
    expect((row.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    act(() => list.focus());
    expect(setup.renderer.currentFocusedRenderable).not.toBe(list);
    await act(async () => setup.mockMouse.click(row.screenX + 1, row.screenY));
    expect(setup.renderer.currentFocusedRenderable).not.toBe(list);
    act(() => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      setup.mockInput.pressTab();
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY + 1, "down"),
    );
    await act(async () => setup.flush());
    expect(area.scrollTop).toBeGreaterThan(0);
    const position = area.scrollTop;
    await act(async () => setup.renderOnce());
    expect(area.scrollTop).toBe(position);
    expect(events).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disabling a focused List releases focus, cancels pending presses, and preserves both values", async () => {
  const events: string[] = [];
  let toggle!: Dispatch<SetStateAction<boolean>>;
  function DisableFixture() {
    const [disabled, setDisabled] = useState(false);
    toggle = setDisabled;
    return (
      <Fixture
        disabled={disabled}
        defaultValue="b"
        defaultActiveValue="c"
        onActiveValueChange={(value) => events.push(`active:${value}`)}
        onValueChange={(value) => events.push(`selected:${value}`)}
        onActivate={(value) => events.push(`open:${value}`)}
      />
    );
  }
  const setup = await renderList(<DisableFixture />);
  try {
    const list = setup.renderer.root.findDescendantById("list") as BoxRenderable;
    const row = setup.renderer.root.findDescendantById("a")!;
    act(() => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockMouse.pressDown(row.screenX + 1, row.screenY));
    await act(async () => toggle(true));
    await act(async () => setup.flush());
    expect(list.focusable).toBe(false);
    expect(list.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable).not.toBe(list);
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "secondary");
    expect(list.backgroundColor.toInts()).toEqual([0, 0, 0, 0]);
    expect(
      (setup.renderer.root.findDescendantById("c") as BoxRenderable).backgroundColor.toInts(),
    ).toEqual([0, 0, 0, 0]);
    await act(async () => toggle(false));
    await act(async () => setup.mockMouse.release(row.screenX + 1, row.screenY));
    expect(events).toEqual([]);
    act(() => list.focus());
    await act(async () => setup.flush());
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "primary");
    background(setup.renderer.root.findDescendantById("c") as BoxRenderable, "focus");
    act(() => setup.mockInput.pressEnter());
    expect(events).toEqual(["selected:c", "open:c"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const controlled of [false, true]) {
  test(`disabled List defers cursor repair until re-enabled (controlled=${controlled})`, async () => {
    const active: (string | undefined)[] = [];
    const selected: string[] = [];
    let update!: Dispatch<SetStateAction<{ disabled: boolean; values: string[] }>>;
    function RepairFixture() {
      const [rows, setRows] = useState({ disabled: true, values: ["a", "b", "c"] });
      update = setRows;
      return (
        <Fixture
          disabled={rows.disabled}
          defaultValue="a"
          {...(controlled ? { activeValue: "b" } : { defaultActiveValue: "b" })}
          onActiveValueChange={(value) => active.push(value)}
          onValueChange={(value) => selected.push(value)}
        >
          {rows.values.map((value) => (
            <ListItem key={value} value={value}>
              {value}
            </ListItem>
          ))}
        </Fixture>
      );
    }
    const setup = await renderList(<RepairFixture />);
    try {
      await act(async () => update({ disabled: true, values: ["a", "c"] }));
      await act(async () => setup.flush());
      expect(active).toEqual([]);
      expect(selected).toEqual([]);
      await act(async () => update({ disabled: false, values: ["a", "c"] }));
      await act(async () => setup.flush());
      expect(active).toEqual(["a"]);
      await act(async () => setup.renderOnce());
      expect(active).toEqual(["a"]);
      expect(selected).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const { props, expected } of [
  { props: {}, expected: "a" },
  { props: { defaultValue: "b" }, expected: "b" },
  { props: { defaultValue: "b", defaultActiveValue: "c" }, expected: "c" },
  { props: { defaultValue: "disabled", defaultActiveValue: "hidden" }, expected: "a" },
]) {
  test(`List initializes its cursor on focus (${JSON.stringify(props)})`, async () => {
    const active: (string | undefined)[] = [];
    const setup = await renderList(
      <Fixture {...props} onActiveValueChange={(value) => active.push(value)} />,
    );
    try {
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("before");
      if (props.defaultActiveValue === undefined) {
        expect(active).toEqual([]);
      }
      act(() => setup.mockInput.pressTab());
      await act(async () => setup.flush());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
      background(setup.renderer.root.findDescendantById(expected) as BoxRenderable, "focus");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("List separates cursor movement from selection and always activates deliberate Enter presses", async () => {
  const selected: string[] = [];
  const active: (string | undefined)[] = [];
  const opened: string[] = [];
  const setup = await renderList(
    <Fixture
      defaultValue="a"
      onValueChange={(value) => selected.push(value)}
      onActiveValueChange={(value) => active.push(value)}
      onActivate={(value) => opened.push(value)}
    />,
  );
  try {
    act(() => {
      setup.mockInput.pressTab();
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      setup.mockInput.pressEnter();
    });
    expect(active).toEqual(["a", "b"]);
    expect(selected).toEqual(["b"]);
    expect(opened).toEqual(["b", "b"]);
    await act(async () => setup.flush());
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "focus");
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "primary");
    expect(active).toEqual(["a", "b"]);
    act(() => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.flush());
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "focus");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List is one native Tab stop with refs, concise hints, and disabled semantic colors", async () => {
  const listRef = createRef<BoxRenderable>();
  const rowRef = createRef<BoxRenderable>();
  const setup = await renderList(
    <Fixture ref={listRef} defaultValue="b">
      <ListItem ref={rowRef} value="a">
        Alpha
      </ListItem>
      <ListItem id="b" value="b">
        Beta
      </ListItem>
      <ListItem id="disabled" value="disabled" disabled>
        Disabled
      </ListItem>
    </Fixture>,
  );
  try {
    expect(
      getFocusableRenderables(setup.renderer.root.findDescendantById("page")!).map(
        (node) => node.id,
      ),
    ).toEqual(["before", "list", "after"]);
    expect(rowRef.current?.focusable).toBe(false);
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "primary");
    const disabled = setup.renderer.root.findDescendantById("disabled") as BoxRenderable;
    expect(disabled.backgroundColor.toInts()).toEqual([0, 0, 0, 0]);
    expect((disabled.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.mutedForeground).toInts(),
    );
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable).toBe(listRef.current);
    const selected = setup.renderer.root.findDescendantById("b") as BoxRenderable;
    expect((selected.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    expect(getControlHints(listRef.current)).toContainEqual({ keys: "Enter", label: "Open" });
    expect(getControlHints(listRef.current)).toContainEqual({
      keys: "Ctrl+d/u",
      label: "Half-page",
    });
    expect(setup.captureCharFrame()).not.toContain(">");
  } finally {
    act(() => setup.renderer.destroy());
  }
  expect(listRef.current).toBeNull();
  expect(rowRef.current).toBeNull();
});

test("List wraps single-step navigation, skips ineligible rows, and handles edge aliases", async () => {
  const active: (string | undefined)[] = [];
  const setup = await renderList(<Fixture onActiveValueChange={(value) => active.push(value)} />);
  try {
    act(() => setup.mockInput.pressTab());
    for (const { key, modifiers, expected } of [
      { key: "ARROW_UP", expected: "c" },
      { key: "j", expected: "a" },
      { key: "ARROW_DOWN", expected: "b" },
      { key: "n", modifiers: { ctrl: true }, expected: "c" },
      { key: "p", modifiers: { ctrl: true }, expected: "b" },
      { key: "k", expected: "a" },
      { key: "END", expected: "c" },
      { key: "HOME", expected: "a" },
      { key: "g", modifiers: { shift: true }, expected: "c" },
      { key: "g", expected: "a" },
    ]) {
      act(() => setup.mockInput.pressKey(key, modifiers));
      expect(active.at(-1)).toBe(expected);
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List paging uses viewport cells, clamps, and reveals offscreen rows", async () => {
  const active: (string | undefined)[] = [];
  const setup = await renderList(
    <Fixture height={8} border onActiveValueChange={(value) => active.push(value)}>
      {Array.from({ length: 12 }, (_, index) => (
        <ListItem
          key={index}
          id={`row-${index}`}
          value={String(index)}
          height={2}
        >{`Row ${index}`}</ListItem>
      ))}
    </Fixture>,
  );
  function pressKey(key: string, ctrl = false) {
    // MockKeys has no PageUp/PageDown constants; dispatch their parsed native events.
    if (key === "PAGEUP" || key === "PAGEDOWN") {
      setup.renderer.keyInput.processParsedKey({
        name: key.toLowerCase(),
        ctrl,
        shift: false,
        meta: false,
        option: false,
        repeated: false,
        sequence: "",
        raw: "",
        number: false,
        eventType: "press",
        source: "kitty",
      });
    } else {
      setup.mockInput.pressKey(key, { ctrl });
    }
  }
  try {
    const list = setup.renderer.root.findDescendantById("list")!;
    const area = list.getChildren()[0] as ScrollBoxRenderable;
    expect(area.viewport.height).toBe(6);
    act(() => setup.mockInput.pressTab());
    for (const { key, ctrl, expected } of [
      { key: "d", ctrl: true, expected: "2" },
      { key: "f", ctrl: true, expected: "3" },
      { key: "PAGEDOWN", expected: "3" },
    ]) {
      act(() => {
        setup.mockInput.pressKey("HOME");
        pressKey(key, ctrl);
      });
      await act(async () => setup.flush());
      expect(active.at(-1)).toBe(expected);
      const row = setup.renderer.root.findDescendantById(`row-${expected}`)!;
      expect(row.screenY).toBeGreaterThanOrEqual(area.viewport.screenY);
      expect(row.screenY + row.height).toBeLessThanOrEqual(
        area.viewport.screenY + area.viewport.height,
      );
    }
    for (const { key, ctrl, expected } of [
      { key: "u", ctrl: true, expected: "9" },
      { key: "b", ctrl: true, expected: "8" },
      { key: "PAGEUP", expected: "8" },
    ]) {
      act(() => {
        setup.mockInput.pressKey("END");
        pressKey(key, ctrl);
      });
      expect(active.at(-1)).toBe(expected);
    }
    act(() => {
      setup.mockInput.pressKey("HOME");
      pressKey("PAGEUP");
    });
    expect(active.at(-1)).toBe("0");
    act(() => {
      setup.mockInput.pressKey("END");
      pressKey("PAGEDOWN");
    });
    expect(active.at(-1)).toBe("11");
    await act(async () => setup.flush());
    expect(area.scrollTop).toBeGreaterThan(0);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY + 1, "up"),
    );
    await act(async () => setup.flush());
    const manualPosition = area.scrollTop;
    await act(async () => setup.renderOnce());
    expect(area.scrollTop).toBe(manualPosition);
    expect(active.at(-1)).toBe("11");
    act(() => setup.mockInput.pressKey("k"));
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("row-10")!;
    expect(row.screenY + row.height).toBeLessThanOrEqual(
      area.viewport.screenY + area.viewport.height,
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List paging measures variable-height rows and skips disabled targets", async () => {
  const active: (string | undefined)[] = [];
  const setup = await renderList(
    <Fixture onActiveValueChange={(value) => active.push(value)}>
      <ListItem value="a" height={1}>
        A
      </ListItem>
      <ListItem value="disabled" height={2} disabled>
        Disabled
      </ListItem>
      <ListItem value="b" height={3}>
        B
      </ListItem>
      <ListItem value="c" height={2}>
        C
      </ListItem>
      <ListItem value="d" height={4}>
        D
      </ListItem>
    </Fixture>,
  );
  try {
    act(() => {
      setup.mockInput.pressTab();
      setup.mockInput.pressKey("d", { ctrl: true });
    });
    expect(active.at(-1)).toBe("b");
    act(() => {
      setup.mockInput.pressKey("HOME");
      setup.mockInput.pressKey("f", { ctrl: true });
    });
    expect(active.at(-1)).toBe("c");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List repairs removal, disabling and native ancestor visibility without changing selection", async () => {
  const active: (string | undefined)[] = [];
  const selected: string[] = [];
  let update!: Dispatch<SetStateAction<{ values: string[]; disabled: string | undefined }>>;
  function DynamicFixture() {
    const [rows, setRows] = useState({
      values: ["a", "b", "c"],
      disabled: undefined as string | undefined,
    });
    update = setRows;
    return (
      <Fixture
        defaultValue="a"
        defaultActiveValue="b"
        onActiveValueChange={(value) => active.push(value)}
        onValueChange={(value) => selected.push(value)}
      >
        {rows.values.map((value) => (
          <Box key={value} id={`ancestor-${value}`}>
            <ListItem id={value} value={value} disabled={value === rows.disabled}>
              {value}
            </ListItem>
          </Box>
        ))}
      </Fixture>
    );
  }
  const setup = await renderList(<DynamicFixture />);
  try {
    act(() => setup.mockInput.pressTab());
    await act(async () => update({ values: ["a", "c"], disabled: undefined }));
    expect(active).toEqual(["a"]);
    await act(async () => update({ values: ["a", "c"], disabled: "a" }));
    expect(active).toEqual(["a", "c"]);
    act(() => {
      setup.renderer.root.findDescendantById("ancestor-c")!.visible = false;
    });
    await act(async () => setup.flush());
    expect(active).toEqual(["a", "c", undefined]);
    expect(selected).toEqual([]);
    await act(async () => update({ values: ["new"], disabled: undefined }));
    expect(active.at(-1)).toBe("new");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List navigates current rendered order after keyed insertion and reordering", async () => {
  const active: (string | undefined)[] = [];
  let reorder!: Dispatch<SetStateAction<string[]>>;
  function OrderFixture() {
    const [order, setOrder] = useState(["a", "b", "c"]);
    reorder = setOrder;
    return (
      <Fixture defaultActiveValue="b" onActiveValueChange={(value) => active.push(value)}>
        {order.map((value) => (
          <ListItem key={value} value={value}>
            {value}
          </ListItem>
        ))}
      </Fixture>
    );
  }
  const setup = await renderList(<OrderFixture />);
  try {
    act(() => setup.mockInput.pressTab());
    await act(async () => reorder(["c", "b", "new", "a"]));
    act(() => setup.mockInput.pressKey("j"));
    expect(active).toEqual(["new"]);
    act(() => setup.mockInput.pressKey("g"));
    expect(active.at(-1)).toBe("c");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List controlled empty state stays parent-owned and repair requests do not flood frames", async () => {
  const activeRequests: (string | undefined)[] = [];
  const valueRequests: string[] = [];
  const opened: string[] = [];
  let update!: Dispatch<SetStateAction<string | undefined>>;
  let allow!: Dispatch<SetStateAction<boolean>>;
  let remove!: Dispatch<SetStateAction<boolean>>;
  function ControlledFixture() {
    const [active, setActive] = useState<string>();
    const [editable, setEditable] = useState(false);
    const [empty, setEmpty] = useState(false);
    update = setActive;
    allow = setEditable;
    remove = setEmpty;
    return (
      <Fixture
        value={undefined}
        defaultValue="a"
        activeValue={active}
        onActiveValueChange={editable ? (value) => activeRequests.push(value) : undefined}
        onValueChange={(value) => valueRequests.push(value)}
        onActivate={(value) => opened.push(value)}
      >
        {empty ? null : (
          <>
            <ListItem id="a" value="a">
              A
            </ListItem>
            <ListItem id="b" value="b">
              B
            </ListItem>
            <ListItem id="c" value="c">
              C
            </ListItem>
          </>
        )}
      </Fixture>
    );
  }
  const setup = await renderList(<ControlledFixture />);
  try {
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(getControlHints(setup.renderer.currentFocusedRenderable)).toEqual([]);
    await act(async () => allow(true));
    await act(async () => setup.flush());
    expect(activeRequests).toEqual(["a"]);
    for (let frame = 0; frame < 3; frame++) {
      await act(async () => setup.renderOnce());
    }
    expect(activeRequests).toEqual(["a"]);
    act(() => setup.mockInput.pressEnter());
    expect(opened).toEqual([]);
    await act(async () => update("b"));
    act(() => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
    });
    expect(activeRequests).toEqual(["a", "c"]);
    expect(valueRequests).toEqual(["b"]);
    expect(opened).toEqual(["b"]);
    background(setup.renderer.root.findDescendantById("b") as BoxRenderable, "focus");
    await act(async () => allow(false));
    act(() => setup.mockInput.pressKey("k"));
    expect(activeRequests).toEqual(["a", "c"]);
    await act(async () => allow(true));
    await act(async () => remove(true));
    await act(async () => setup.flush());
    expect(activeRequests).toEqual(["a", "c", undefined]);
    await act(async () => setup.renderOnce());
    expect(activeRequests).toEqual(["a", "c", undefined]);
    expect(valueRequests).toEqual(["b"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List respects cancelled keys and leaves unrelated chords and Space unconsumed", async () => {
  const keys: KeyEvent[] = [];
  const opened: string[] = [];
  let cancel = false;
  const setup = await renderList(
    <Fixture
      defaultActiveValue="a"
      onActivate={(value) => opened.push(value)}
      onKeyDown={(key) => {
        keys.push(key);
        if (cancel) {
          key.stopPropagation();
        }
      }}
    />,
  );
  try {
    act(() => setup.mockInput.pressTab());
    for (const {
      name,
      ctrl = false,
      shift = false,
      meta = false,
      super: superKey = false,
      hyper = false,
      option = false,
      repeated = false,
    } of [
      { name: "space" },
      { name: "h" },
      { name: "left" },
      { name: "j", ctrl: true },
      { name: "j", shift: true },
      { name: "g", meta: true },
      { name: "down", super: true },
      { name: "up", hyper: true },
      { name: "n", ctrl: true, shift: true },
      { name: "j", option: true },
      { name: "return", repeated: true },
    ]) {
      act(() =>
        setup.renderer.keyInput.processParsedKey({
          name,
          ctrl,
          shift,
          meta,
          super: superKey,
          hyper,
          option,
          repeated,
          sequence: "",
          raw: "",
          number: false,
          eventType: repeated ? "repeat" : "press",
          source: "kitty",
        }),
      );
      expect(keys.at(-1)?.defaultPrevented).toBe(name === "return");
    }
    expect(opened).toEqual([]);
    cancel = true;
    act(() => setup.mockInput.pressEnter());
    expect(opened).toEqual([]);
    cancel = false;
    act(() => setup.mockInput.pressKey("LINEFEED"));
    expect(opened).toEqual(["a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List click activates on matching primary release, ignores hover, and preserves caller focus transfer", async () => {
  const events: string[] = [];
  let cancel = false;
  const setup = await renderList(
    <Fixture
      defaultValue="a"
      defaultActiveValue="a"
      onActiveValueChange={(value) => events.push(`active:${value}`)}
      onValueChange={(value) => events.push(`selected:${value}`)}
      onActivate={(value) => {
        events.push(`open:${value}`);
        setup.renderer.root.findDescendantById("after")!.focus();
      }}
    >
      <ListItem id="a" value="a">
        A
      </ListItem>
      <ListItem
        id="b"
        value="b"
        onMouseUp={(event) => {
          if (cancel) {
            event.preventDefault();
          }
        }}
      >
        <HStack width="100%">
          <Text id="title" fg="success">
            Title
          </Text>
          <Text id="detail" variant="muted">
            Detail
          </Text>
        </HStack>
      </ListItem>
      <ListItem id="disabled" value="disabled" disabled>
        Disabled
      </ListItem>
    </Fixture>,
  );
  try {
    const row = setup.renderer.root.findDescendantById("b")!;
    const title = setup.renderer.root.findDescendantById("title") as TextRenderable;
    const detail = setup.renderer.root.findDescendantById("detail")!;
    const x = row.screenX + row.width - 1;
    const y = row.screenY;
    await act(async () => setup.mockMouse.moveTo(title.screenX, y));
    expect(events).toEqual([]);
    await act(async () => setup.mockMouse.pressDown(x, y));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("list");
    expect(events).toEqual([]);
    await act(async () => setup.mockMouse.moveTo(detail.screenX, y));
    await act(async () => setup.mockMouse.release(title.screenX, y));
    expect(events).toEqual(["active:b", "selected:b", "open:b"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    expect(title.fg.toInts()).toEqual(parseColor(defaultTheme.colors.success).toInts());
    await act(async () => setup.mockMouse.click(title.screenX, y));
    expect(events).toEqual(["active:b", "selected:b", "open:b", "open:b"]);
    cancel = true;
    await act(async () => setup.mockMouse.click(title.screenX, y));
    expect(events.at(-1)).toBe("open:b");
    expect(events.filter((event) => event === "open:b")).toHaveLength(2);
    const disabled = setup.renderer.root.findDescendantById("disabled")!;
    await act(async () => setup.mockMouse.click(disabled.screenX + 1, disabled.screenY));
    expect(events.filter((event) => event.startsWith("open:"))).toHaveLength(2);
    cancel = false;
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(x, y + 1));
    await act(async () => setup.mockMouse.release(x, y));
    expect(events.filter((event) => event.startsWith("open:"))).toHaveLength(2);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List reveals controlled cursor changes and releases renderer listeners on unmount", async () => {
  let update!: Dispatch<SetStateAction<string>>;
  let remove!: Dispatch<SetStateAction<boolean>>;
  function RevealFixture() {
    const [active, setActive] = useState("0");
    const [present, setPresent] = useState(false);
    update = setActive;
    remove = setPresent;
    return (
      <ThemeProvider theme={defaultTheme}>
        {present ? (
          <List id="list" height={6} activeValue={active}>
            {Array.from({ length: 12 }, (_, index) => (
              <ListItem key={index} id={`row-${index}`} value={String(index)}>
                {index}
              </ListItem>
            ))}
          </List>
        ) : null}
      </ThemeProvider>
    );
  }
  const setup = await renderList(<RevealFixture />);
  try {
    const baseline = setup.renderer.listenerCount(CliRenderEvents.FRAME);
    await act(async () => remove(true));
    await act(async () => setup.flush());
    await act(async () => update("11"));
    await act(async () => setup.flush());
    const area = setup.renderer.root
      .findDescendantById("list")!
      .getChildren()[0] as ScrollBoxRenderable;
    const row = setup.renderer.root.findDescendantById("row-11")!;
    expect(row.screenY + row.height).toBeLessThanOrEqual(
      area.viewport.screenY + area.viewport.height,
    );
    expect(area.scrollTop).toBeGreaterThan(0);
    act(() => update("0"));
    await act(async () => remove(false));
    expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(baseline);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List reveals rows exactly as tall as the viewport", async () => {
  const setup = await renderList(
    <Fixture>
      <ListItem value="a" height={6}>
        A
      </ListItem>
      <ListItem id="b" value="b" height={6}>
        B
      </ListItem>
      <ListItem value="c" height={6}>
        C
      </ListItem>
    </Fixture>,
  );
  try {
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("j"));
    await act(async () => setup.flush());
    const area = setup.renderer.root
      .findDescendantById("list")!
      .getChildren()[0] as ScrollBoxRenderable;
    expect(area.scrollTop).toBe(6);
    expect(setup.renderer.root.findDescendantById("b")!.screenY).toBe(area.viewport.screenY);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List focus-entry reveal does not move a pressed row before release", async () => {
  const opened: string[] = [];
  const setup = await renderList(
    <Fixture defaultValue="0" defaultActiveValue="0" onActivate={(value) => opened.push(value)}>
      {Array.from({ length: 12 }, (_, index) => (
        <ListItem key={index} id={`row-${index}`} value={String(index)}>
          {index}
        </ListItem>
      ))}
    </Fixture>,
  );
  try {
    const area = setup.renderer.root
      .findDescendantById("list")!
      .getChildren()[0] as ScrollBoxRenderable;
    act(() => area.scrollTo(6));
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("row-7")!;
    const x = row.screenX + 1;
    const y = row.screenY;
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(6);
    await act(async () => setup.mockMouse.release(x, y));
    expect(opened).toEqual(["7"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List recovers reveal when an outside release is delivered to another target", async () => {
  const opened: string[] = [];
  const setup = await renderList(
    <Fixture defaultActiveValue="0" onActivate={(value) => opened.push(value)}>
      {Array.from({ length: 12 }, (_, index) => (
        <ListItem key={index} value={String(index)}>
          {index}
        </ListItem>
      ))}
    </Fixture>,
  );
  try {
    const area = setup.renderer.root
      .findDescendantById("list")!
      .getChildren()[0] as ScrollBoxRenderable;
    const x = area.viewport.screenX + 1;
    const y = area.viewport.screenY;
    const outside = area.viewport.screenY + area.viewport.height + 1;
    await act(async () => {
      await setup.mockMouse.pressDown(x, y);
      await setup.mockMouse.moveTo(x + 1, outside);
      await setup.mockMouse.release(x + 1, outside);
      setup.mockInput.pressKey("END");
    });
    await act(async () => setup.flush());
    expect(opened).toEqual([]);
    expect(area.scrollTop).toBe(6);
    act(() => area.scrollTo(0));
    await act(async () => setup.flush());
    await act(async () => setup.mockMouse.release(x, y));
    expect(opened).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const batched of [false, true]) {
  test(`List rejects two unmatched gestures without a frame (single input chunk=${batched})`, async () => {
    const opened: string[] = [];
    const setup = await renderList(
      <Fixture defaultActiveValue="a" onActivate={(value) => opened.push(value)} />,
    );
    try {
      const row = setup.renderer.root.findDescendantById("a")!;
      const x = row.screenX + 1;
      const y = row.screenY;
      const outside = setup.renderer.root.findDescendantById("after")!.screenY;
      await act(async () => {
        if (batched) {
          const report = (button: number, py: number, release = false) =>
            `\x1b[<${button};${x + 1};${py + 1}${release ? "m" : "M"}`;
          setup.renderer.stdin.emit(
            "data",
            Buffer.from(
              [
                report(0, y),
                report(32, outside),
                report(0, outside, true),
                report(0, outside),
                report(32, y),
                report(0, y, true),
              ].join(""),
            ),
          );
        } else {
          await setup.mockMouse.pressDown(x, y);
          await setup.mockMouse.moveTo(x, outside);
          await setup.mockMouse.release(x, outside);
          await setup.mockMouse.pressDown(x, outside);
          await setup.mockMouse.moveTo(x, y);
          await setup.mockMouse.release(x, y);
        }
      });
      expect(opened).toEqual([]);
      await act(async () => setup.mockMouse.click(x, y));
      expect(opened).toEqual(["a"]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("List cancels captured drag/releases outside the clipping viewport", async () => {
  const opened: string[] = [];
  const setup = await renderList(
    <Fixture onActivate={(value) => opened.push(value)}>
      <ListItem value="a" height={12}>
        Oversized
      </ListItem>
    </Fixture>,
  );
  try {
    const area = setup.renderer.root
      .findDescendantById("list")!
      .getChildren()[0] as ScrollBoxRenderable;
    const x = area.viewport.screenX + 10;
    const y = area.viewport.screenY + 2;
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(x + 1, y));
    const outside = area.viewport.screenY + area.viewport.height + 1;
    await act(async () => setup.mockMouse.moveTo(x + 1, outside));
    await act(async () => setup.mockMouse.release(x + 1, outside));
    expect(opened).toEqual([]);
    await act(async () => setup.mockMouse.click(x, y));
    expect(opened).toEqual(["a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("List revalidates activation when callbacks hide or destroy the target", async () => {
  for (const invalidation of ["active", "selection"] as const) {
    const events: string[] = [];
    const setup = await renderList(
      <Fixture
        defaultValue="a"
        defaultActiveValue="a"
        onActiveValueChange={(value) => {
          events.push(`active:${value}`);
          if (value === "b" && invalidation === "active") {
            setup.renderer.root.findDescendantById("b")!.visible = false;
          }
        }}
        onValueChange={(value) => {
          events.push(`selected:${value}`);
          if (invalidation === "selection") {
            setup.renderer.root.findDescendantById("b")!.destroy();
          }
        }}
        onActivate={(value) => events.push(`open:${value}`)}
      />,
    );
    try {
      const row = setup.renderer.root.findDescendantById("b")!;
      await act(async () => setup.mockMouse.click(row.screenX + 1, row.screenY));
      expect(events).not.toContain("open:b");
      if (invalidation === "active") {
        expect(events).not.toContain("selected:b");
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  }
});

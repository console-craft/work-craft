import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  type InputRenderable,
  RGBA,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandProps,
} from "@/ui/components/command";
import { Button } from "@/ui/controls/button";
import { getControlHints } from "@/ui/interaction/control-hints";
import { FocusManager } from "@/ui/interaction/focus-manager";
import { getFocusableRenderables } from "@/ui/interaction/focus-utils";
import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

function Fixture({ children, ...props }: CommandProps) {
  return (
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page" width={50} height={20}>
        <Command id="command" {...props}>
          <CommandInput id="query" placeholder="Search" />
          <CommandList id="list" height={5}>
            <CommandEmpty id="empty">No matches</CommandEmpty>
            {children}
          </CommandList>
        </Command>
        <Button id="after">After</Button>
      </Box>
    </ThemeProvider>
  );
}

async function renderCommand(children: ReactNode) {
  const setup = await act(async () =>
    testRender(children, { width: 50, height: 20, kittyKeyboard: true, exitOnCtrlC: false }),
  );
  await act(async () => setup.flush());
  return setup;
}

function highlighted(node: BoxRenderable): boolean {
  return node.backgroundColor.equals(RGBA.fromHex(defaultTheme.colors.focus));
}

for (const direction of ["down", "up"] as const) {
  test(`Command direction=${direction} positions the input and reveals its initial enabled edge item`, async () => {
    const selections: number[] = [];
    const setup = await renderCommand(
      <Fixture {...(direction === "up" ? { direction } : {})}>
        <CommandItem disabled>Disabled first</CommandItem>
        <Box visible={false}>
          <CommandItem>Hidden</CommandItem>
        </Box>
        <CommandGroup heading="Actions">
          {Array.from({ length: 10 }, (_, index) => (
            <CommandItem key={index} id={`item-${index}`} onSelect={() => selections.push(index)}>
              {`Action ${index}`}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandItem disabled>Disabled last</CommandItem>
      </Fixture>,
    );
    try {
      await act(async () => setup.flush());
      const query = setup.renderer.root.findDescendantById("query")!;
      const list = setup.renderer.root.findDescendantById("list") as ScrollBoxRenderable;
      const edge = setup.renderer.root.findDescendantById(
        direction === "up" ? "item-9" : "item-0",
      ) as BoxRenderable;
      expect(direction === "up" ? query.screenY > list.screenY : query.screenY < list.screenY).toBe(
        true,
      );
      expect(highlighted(edge)).toBe(true);
      expect(edge.screenY).toBeGreaterThanOrEqual(list.viewport.screenY);
      expect(edge.screenY + edge.height).toBeLessThanOrEqual(
        list.viewport.screenY + list.viewport.height,
      );
      expect(
        getFocusableRenderables(setup.renderer.root.findDescendantById("page")!).map(
          (node) => node.id,
        ),
      ).toEqual(["query", "after"]);

      act(() => setup.mockInput.pressEnter());
      expect(selections).toEqual(direction === "up" ? [9] : [0]);
      act(() => {
        setup.mockInput.pressArrow(direction === "up" ? "up" : "down");
        setup.mockInput.pressEnter();
      });
      expect(selections).toEqual(direction === "up" ? [9, 8] : [0, 1]);
      act(() => {
        setup.mockInput.pressKey(direction === "up" ? "u" : "d", { ctrl: true });
        setup.mockInput.pressEnter();
      });
      expect(selections.at(-1)).toBe(direction === "up" ? 5 : 4);
      act(() => setup.mockInput.pressTab());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    } finally {
      await act(async () => setup.flush());
      act(() => setup.renderer.destroy());
    }
  });
}

test("Command filters groups, repairs its highlight, and inherits Ctrl+C query clearing", async () => {
  const selections: string[] = [];
  const setup = await renderCommand(
    <Fixture direction="up">
      <CommandGroup id="alpha-group" heading="Alpha">
        <CommandItem id="alpha" onSelect={() => selections.push("Alpha")}>
          Alpha
        </CommandItem>
      </CommandGroup>
      <CommandGroup id="beta-group" heading="Beta">
        <CommandItem id="beta" onSelect={() => selections.push("Beta")}>
          Beta
        </CommandItem>
      </CommandGroup>
      <CommandItem disabled>Disabled</CommandItem>
    </Fixture>,
  );
  try {
    const input = setup.renderer.root.findDescendantById("query") as InputRenderable;
    await act(async () => setup.mockInput.typeText("alpha"));
    expect(setup.renderer.root.findDescendantById("beta-group")!.visible).toBe(false);
    act(() => setup.mockInput.pressEnter());
    expect(selections).toEqual(["Alpha"]);

    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    expect(input.value).toBe("");
    expect(setup.renderer.root.findDescendantById("beta-group")!.visible).toBe(true);
    expect(highlighted(setup.renderer.root.findDescendantById("alpha") as BoxRenderable)).toBe(
      true,
    );
    act(() => {
      setup.mockInput.pressKey("n", { ctrl: true });
      setup.mockInput.pressEnter();
    });
    expect(selections).toEqual(["Alpha", "Beta"]);

    await act(async () => setup.mockInput.typeText("missing"));
    expect(setup.renderer.root.findDescendantById("empty")!.visible).toBe(true);
    expect(getControlHints(input)).toEqual([]);
    act(() => setup.mockInput.pressEnter());
    expect(selections).toEqual(["Alpha", "Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const direction of ["down", "up"] as const) {
  test(`Command direction=${direction} anchors filtered results to the input edge`, async () => {
    const setup = await renderCommand(
      <Fixture direction={direction}>
        {Array.from({ length: 11 }, (_, index) => (
          <CommandItem key={index} id={`item-${index}`}>{`Action ${index}`}</CommandItem>
        ))}
      </Fixture>,
    );
    try {
      await act(async () => setup.mockInput.typeText("Action 4"));
      await act(async () => setup.flush());
      const list = setup.renderer.root.findDescendantById("list") as ScrollBoxRenderable;
      const row = setup.renderer.root.findDescendantById("item-4")!;
      expect(row.screenY).toBe(
        direction === "up"
          ? list.viewport.screenY + list.viewport.height - row.height
          : list.viewport.screenY,
      );
      expect(list.scrollTop).toBe(0);

      await act(async () => setup.mockInput.typeText(" missing"));
      await act(async () => setup.flush());
      const empty = setup.renderer.root.findDescendantById("empty")!;
      expect(empty.visible).toBe(true);
      expect(empty.screenY).toBe(
        direction === "up"
          ? list.viewport.screenY + list.viewport.height - empty.height
          : list.viewport.screenY,
      );

      await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
      await act(async () => setup.flush());
      const edge = setup.renderer.root.findDescendantById(
        direction === "up" ? "item-10" : "item-0",
      ) as BoxRenderable;
      expect(highlighted(edge)).toBe(true);
      expect(edge.screenY).toBeGreaterThanOrEqual(list.viewport.screenY);
      expect(edge.screenY + edge.height).toBeLessThanOrEqual(
        list.viewport.screenY + list.viewport.height,
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  });

  for (const { key, down, up } of [
    { key: "n", down: 1, up: 0 },
    { key: "p", down: 10, up: 9 },
    { key: "d", down: 3, up: 10 },
    { key: "u", down: 0, up: 7 },
    { key: "f", down: 5, up: 10 },
    { key: "b", down: 0, up: 5 },
  ]) {
    test(`Command direction=${direction} keeps Ctrl+${key} in its visual direction`, async () => {
      const selections: number[] = [];
      const setup = await renderCommand(
        <Fixture direction={direction}>
          {Array.from({ length: 11 }, (_, index) => (
            <CommandItem
              key={index}
              onSelect={() => selections.push(index)}
            >{`Action ${index}`}</CommandItem>
          ))}
        </Fixture>,
      );
      try {
        await act(async () => setup.flush());
        act(() => {
          setup.mockInput.pressKey(key, { ctrl: true });
          setup.mockInput.pressEnter();
        });
        expect(selections).toEqual([direction === "up" ? up : down]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("CommandList bottom alignment preserves content padding and explicit alignment overrides", async () => {
  let align!: Dispatch<SetStateAction<"flex-start" | undefined>>;
  function AlignmentFixture() {
    const [justifyContent, setJustifyContent] = useState<"flex-start">();
    align = setJustifyContent;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Command direction="up">
          <CommandInput focused />
          <CommandList
            id="list"
            height={5}
            contentOptions={{ paddingLeft: 2, paddingBottom: 1, justifyContent }}
          >
            <CommandItem id="item">Action</CommandItem>
          </CommandList>
        </Command>
      </ThemeProvider>
    );
  }
  const setup = await renderCommand(<AlignmentFixture />);
  try {
    const list = setup.renderer.root.findDescendantById("list") as ScrollBoxRenderable;
    const row = setup.renderer.root.findDescendantById("item")!;
    expect(row.screenY + row.height).toBe(list.viewport.screenY + list.viewport.height - 1);
    expect(row.screenX).toBe(list.viewport.screenX + 2);
    await act(async () => align("flex-start"));
    await act(async () => setup.flush());
    expect(row.screenY).toBe(list.viewport.screenY);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled Command queries remain parent-owned until acknowledged", async () => {
  const requests: string[] = [];
  let update!: Dispatch<SetStateAction<string>>;
  let allowRequests!: Dispatch<SetStateAction<boolean>>;
  let acknowledge = false;
  function ControlledFixture() {
    const [query, setQuery] = useState("Alpha");
    const [editable, setEditable] = useState(false);
    update = setQuery;
    allowRequests = setEditable;
    return (
      <Fixture
        query={query}
        onQueryChange={
          editable
            ? (value) => {
                requests.push(value);
                if (acknowledge) {
                  setQuery(value);
                }
              }
            : undefined
        }
      >
        <CommandItem>Alpha</CommandItem>
        <CommandItem>Beta</CommandItem>
      </Fixture>
    );
  }
  const setup = await renderCommand(<ControlledFixture />);
  try {
    const input = setup.renderer.root.findDescendantById("query") as InputRenderable;
    await act(async () => setup.mockInput.typeText("x"));
    expect(input.value).toBe("Alpha");
    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    expect(input.value).toBe("Alpha");
    expect(requests).toEqual([]);

    await act(async () => allowRequests(true));
    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    expect(requests).toEqual([""]);
    expect(input.value).toBe("Alpha");
    await act(async () => update(""));
    expect(input.value).toBe("");
    acknowledge = true;
    await act(async () => setup.mockInput.typeText("Beta"));
    expect(input.value).toBe("Beta");
    expect(requests.at(-1)).toBe("Beta");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const Ancestor of [Box, CommandGroup]) {
  test(`Command skips hidden ancestors and cannot activate an item hidden by ${Ancestor.name}`, async () => {
    const selections: string[] = [];
    const setup = await renderCommand(
      <Fixture>
        <Box visible={false}>
          <CommandItem>Hidden</CommandItem>
        </Box>
        <Ancestor id="ancestor">
          <CommandItem id="alpha" onSelect={() => selections.push("Alpha")}>
            Alpha
          </CommandItem>
        </Ancestor>
        <CommandItem id="beta" onSelect={() => selections.push("Beta")}>
          Beta
        </CommandItem>
      </Fixture>,
    );
    try {
      expect(highlighted(setup.renderer.root.findDescendantById("alpha") as BoxRenderable)).toBe(
        true,
      );
      act(() => {
        setup.renderer.root.findDescendantById("ancestor")!.visible = false;
        setup.mockInput.pressEnter();
      });
      expect(selections).toEqual([]);
      act(() => {
        setup.mockInput.pressArrow("down");
        setup.mockInput.pressEnter();
      });
      expect(selections).toEqual(["Beta"]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("changing Command direction repairs to the new edge without losing input focus", async () => {
  let changeDirection!: Dispatch<SetStateAction<CommandProps["direction"]>>;
  function ChangingFixture() {
    const [direction, setDirection] = useState<CommandProps["direction"]>("down");
    changeDirection = setDirection;
    return (
      <Fixture direction={direction}>
        <CommandItem id="alpha">Alpha</CommandItem>
        <CommandItem id="beta">Beta</CommandItem>
      </Fixture>
    );
  }
  const setup = await renderCommand(<ChangingFixture />);
  try {
    await act(async () => changeDirection("up"));
    await act(async () => setup.flush());
    expect(highlighted(setup.renderer.root.findDescendantById("beta") as BoxRenderable)).toBe(true);
    const list = setup.renderer.root.findDescendantById("list") as ScrollBoxRenderable;
    const beta = setup.renderer.root.findDescendantById("beta")!;
    expect(beta.screenY + beta.height).toBe(list.viewport.screenY + list.viewport.height);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("query");
    await act(async () => changeDirection("down"));
    await act(async () => setup.flush());
    expect(highlighted(setup.renderer.root.findDescendantById("alpha") as BoxRenderable)).toBe(
      true,
    );
    expect(setup.renderer.root.findDescendantById("alpha")!.screenY).toBe(list.viewport.screenY);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("CommandInput respects spacing overrides and inherited custom submission bindings", async () => {
  let selected = 0;
  const setup = await renderCommand(
    <ThemeProvider theme={defaultTheme}>
      <Command id="command" direction="up">
        <CommandInput
          id="query"
          focused
          marginTop={2}
          marginBottom={3}
          keyBindings={[
            { name: "return", action: "move-left" },
            { name: "x", ctrl: true, action: "submit" },
          ]}
        />
        <CommandList height={3}>
          <CommandItem onSelect={() => selected++}>
            <Text variant="success">Custom label</Text>
          </CommandItem>
        </CommandList>
      </Command>
    </ThemeProvider>,
  );
  try {
    const query = setup.renderer.root.findDescendantById("query") as InputRenderable;
    expect(query.marginTop).toBe(2);
    expect(setup.renderer.root.findDescendantById("command")!.height).toBe(9);
    expect(getControlHints(query)).not.toContainEqual({ keys: "Enter", label: "Run" });
    expect(getControlHints(query)).toContainEqual({ keys: "Ctrl+x", label: "Run" });
    act(() => setup.mockInput.pressEnter());
    expect(selected).toBe(0);
    act(() => setup.mockInput.pressKey("x", { ctrl: true }));
    expect(selected).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Command applies buffered filtering before activation and restores filtered groups", async () => {
  const selections: string[] = [];
  const setup = await renderCommand(
    <Fixture defaultQuery="alpha">
      <CommandGroup heading="Alpha">
        <CommandItem onSelect={() => selections.push("Alpha")}>Alpha</CommandItem>
      </CommandGroup>
      <CommandGroup heading="Beta">
        <CommandItem onSelect={() => selections.push("Beta")}>Beta</CommandItem>
      </CommandGroup>
    </Fixture>,
  );
  try {
    act(() => {
      setup.mockInput.pressKey("c", { ctrl: true });
      setup.mockInput.typeText("beta");
      setup.mockInput.pressEnter();
    });
    expect(selections).toEqual(["Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("CommandItem clicks retain input ownership and tolerate crossing child hit targets", async () => {
  const selections: string[] = [];
  let cancel = false;
  const setup = await renderCommand(
    <Fixture>
      <CommandItem id="alpha" onSelect={() => selections.push("Alpha")}>
        Alpha
      </CommandItem>
      <CommandItem
        id="beta"
        onMouseDown={(event) => {
          if (cancel) {
            event.stopPropagation();
          }
        }}
        onSelect={() => selections.push("Beta")}
      >
        Beta
      </CommandItem>
    </Fixture>,
  );
  try {
    const beta = setup.renderer.root.findDescendantById("beta") as BoxRenderable;
    const label = beta.getChildren().at(-1)!;
    const x = beta.screenX + beta.width - 1;
    const y = beta.screenY;
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.mockMouse.click(label.screenX, y));
    expect(selections).toEqual(["Beta"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("query");

    await act(async () => setup.mockMouse.moveTo(x, y));
    await act(async () => setup.mockMouse.pressDown(x, y));
    await act(async () => setup.mockMouse.moveTo(label.screenX, y));
    await act(async () => setup.mockMouse.release(label.screenX, y));
    expect(selections).toEqual(["Beta", "Beta"]);
    cancel = true;
    await act(async () => setup.mockMouse.click(label.screenX, y));
    expect(selections).toEqual(["Beta", "Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Command reconciles matching groups and highlighting when an ancestor is revealed", async () => {
  let reveal!: Dispatch<SetStateAction<boolean>>;
  let selected = 0;
  const select = () => selected++;
  function VisibilityFixture() {
    const [visible, setVisible] = useState(false);
    reveal = setVisible;
    return (
      <Fixture>
        <Box id="ancestor" visible={visible}>
          <CommandGroup id="group" heading="Actions">
            <CommandItem id="alpha" onSelect={select}>
              Alpha
            </CommandItem>
          </CommandGroup>
        </Box>
      </Fixture>
    );
  }
  const setup = await renderCommand(<VisibilityFixture />);
  try {
    expect(setup.renderer.root.findDescendantById("empty")!.visible).toBe(true);
    await act(async () => reveal(true));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("group")!.visible).toBe(true);
    expect(highlighted(setup.renderer.root.findDescendantById("alpha") as BoxRenderable)).toBe(
      true,
    );
    expect(setup.renderer.root.findDescendantById("empty")!.visible).toBe(false);
    act(() => setup.mockInput.pressEnter());
    expect(selected).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Command does not reinterpret native group hiding as query filtering", async () => {
  let rename!: Dispatch<SetStateAction<string>>;
  const selections: string[] = [];
  const selectAlpha = () => selections.push("Alpha");
  const selectBeta = () => selections.push("Beta");
  function VisibilityFixture() {
    const [value, setValue] = useState("Beta");
    rename = setValue;
    return (
      <Fixture>
        <CommandGroup id="group" heading="Actions">
          <CommandItem onSelect={selectAlpha}>Alpha</CommandItem>
        </CommandGroup>
        <CommandItem value={value} onSelect={selectBeta}>
          Beta
        </CommandItem>
      </Fixture>
    );
  }
  const setup = await renderCommand(<VisibilityFixture />);
  try {
    act(() => {
      setup.renderer.root.findDescendantById("group")!.visible = false;
      rename("Gamma");
    });
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("group")!.visible).toBe(false);
    act(() => setup.mockInput.pressEnter());
    expect(selections).toEqual(["Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("upward Command repairs to the last rendered item after filtered keyed reordering", async () => {
  let reorder!: Dispatch<SetStateAction<string[]>>;
  const selections: string[] = [];
  const callbacks = new Map(
    ["Alpha", "Beta", "Gamma"].map((value) => [value, () => selections.push(value)]),
  );
  function OrderFixture() {
    const [order, setOrder] = useState(["Alpha", "Beta", "Gamma"]);
    reorder = setOrder;
    return (
      <Fixture direction="up" defaultQuery="missing">
        {order.map((value) => (
          <CommandItem key={value} id={value} onSelect={callbacks.get(value)}>
            {value}
          </CommandItem>
        ))}
      </Fixture>
    );
  }
  const setup = await renderCommand(<OrderFixture />);
  try {
    await act(async () => reorder(["Gamma", "Beta", "Alpha"]));
    act(() => {
      setup.mockInput.pressKey("c", { ctrl: true });
      setup.mockInput.pressEnter();
    });
    expect(selections).toEqual(["Alpha"]);
    await act(async () => setup.flush());
    expect(highlighted(setup.renderer.root.findDescendantById("Alpha") as BoxRenderable)).toBe(
      true,
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Command Run hints honor inherited nonempty Ctrl+C clearing", async () => {
  let selected = 0;
  const setup = await renderCommand(
    <ThemeProvider theme={defaultTheme}>
      <Command defaultQuery="Alpha">
        <CommandInput
          id="query"
          focused
          keyBindings={[{ name: "c", ctrl: true, action: "submit" }]}
        />
        <CommandList height={3}>
          <CommandItem onSelect={() => selected++}>Alpha</CommandItem>
        </CommandList>
      </Command>
    </ThemeProvider>,
  );
  try {
    const input = setup.renderer.root.findDescendantById("query") as InputRenderable;
    expect(getControlHints(input)).not.toContainEqual({ keys: "Ctrl+c", label: "Run" });
    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    expect(input.value).toBe("");
    expect(selected).toBe(0);
    expect(getControlHints(input)).toContainEqual({ keys: "Ctrl+c", label: "Run" });
    act(() => setup.mockInput.pressKey("c", { ctrl: true }));
    expect(selected).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

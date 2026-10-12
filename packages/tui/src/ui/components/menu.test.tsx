import { expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { Dialog, DialogContent } from "@/ui/components/dialog";
import {
  Menu,
  MenuContent,
  type MenuContentProps,
  MenuItem,
  type MenuProps,
  MenuTrigger,
} from "@/ui/components/menu";
import { getControlHints } from "@/ui/control-hints";
import { Button } from "@/ui/controls/button";
import { FocusManager } from "@/ui/focus-manager";
import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

function renderMenu(node: ReactNode) {
  return act(async () => testRender(node, { width: 80, height: 24, kittyKeyboard: true }));
}

function MenuFixture({ side, children, ...props }: MenuProps & Pick<MenuContentProps, "side">) {
  return (
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page" width={80} height={24}>
        <Box position="absolute" top={10} left={5}>
          <Menu {...props}>
            <MenuTrigger id="trigger">Actions</MenuTrigger>
            <MenuContent id="menu" side={side} width={20}>
              {children}
            </MenuContent>
          </Menu>
        </Box>
        <Button id="after">After</Button>
      </Box>
    </ThemeProvider>
  );
}

test("buffered navigation selects the current item before React commits", async () => {
  const selections: string[] = [];
  const setup = await renderMenu(
    <MenuFixture defaultOpen>
      <MenuItem onSelect={() => selections.push("Alpha")}>Alpha</MenuItem>
      <MenuItem disabled onSelect={() => selections.push("Disabled")}>
        Disabled
      </MenuItem>
      <MenuItem onSelect={() => selections.push("Beta")}>Beta</MenuItem>
    </MenuFixture>,
  );
  try {
    await act(async () => setup.flush());
    act(() => {
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(selections).toEqual(["Beta"]);
    expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();

    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    act(() => {
      setup.mockInput.pressKey("g", { shift: true });
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(selections).toEqual(["Beta", "Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("items under hidden ancestors are excluded from initial selection", async () => {
  const selections: string[] = [];
  const setup = await renderMenu(
    <MenuFixture defaultOpen>
      <Box visible={false}>
        <MenuItem onSelect={() => selections.push("Hidden")}>Hidden</MenuItem>
      </Box>
      <MenuItem onSelect={() => selections.push("Visible")}>Visible</MenuItem>
    </MenuFixture>,
  );
  try {
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(selections).toEqual(["Visible"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an active item cannot be selected after its ancestor becomes hidden", async () => {
  const selections: string[] = [];
  const setup = await renderMenu(
    <MenuFixture defaultOpen>
      <Box id="group">
        <MenuItem onSelect={() => selections.push("Alpha")}>Alpha</MenuItem>
      </Box>
      <MenuItem onSelect={() => selections.push("Beta")}>Beta</MenuItem>
    </MenuFixture>,
  );
  try {
    await act(async () => setup.flush());
    act(() => {
      setup.renderer.root.findDescendantById("group")!.visible = false;
    });
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    expect(getControlHints(trigger).some((hint) => hint.label === "Select")).toBe(false);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(selections).toEqual([]);
    expect(setup.renderer.root.findDescendantById("menu")).toBeDefined();
    act(() => {
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(selections).toEqual(["Beta"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an open menu repositions when side changes", async () => {
  let changeSide!: Dispatch<SetStateAction<MenuContentProps["side"]>>;
  function Fixture() {
    const [side, setSide] = useState<MenuContentProps["side"]>("bottom");
    changeSide = setSide;
    return (
      <MenuFixture side={side}>
        <MenuItem>Alpha</MenuItem>
        <MenuItem>Beta</MenuItem>
      </MenuFixture>
    );
  }
  const setup = await renderMenu(<Fixture />);
  try {
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    const menu = setup.renderer.root.findDescendantById("menu")!;
    expect(menu.screenY).toBe(trigger.screenY + trigger.height);
    act(() => changeSide("top"));
    await act(async () => setup.flush());
    // Position updates commit after FRAME and appear in the next native layout.
    await act(async () => setup.flush());
    expect(menu.screenY + menu.height).toBe(trigger.screenY);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled Menu waits for parent acknowledgement of opening and dismissal", async () => {
  const requests: boolean[] = [];
  let update!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [open, setOpen] = useState(false);
    update = setOpen;
    return (
      <MenuFixture open={open} defaultOpen onOpenChange={(next) => requests.push(next)}>
        <MenuItem>Action</MenuItem>
      </MenuFixture>
    );
  }
  const setup = await renderMenu(<Fixture />);
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(requests).toEqual([true]);
    expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();
    act(() => update(true));
    await act(async () => setup.flush());
    const menu = setup.renderer.root.findDescendantById("menu")!;
    expect(menu).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
    act(() => setup.mockInput.pressEscape());
    await act(async () => setup.flush());
    expect(requests).toEqual([true, false]);
    expect(setup.renderer.root.findDescendantById("menu")).toBe(menu);
    act(() => update(false));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("automatic Menu placement flips above and clamps horizontally until resizing provides room", async () => {
  const setup = await act(async () =>
    testRender(
      <ThemeProvider theme={defaultTheme}>
        <FocusManager focusScopeId="page" />
        <Box id="page" width="100%" height="100%">
          <Box position="absolute" top={10} left={26}>
            <Menu defaultOpen>
              <MenuTrigger id="trigger">Go</MenuTrigger>
              <MenuContent id="menu" width={12}>
                <MenuItem>One</MenuItem>
                <MenuItem>Two</MenuItem>
              </MenuContent>
            </Menu>
          </Box>
        </Box>
      </ThemeProvider>,
      { width: 30, height: 14 },
    ),
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const menu = setup.renderer.root.findDescendantById("menu")!;
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    expect(menu.screenY + menu.height).toBe(trigger.screenY);
    expect(menu.screenX + menu.width).toBe(30);
    act(() => setup.resize(40, 20));
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(menu.screenY).toBe(trigger.screenY + trigger.height);
    expect(menu.screenX).toBe(trigger.screenX);
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Menu hints track available actions and survive trigger refocus", async () => {
  const setup = await renderMenu(
    <MenuFixture>
      <MenuItem>Alpha</MenuItem>
    </MenuFixture>,
  );
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space/↓", label: "Open menu" });
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(getControlHints(trigger)).toContainEqual({ keys: "↑/↓/j/k", label: "Navigate" });
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space", label: "Select" });
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("after");
    expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();
    act(() => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.flush());
    expect(getControlHints(trigger)).toContainEqual({ keys: "Enter/Space/↓", label: "Open menu" });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Escape closes an open Menu before dismissing its enclosing Dialog", async () => {
  const setup = await renderMenu(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page">
        <Button id="outside">Outside</Button>
        <Dialog defaultOpen>
          <DialogContent id="dialog">
            <Menu defaultOpen>
              <MenuTrigger id="trigger">Actions</MenuTrigger>
              <MenuContent id="menu">
                <MenuItem>Rename</MenuItem>
              </MenuContent>
            </Menu>
          </DialogContent>
        </Dialog>
      </Box>
    </ThemeProvider>,
  );
  try {
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger");
    expect(setup.renderer.root.findDescendantById("menu")).toBeDefined();
    act(() => setup.mockInput.pressEscape());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger");

    act(() => setup.mockInput.pressEscape());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const rich of [false, true]) {
  for (const childFirst of [false, true]) {
    test(`${rich ? "Explicit Text" : "Plain text"} Menu clicks survive ${childFirst ? "label-to-padding" : "padding-to-label"} crossings but cancel when leaving the row`, async () => {
      let selected = 0;
      const setup = await renderMenu(
        <MenuFixture defaultOpen>
          <MenuItem id="item" onSelect={() => selected++}>
            {rich ? <Text variant="error">Rename</Text> : "Rename"}
          </MenuItem>
        </MenuFixture>,
      );
      try {
        await act(async () => setup.flush());
        const row = setup.renderer.root.findDescendantById("item")!;
        const label = row.getChildren()[0]!;
        const y = row.screenY;
        const startX = childFirst ? label.screenX : row.screenX;
        const endX = childFirst ? row.screenX : label.screenX;
        expect(setup.renderer.hitTest(row.screenX, y)).toBe(row.num);
        expect(setup.renderer.hitTest(label.screenX, y)).toBe(label.num);

        await act(async () => setup.mockMouse.moveTo(startX, y));
        await act(async () => setup.mockMouse.pressDown(startX, y));
        await act(async () => setup.mockMouse.moveTo(endX, y));
        await act(async () => setup.mockMouse.moveTo(70, 20));
        await act(async () => setup.mockMouse.moveTo(endX, y));
        await act(async () => setup.mockMouse.release(endX, y));
        expect(selected).toBe(0);
        expect(setup.renderer.root.findDescendantById("menu")).toBeDefined();

        await act(async () => setup.mockMouse.moveTo(startX, y));
        await act(async () => setup.mockMouse.pressDown(startX, y));
        await act(async () => setup.mockMouse.moveTo(endX, y));
        await act(async () => setup.mockMouse.release(endX, y));
        await act(async () => setup.flush());
        expect(selected).toBe(1);
        expect(setup.renderer.root.findDescendantById("menu")).toBeUndefined();
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

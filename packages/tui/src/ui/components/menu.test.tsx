import { expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

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

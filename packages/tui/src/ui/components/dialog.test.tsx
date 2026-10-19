import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  type InputRenderable,
  RGBA,
  TextAttributes,
  type TextRenderable,
} from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { FocusManager } from "@/ui/focus-manager";
import { getActiveModalFocusScope } from "@/ui/modal-focus";
import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("undefined open preserves uncontrolled dismissal and focus restoration", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page">
        <Dialog open={undefined} defaultOpen>
          <DialogTrigger id="trigger">Open</DialogTrigger>
          <DialogContent id="content" initialFocusId="close">
            <Button id="first">First</Button>
            <DialogClose id="close">Close</DialogClose>
          </DialogContent>
        </Dialog>
      </Box>
    </ThemeProvider>,
    { width: 80, height: 20, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("content")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("close");
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first");
    act(() => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("close");
    act(() => setup.mockInput.pressEscape());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("content")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger");

    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("close");
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("content")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger");

    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    await act(async () => setup.mockMouse.click(0, 0));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("content")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("trigger");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("restoration veto prevents queued focus theft", async () => {
  let update!: Dispatch<SetStateAction<boolean>>;
  let allowRestore = true;
  function Fixture() {
    const [open, setOpen] = useState(false);
    update = setOpen;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box>
          <Button id="origin">Origin</Button>
          <Button id="destination">Destination</Button>
          <Dialog open={open}>
            <DialogContent canRestoreFocus={() => allowRestore}>
              <Button id="close">Close</Button>
            </DialogContent>
          </Dialog>
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 20 });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("origin")!.focus());
    act(() => update(true));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("close");
    act(() => update(false));
    allowRestore = false;
    act(() => setup.renderer.root.findDescendantById("destination")!.focus());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("destination");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("dialog content applies horizontal padding", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Dialog defaultOpen>
        <DialogContent id="content" border={false} padding={2} width={30}>
          <Text id="body">Body</Text>
        </DialogContent>
      </Dialog>
    </ThemeProvider>,
    { width: 60, height: 20 },
  );
  try {
    await setup.flush();
    const content = setup.renderer.root.findDescendantById("content")!;
    const body = setup.renderer.root.findDescendantById("body")!;
    expect(body.screenX - content.screenX).toBe(2);
    expect(body.screenY - content.screenY).toBe(0);
    expect(content.height).toBe(body.height);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const { label, margins, bounds } of [
  { label: "default", margins: undefined, bounds: { x: 0, y: 0, width: 80, height: 20 } },
  {
    label: "bottom row reserved",
    margins: { bottom: 1 },
    bounds: { x: 0, y: 0, width: 80, height: 19 },
  },
  {
    label: "all edges reserved",
    margins: { top: 3, right: 4, bottom: 1, left: 2 },
    bounds: { x: 2, y: 3, width: 74, height: 16 },
  },
] as const) {
  test(`dialog overlay ${label} constrains both backdrop and content`, async () => {
    const requests: boolean[] = [];
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Dialog open onOpenChange={(open) => requests.push(open)}>
          <DialogContent
            id="content"
            overlayMargins={margins}
            width="100%"
            maxWidth={100}
            maxHeight="100%"
          >
            <Input id="input" />
          </DialogContent>
        </Dialog>
      </ThemeProvider>,
      { width: 80, height: 20 },
    );
    try {
      await act(async () => setup.flush());
      const content = setup.renderer.root.findDescendantById("content")!;
      const overlay = content.parent!;
      expect({
        x: overlay.screenX,
        y: overlay.screenY,
        width: overlay.width,
        height: overlay.height,
      }).toEqual(bounds);
      expect(content.screenX).toBeGreaterThanOrEqual(bounds.x);
      expect(content.screenX + content.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(content.screenY + content.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await act(async () => setup.mockMouse.click(0, 19));
      expect(requests).toEqual(margins === undefined ? [false] : []);
      if (margins !== undefined) {
        await act(async () => setup.mockMouse.click(bounds.x, bounds.y));
        expect(requests).toEqual([false]);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const { label, width, maxWidth, minWidth } of [
  { label: "fractional width", width: 78.4, maxWidth: 120, minWidth: undefined },
  { label: "fractional maximum", width: 79, maxWidth: 60.4, minWidth: undefined },
  { label: "percentage maximum", width: 79, maxWidth: "50%", minWidth: undefined },
  { label: "fractional minimum", width: 30, maxWidth: 120, minWidth: 60.4 },
] as const) {
  test(`dialog ${label} constrains measured inputs to whole-cell content bounds`, async () => {
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Dialog defaultOpen>
          <DialogContent id="content" width={width} maxWidth={maxWidth} minWidth={minWidth}>
            <Box id="nested" width="100%">
              <Input id="input" placeholder="Search" />
            </Box>
          </DialogContent>
        </Dialog>
      </ThemeProvider>,
      { width: maxWidth === "50%" ? 101 : 100, height: 20 },
    );
    try {
      await act(async () => setup.flush());
      const content = setup.renderer.root.findDescendantById("content")!;
      const nested = setup.renderer.root.findDescendantById("nested")!;
      const input = setup.renderer.root.findDescendantById("input") as InputRenderable;
      expect(input.width).toBe(nested.width);
      expect(input.screenX + input.width).toBe(content.screenX + content.width - 2);
      if (maxWidth === "50%") {
        expect(content.width).toBeLessThanOrEqual(49.5);
      } else {
        expect(content.width).toBeLessThanOrEqual(maxWidth);
      }
      if (minWidth !== undefined) {
        expect(content.width).toBeGreaterThanOrEqual(minWidth);
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("destructive dialogs update default title and border styles", async () => {
  let setDestructive!: Dispatch<SetStateAction<boolean | undefined>>;
  function Fixture() {
    const [destructive, updateDestructive] = useState<boolean>();
    setDestructive = updateDestructive;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Dialog defaultOpen destructive={destructive}>
          <DialogContent id="content">
            <DialogTitle id="title">Project</DialogTitle>
            <DialogTitle id="override" variant="heading">
              Override
            </DialogTitle>
          </DialogContent>
        </Dialog>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 20 });
  try {
    await setup.flush();
    const content = setup.renderer.root.findDescendantById("content") as BoxRenderable;
    const title = setup.renderer.root.findDescendantById("title") as TextRenderable;
    const override = setup.renderer.root.findDescendantById("override") as TextRenderable;
    expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors.primary))).toBe(true);
    expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    expect(content.borderColor.equals(RGBA.fromHex(defaultTheme.colors.border))).toBe(true);
    expect(content.focusedBorderColor.equals(RGBA.fromHex(defaultTheme.colors.focus))).toBe(true);

    act(() => setDestructive(true));
    await act(async () => setup.flush());
    expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors.error))).toBe(true);
    expect(title.attributes & TextAttributes.BOLD).toBe(0);
    expect(override.fg.equals(RGBA.fromHex(defaultTheme.colors.primary))).toBe(true);
    expect(content.borderColor.equals(RGBA.fromHex(defaultTheme.colors.error))).toBe(true);
    expect(content.focusedBorderColor.equals(RGBA.fromHex(defaultTheme.colors.error))).toBe(true);

    act(() => setDestructive(false));
    await act(async () => setup.flush());
    expect(title.fg.equals(RGBA.fromHex(defaultTheme.colors.primary))).toBe(true);
    expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    expect(content.borderColor.equals(RGBA.fromHex(defaultTheme.colors.border))).toBe(true);
    expect(content.focusedBorderColor.equals(RGBA.fromHex(defaultTheme.colors.focus))).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("closing dialogs out of order restores background Tab navigation", async () => {
  let setFirst!: Dispatch<SetStateAction<boolean>>;
  let setSecond!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [first, updateFirst] = useState(false);
    const [second, updateSecond] = useState(false);
    setFirst = updateFirst;
    setSecond = updateSecond;
    return (
      <ThemeProvider theme={defaultTheme}>
        <FocusManager focusScopeId="page" />
        <Box id="page">
          <Button id="before">Before</Button>
          <Button id="after">After</Button>
          <Dialog open={first} onOpenChange={updateFirst}>
            <DialogContent id="first-dialog">
              <Button id="first-button">First</Button>
            </DialogContent>
          </Dialog>
          <Dialog open={second} onOpenChange={updateSecond}>
            <DialogContent id="second-dialog">
              <Button id="second-button">Second</Button>
            </DialogContent>
          </Dialog>
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 20 });
  try {
    await setup.flush();
    act(() => setFirst(true));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("first-button");
    act(() => setSecond(true));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("second-button");
    act(() => setFirst(false));
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("second-button");
    act(() => setSecond(false));
    await act(async () => setup.flush());
    expect(getActiveModalFocusScope()?.root.id).toBeUndefined();
    const focused = setup.renderer.currentFocusedRenderable?.id ?? "";
    expect(["before", "after"]).toContain(focused);
    act(() => setup.mockInput.pressTab());
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      focused === "before" ? "after" : "before",
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("controlled Dialog waits for parent acknowledgement and blocks backdrop clicks when dismissal is disabled", async () => {
  const requests: boolean[] = [];
  let update!: Dispatch<SetStateAction<boolean>>;
  let backgroundPresses = 0;
  function Fixture() {
    const [open, setOpen] = useState(false);
    update = setOpen;
    return (
      <ThemeProvider theme={defaultTheme}>
        <FocusManager focusScopeId="page" />
        <Box id="page">
          <Button id="background" onPress={() => backgroundPresses++}>
            Background
          </Button>
          <Dialog
            open={open}
            defaultOpen
            closeOnBackdropClick={false}
            onOpenChange={(next) => requests.push(next)}
          >
            <DialogTrigger id="trigger">Open</DialogTrigger>
            <DialogContent id="dialog">
              <DialogClose id="close">Close</DialogClose>
            </DialogContent>
          </Dialog>
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 60, height: 15, kittyKeyboard: true });
  try {
    await act(async () => setup.flush());
    const trigger = setup.renderer.root.findDescendantById("trigger")!;
    act(() => trigger.focus());
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(requests).toEqual([true]);
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
    act(() => update(true));
    await act(async () => setup.flush());
    const dialog = setup.renderer.root.findDescendantById("dialog")!;
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("close");
    await act(async () => setup.mockMouse.click(0, 0));
    expect(requests).toEqual([true]);
    expect(backgroundPresses).toBe(0);
    act(() => setup.mockInput.pressEscape());
    await act(async () => setup.flush());
    expect(requests).toEqual([true, false]);
    expect(setup.renderer.root.findDescendantById("dialog")).toBe(dialog);
    act(() => update(false));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(trigger);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

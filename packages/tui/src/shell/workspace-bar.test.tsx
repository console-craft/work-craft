import { expect, test } from "bun:test";

import {
  type BoxRenderable,
  MouseButton,
  parseColor,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { WorkspaceBar } from "@/shell/workspace-bar";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { icons } from "@/ui/icons/nerd";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

const workspaces = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

async function renderWorkspaces(rows = workspaces, width = 120) {
  const activated: string[] = [];
  let select!: Dispatch<SetStateAction<string | null>>;
  let updateRows!: Dispatch<SetStateAction<typeof workspaces>>;
  function Fixture() {
    const [activeId, setActiveId] = useState<string | null>(rows[0]?.id ?? null);
    select = setActiveId;
    const [entries, setEntries] = useState(rows);
    updateRows = setEntries;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box id="page" width="100%" height={4}>
          <Box height={3} flexDirection="row">
            <WorkspaceBar
              workspaces={entries}
              activeId={activeId}
              focused
              onActivate={(id) => {
                activated.push(id);
                setActiveId(id);
              }}
            />
          </Box>
          <Box id="other" focusable height={1} />
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width, height: 4, kittyKeyboard: true });
  await act(async () => setup.flush());
  await act(async () => setup.flush());
  return { ...setup, activated, select, updateRows };
}

test("workspace outlined numbers stay unchanged during selection and focus changes", async () => {
  const setup = await renderWorkspaces();
  const label = (id: string) =>
    (setup.renderer.root.findDescendantById(`workspace:${id}`)!.getChildren()[0] as TextRenderable)
      .plainText;
  try {
    expect(label("a")).toBe(`${icons.number1CircleOutline} Alpha`);
    expect(label("b")).toBe(`${icons.number2CircleOutline} Beta`);
    act(() => setup.mockInput.pressKey("l"));
    await act(async () => setup.flush());
    expect(setup.activated).toEqual([]);
    expect(label("a")).toBe(`${icons.number1CircleOutline} Alpha`);
    expect(label("b")).toBe(`${icons.number2CircleOutline} Beta`);
    expect(label("c")).toBe(`${icons.number3CircleOutline} Gamma`);
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:a") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:b") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    await act(async () => setup.flush());
    expect(label("a")).toBe(`${icons.number1CircleOutline} Alpha`);
    expect(label("b")).toBe(`${icons.number2CircleOutline} Beta`);
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:b") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.background).toInts());
    await act(async () => setup.select("b"));
    await act(async () => setup.flush());
    expect(label("a")).toBe(`${icons.number1CircleOutline} Alpha`);
    expect(label("b")).toBe(`${icons.number2CircleOutline} Beta`);
    expect(setup.activated).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace numbers cover 1 through 10 and omit icons beyond 10", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    name: `W${index + 1}`,
  }));
  const setup = await renderWorkspaces(rows);
  const label = (id: string) =>
    (setup.renderer.root.findDescendantById(`workspace:${id}`)!.getChildren()[0] as TextRenderable)
      .plainText;
  try {
    expect(label("1")).toBe(`${icons.number1CircleOutline} W1`);
    expect(label("10")).toBe(`${icons.number10CircleOutline} W10`);
    expect(label("11")).toBe("W11");
    expect(label("12")).toBe("W12");
    act(() => {
      for (let index = 0; index < 9; index++) {
        setup.mockInput.pressKey("l");
      }
    });
    await act(async () => setup.flush());
    expect(label("10")).toBe(`${icons.number10CircleOutline} W10`);
    act(() => setup.mockInput.pressKey("l"));
    await act(async () => setup.flush());
    expect(label("10")).toBe(`${icons.number10CircleOutline} W10`);
    expect(label("11")).toBe("W11");
    await act(async () => setup.select("12"));
    await act(async () => setup.flush());
    expect(label("12")).toBe("W12");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace toggles browse independently, wrap, and reset on refocus", async () => {
  const setup = await renderWorkspaces();
  try {
    expect(getFocusableRenderables(setup.renderer.root).map(({ id }) => id)).toEqual([
      "region:workspace",
      "other",
    ]);
    act(() => {
      setup.mockInput.pressKey("h");
      setup.mockInput.pressEnter();
    });
    expect(setup.activated).toEqual(["c"]);
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey("l"));
    await act(async () => setup.flush());
    expect(setup.activated).toEqual(["c"]);
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressEnter());
    expect(setup.activated).toEqual(["c", "c"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace Enter and Space reactivate the selected entry without deselection", async () => {
  const setup = await renderWorkspaces();
  try {
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    act(() => setup.mockInput.pressKey(" "));
    expect(setup.activated).toEqual(["a", "a"]);
    await act(async () => setup.select("b"));
    expect(setup.activated).toEqual(["a", "a"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace primary release activates while cancelled and secondary clicks do not", async () => {
  const setup = await renderWorkspaces();
  try {
    const row = setup.renderer.root.findDescendantById("workspace:b")!;
    await act(async () => setup.mockMouse.pressDown(row.screenX, row.screenY));
    expect(setup.activated).toEqual([]);
    await act(async () => setup.mockMouse.release(row.screenX, row.screenY));
    expect(setup.activated).toEqual(["b"]);
    await act(async () => setup.mockMouse.pressDown(row.screenX, row.screenY));
    await act(async () => setup.mockMouse.release(0, 3));
    await act(async () => setup.mockMouse.click(row.screenX, row.screenY, MouseButton.RIGHT));
    expect(setup.activated).toEqual(["b"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace toggles keep complete labels and custom colors across narrow layouts", async () => {
  const name = "工作 Workspace with a very long name";
  const setup = await renderWorkspaces([
    { id: "a", name },
    { id: "b", name: "Beta" },
  ]);
  try {
    const group = setup.renderer.root.findDescendantById("region:workspace")!;
    const active = group.findDescendantById("workspace:a")!;
    for (const width of [120, 30]) {
      act(() => setup.resize(width, 4));
      await act(async () => setup.flush());
      expect(group.height).toBe(3);
      const label = active.getChildren()[0] as TextRenderable;
      expect(label.plainText).toBe(`${icons.number1CircleOutline} ${name}`);
      expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
      expect((active as BoxRenderable).backgroundColor.toInts()).toEqual(
        parseColor(defaultTheme.colors.focus).toInts(),
      );
    }
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    await act(async () => setup.flush());
    expect((active.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.background).toInts(),
    );
    expect((active as BoxRenderable).backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.foreground).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("empty workspace toggles do not activate nonexistent entries", async () => {
  const setup = await renderWorkspaces([]);
  try {
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
      setup.mockInput.pressKey(" ");
    });
    expect(setup.activated).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

const overflowRows = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  name: `Work ${index}`,
}));

test("workspace scrolling reveals browsing without activation", async () => {
  const setup = await renderWorkspaces(overflowRows, 25);
  try {
    const area = setup.renderer.root.findDescendantById(
      "workspace-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area).toBeDefined();
    act(() => {
      for (let index = 0; index < 5; index++) {
        setup.mockInput.pressKey("l");
      }
    });
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const target = setup.renderer.root.findDescendantById("workspace:5")!;
    expect(target.screenX).toBeGreaterThanOrEqual(area.viewport.screenX);
    expect(target.screenX + target.width).toBeLessThanOrEqual(
      area.viewport.screenX + area.viewport.width,
    );
    expect(area.scrollLeft).toBeGreaterThan(0);
    expect(setup.activated).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    expect(getFocusableRenderables(setup.renderer.root).map(({ id }) => id)).toEqual([
      "region:workspace",
      "other",
    ]);
    act(() => {
      setup.mockInput.pressKey("h");
      setup.mockInput.pressEnter();
    });
    expect(setup.activated).toEqual(["4"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace manual scrolling preserves candidate and outside focus", async () => {
  const setup = await renderWorkspaces(overflowRows, 25);
  try {
    const area = setup.renderer.root.findDescendantById(
      "workspace-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area).toBeDefined();
    const right = setup.renderer.root.findDescendantById("workspace-scroll:right")!;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await act(async () => setup.flush());
    const manual = area.scrollLeft;
    expect(manual).toBeGreaterThan(0);
    await act(async () => setup.updateRows((rows) => [...rows]));
    await act(async () => setup.flush());
    expect(area.scrollLeft).toBe(manual);
    act(() => setup.mockInput.pressEnter());
    expect(setup.activated).toEqual(["0"]);
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    await act(async () => setup.flush());
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
    expect(setup.activated).toEqual(["0"]);
    act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(area.scrollLeft).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace scrolling survives wrap, refocus, resize, and keyed mutations", async () => {
  const setup = await renderWorkspaces(overflowRows, 25);
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  try {
    const area = setup.renderer.root.findDescendantById(
      "workspace-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area).toBeDefined();
    act(() => setup.mockInput.pressKey("h"));
    await settle();
    expect(area.scrollLeft).toBeGreaterThan(0);
    act(() => setup.mockInput.pressKey("l"));
    await settle();
    expect(area.scrollLeft).toBe(0);
    await act(async () => setup.updateRows((rows) => [...rows.slice(1), rows[0]!]));
    await settle();
    const target = setup.renderer.root.findDescendantById("workspace:0")!;
    expect(target.screenX + target.width).toBeLessThanOrEqual(
      area.viewport.screenX + area.viewport.width,
    );
    const longName = "工作 Workspace with a very long name";
    await act(async () =>
      setup.updateRows((rows) =>
        rows.map((row) => (row.id === "0" ? { ...row, name: longName } : row)),
      ),
    );
    await settle();
    expect((target.getChildren()[0] as TextRenderable).plainText).toBe(
      `${icons.number6CircleOutline} ${longName}`,
    );
    expect(target.screenX).toBe(area.viewport.screenX);
    act(() => setup.resize(17, 4));
    await settle();
    expect(target.screenX).toBe(area.viewport.screenX);
    expect(target.height).toBe(3);
    expect(setup.activated).toEqual([]);
    await act(async () => setup.updateRows((rows) => rows.filter(({ id }) => id !== "0")));
    await settle();
    act(() => setup.mockInput.pressEnter());
    expect(setup.activated).toEqual(["1"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import {
  BoxRenderable,
  parseColor,
  type Renderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { StatusBar, type StatusBarProps } from "@/shell/status-bar";
import { getFocusableRenderables } from "@/ui/focus-utils";
import { icons } from "@/ui/icons/nerd";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

function textDescendants(node: Renderable): TextRenderable[] {
  return node instanceof TextRenderable ? [node] : node.getChildren().flatMap(textDescendants);
}

test("status keys use keyboard icons without replacing action descriptions or unknown key names", async () => {
  const { renderer, flush } = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <StatusBar
        mode="HINTS"
        hints={[
          { keys: "Hyper+r", label: "Reconnect" },
          { keys: "leader+b", label: "Toggle navigator" },
          { keys: "Command+Control+Option+Shift+Enter/Space", label: "Activate" },
          { keys: "Cmd+Ctrl+Alt+Return", label: "Submit" },
          { keys: "Super+Meta+Esc", label: "Cancel" },
          { keys: "Tab/Backtab+Backspace", label: "Edit" },
          { keys: "CapsLock+F1/F12+Left/Up/Right/Down", label: "Navigate" },
          { keys: "Hyperdrive+F13+constructor", label: "Control Hyper Space" },
        ]}
      />
    </ThemeProvider>,
    { width: 120, height: 3 },
  );
  try {
    await act(async () => flush());
    const text = textDescendants(renderer.root.findDescendantById("status")!).map(
      (child) => child.plainText,
    );
    expect(text[0]).toBe("HINTS");
    const content = renderer.root.findDescendantById("status-content") as TextRenderable;
    expect(content.plainText.replace(/\s+/g, " ").trim()).toBe(
      [
        `${icons.keyboard} r Reconnect`,
        `${icons.space} b Toggle navigator`,
        `${icons.command} ${icons.control} ${icons.option} ${icons.shift} ${icons.return}/${icons.space} Activate`,
        `${icons.command} ${icons.control} ${icons.option} ${icons.return} Submit`,
        `${icons.command} ${icons.option} ${icons.escape} Cancel`,
        `${icons.tab}/${icons.tabReverse} ${icons.backspace} Edit`,
        `${icons.capsLock} ${icons.f1}/${icons.f12} ${icons.arrowLeft}/${icons.arrowUp}/${icons.arrowRight}/${icons.arrowDown} Navigate`,
        "Hyperdrive F13 constructor Control Hyper Space",
      ].join(" "),
    );
  } finally {
    act(() => renderer.destroy());
  }
});

const longHints = [
  { keys: "Hyper+r", label: "Reconnect to the local daemon" },
  { keys: "leader+n", label: "Create workspace" },
  { keys: "Hyper+q", label: "Quit" },
];

async function renderStatus(props: StatusBarProps) {
  let update!: Dispatch<SetStateAction<StatusBarProps>>;
  function Fixture() {
    const [current, setCurrent] = useState(props);
    update = setCurrent;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box>
          <Box id="outside" focused focusable height={1} />
          <StatusBar {...current} />
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 40, height: 3, kittyKeyboard: true });
  async function settle() {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  await settle();
  return {
    ...setup,
    update,
    settle,
    area: () =>
      setup.renderer.root.findDescendantById("status-scroll:viewport") as ScrollBoxRenderable,
  };
}

test.each(["HINTS", "LEADER", "INFO", "ERROR"] as const)(
  "status content scrolls without moving its badge or focus (%s)",
  async (mode) => {
    const text = "A complete status message with a very long readable ending";
    const props: StatusBarProps =
      mode === "INFO"
        ? { mode, text }
        : { mode, hints: longHints, ...(mode === "ERROR" ? { text } : {}) };
    const setup = await renderStatus(props);
    try {
      const area = setup.area();
      expect(area).toBeDefined();
      const status = setup.renderer.root.findDescendantById("status")!;
      const badge = status.getChildren()[0]!;
      const initialX = badge.screenX;
      const content = setup.renderer.root.findDescendantById("status-content") as TextRenderable;
      await act(async () =>
        setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
      );
      await setup.settle();
      expect(area.scrollLeft).toBeGreaterThan(0);
      expect(badge.width).toBe(9);
      expect(badge.screenX).toBe(initialX);
      expect(status.height).toBe(1);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
      expect(getFocusableRenderables(status)).toEqual([]);
      if (mode === "INFO" || mode === "ERROR") {
        expect(content.plainText).toBe(text);
      } else {
        expect(content.plainText).toContain("Reconnect to the local daemon");
        expect(content.plainText).toContain(
          mode === "LEADER" ? "n Create workspace" : `${icons.space} n Create workspace`,
        );
      }
      act(() => setup.resize(10, 3));
      await setup.settle();
      expect(badge.width).toBe(9);
      expect(status.height).toBe(1);
      expect(setup.renderer.root.findDescendantById("status-scroll:left")?.id).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("status scrolling resets only when displayed values change", async () => {
  const setup = await renderStatus({ mode: "HINTS", hints: longHints });
  async function scroll() {
    const area = setup.area();
    expect(area).toBeDefined();
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    await setup.settle();
    expect(area.scrollLeft).toBeGreaterThan(0);
    return area.scrollLeft;
  }
  try {
    const before = await scroll();
    await act(async () =>
      setup.update({ mode: "HINTS", hints: longHints.map((hint) => ({ ...hint })) }),
    );
    await setup.settle();
    expect(setup.area().scrollLeft).toBe(before);
    await act(async () => setup.update({ mode: "HINTS", hints: [...longHints].reverse() }));
    await setup.settle();
    expect(setup.area().scrollLeft).toBe(0);
    const message = "A text override that remains visible as a complete message";
    await act(async () => setup.update({ mode: "HINTS", hints: longHints, text: message }));
    await setup.settle();
    const overridden = await scroll();
    await act(async () => setup.update({ mode: "HINTS", hints: [], text: message }));
    await setup.settle();
    expect(setup.area().scrollLeft).toBe(overridden);
    for (const props of [
      { mode: "INFO", text: message },
      { mode: "ERROR", text: message, hints: [] },
      { mode: "LEADER", hints: longHints },
    ] satisfies StatusBarProps[]) {
      await act(async () => setup.update(props));
      await setup.settle();
      expect(setup.area().scrollLeft).toBe(0);
      await scroll();
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("leader hints omit the pressed prefix and compact keys without changing descriptions", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <StatusBar
        mode="LEADER"
        hints={[
          { keys: "leader+b", label: "Toggle navigator" },
          { keys: "Leader+n", label: "New item" },
        ]}
      />
    </ThemeProvider>,
    { width: 80, height: 2 },
  );
  try {
    await act(async () => setup.flush());
    const content = setup.renderer.root.findDescendantById("status-content") as TextRenderable;
    expect(content.plainText).toBe("b Toggle navigator  n New item");
    expect(content.plainText).not.toContain(icons.space);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each([
  ["HINTS", "primary"],
  ["LEADER", "warning"],
  ["INFO", "info"],
  ["ERROR", "error"],
] as const)("status modes use themed one-row badges (%s)", async (mode, color) => {
  const theme = {
    ...defaultTheme,
    colors: {
      ...defaultTheme.colors,
      primary: "#010203",
      warning: "#040506",
      info: "#070809",
      error: "#0A0B0C",
      muted: "#0D0E0F",
      focus: "#101112",
      accent: "#131415",
    },
  };
  const setup = await testRender(
    <ThemeProvider theme={theme}>
      <StatusBar
        {...(mode === "INFO"
          ? { mode, text: "Ship navigator" }
          : mode === "ERROR"
            ? { mode, text: "Command failed", hints: [] }
            : { mode, hints: [{ keys: "Enter", label: "Activate" }] })}
      />
    </ThemeProvider>,
    { width: 40, height: 3 },
  );
  try {
    await act(async () => setup.flush());
    const status = setup.renderer.root.findDescendantById("status")!;
    const badge = status.getChildren()[0]!;
    expect(status.height).toBe(1);
    expect((status as BoxRenderable).backgroundColor.toInts()).toEqual(
      parseColor(theme.colors.muted).toInts(),
    );
    expect(badge instanceof BoxRenderable).toBe(true);
    expect((badge as BoxRenderable).backgroundColor.toInts()).toEqual(
      parseColor(theme.colors[color]).toInts(),
    );
    expect(badge.focusable).toBe(false);
    expect(setup.captureCharFrame()).toContain(` ${mode} `);
    const expectedContent =
      mode === "INFO" ? "Ship navigator" : mode === "ERROR" ? "Command failed" : "Activate";
    expect(setup.captureCharFrame()).toContain(expectedContent);
    expect(setup.captureCharFrame()).not.toContain("│");
    const spans = setup.renderer.currentRenderBuffer.getSpanLines()[0]!.spans;
    if (mode === "ERROR") {
      const error = spans.find(({ text }) => text.includes("Command failed"))!;
      expect(error.fg.toInts()).toEqual(parseColor(theme.colors.error).toInts());
    } else if (mode !== "INFO") {
      const action = spans.find(({ text }) => text.includes("Activate"))!;
      expect(action.fg.toInts()).toEqual(parseColor(theme.colors.focus).toInts());
      const key = spans.find(({ text }) => text.includes(icons.return))!;
      expect(key.fg.toInts()).toEqual(
        parseColor(mode === "HINTS" ? theme.colors.primary : theme.colors.accent).toInts(),
      );
    }
    act(() => setup.resize(10, 3));
    await act(async () => setup.flush());
    expect(badge.width).toBe(9);
    expect(setup.captureCharFrame()).toContain(` ${mode} `);
    expect(status.height).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

import { expect, test } from "bun:test";

import { act, useState } from "react";

import { testRender } from "@/tests/support/render";
import { getControlHints } from "@/ui/interaction/control-hints";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";
import { TabBar } from "@/workbench/tab-bar";

async function renderTabs(failed = false) {
  const selectedIds: string[] = [];
  const enteredIds: string[] = [];
  const focusedIds: string[] = [];
  let scrollInteractions = 0;
  let enabled = true;
  let connected!: (value: boolean) => void;
  function Fixture() {
    const [cursor, setCursor] = useState("tab-1");
    const [online, setOnline] = useState(true);
    connected = setOnline;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box>
          <TabBar
            activeId="tab-1"
            cursorId={cursor}
            focused
            failed={failed}
            canReceiveInput={() => enabled}
            entryEnabled={online}
            tabs={Array.from({ length: failed ? 6 : 3 }, (_, index) => ({
              id: `tab-${index + 1}`,
              title: failed ? `Long tab ${index + 1}` : `Tab ${index + 1}`,
              surfaceId: "surface-1",
              position: index,
              layout: null,
            }))}
            onFocus={(id) => {
              focusedIds.push(id);
              setCursor(id);
            }}
            onScrollInteraction={() => scrollInteractions++}
            onActivate={(id) => selectedIds.push(id)}
            onEnter={(id) => enteredIds.push(id)}
          />
          <Box id="other" height={1} focusable />
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: failed ? 30 : 60, height: 8 });
  async function flush() {
    // Stretching triggers measure label minima before the scroller can publish overflow.
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    await act(async () => setup.flush());
  }
  await flush();
  return {
    ...setup,
    flush,
    selectedIds,
    enteredIds,
    focusedIds,
    scrollInteractions: () => scrollInteractions,
    connected,
    disableLive: () => {
      enabled = false;
    },
  };
}

test("browsing selects immediately but only activation requests entry", async () => {
  const setup = await renderTabs();
  try {
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\x1b[C")));
    expect(setup.selectedIds).toEqual(["tab-2", "tab-3"]);
    expect(setup.enteredIds).toEqual([]);
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\r")));
    expect(setup.enteredIds).toEqual(["tab-3"]);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:tabs")!.height).toBe(2);
    expect(getControlHints(setup.renderer.currentFocusedRenderable)).toEqual([
      { keys: "Enter/Space", label: "Enter terminal" },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("click and reclick select and enter requested tab on release", async () => {
  const setup = await renderTabs();
  try {
    const tab = setup.renderer.root.findDescendantById("tab:tab-3")!;
    await act(async () => setup.mockMouse.pressDown(tab.screenX + 1, tab.screenY));
    expect(setup.selectedIds).toEqual([]);
    expect(setup.enteredIds).toEqual([]);
    await act(async () => setup.mockMouse.release(tab.screenX + 1, tab.screenY));
    await setup.flush();
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(setup.selectedIds).toEqual(["tab-3"]);
    expect(setup.enteredIds).toEqual(["tab-3", "tab-3"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("refocus restores authoritative active selection without selecting again", async () => {
  const setup = await renderTabs();
  try {
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.selectedIds).toEqual(["tab-2"]);
    expect(setup.enteredIds).toEqual(["tab-1"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("entry hints remain application-owned after native focus returns to an unchanged candidate", async () => {
  const setup = await renderTabs();
  try {
    act(() => setup.renderer.root.findDescendantById("other")!.focus());
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    expect(getControlHints(setup.renderer.currentFocusedRenderable)).toEqual([
      { keys: "Enter/Space", label: "Enter terminal" },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered refocus then browsing starts from the authoritative tab", async () => {
  const setup = await renderTabs();
  try {
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.flush();
    act(() => {
      setup.renderer.root.findDescendantById("other")!.focus();
      setup.renderer.root.findDescendantById("region:tabs")!.focus();
      setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r"));
    });
    expect(setup.selectedIds).toEqual(["tab-2", "tab-2"]);
    expect(setup.enteredIds).toEqual(["tab-2"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("live input gates block both keyboard and pointer callbacks", async () => {
  const setup = await renderTabs();
  try {
    setup.disableLive();
    const tab = setup.renderer.root.findDescendantById("tab:tab-2")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.selectedIds).toEqual([]);
    expect(setup.enteredIds).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disconnected entry hints and callbacks are omitted while browsing remains local", async () => {
  const setup = await renderTabs();
  try {
    act(() => setup.connected(false));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.selectedIds).toEqual(["tab-2"]);
    expect(setup.enteredIds).toEqual([]);
    expect(getControlHints(setup.renderer.currentFocusedRenderable)).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const pointer of ["wheel", "arrow", "edge arrow"] as const) {
  for (const enabled of [true, false]) {
    test(`contained ${pointer} reports intent only when enabled without focusing or browsing (enabled=${enabled})`, async () => {
      const setup = await renderTabs(true);
      try {
        act(() => setup.renderer.root.findDescendantById("other")!.focus());
        await setup.flush();
        setup.focusedIds.length = 0;
        if (!enabled) {
          setup.disableLive();
        }
        const target = setup.renderer.root.findDescendantById(
          `region:tabs:scroller:${pointer === "wheel" ? "viewport" : pointer === "edge arrow" ? "left" : "right"}`,
        )!;
        if (pointer === "wheel") {
          await act(async () => setup.mockMouse.scroll(target.screenX + 1, target.screenY, "down"));
        } else {
          await act(async () => setup.mockMouse.pressDown(target.screenX, target.screenY));
        }
        expect(setup.scrollInteractions()).toBe(enabled ? 1 : 0);
        expect(setup.focusedIds).toEqual([]);
        expect(setup.selectedIds).toEqual([]);
        expect(setup.enteredIds).toEqual([]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("compact failure indicator stays fixed outside scrolling tab labels", async () => {
  const setup = await renderTabs(true);
  try {
    const indicator = setup.renderer.root.findDescendantById("tab-error")!;
    expect(indicator.screenX).toBe(29);
    await act(async () => setup.mockInput.pressKey("END"));
    await setup.flush();
    expect(indicator.screenX).toBe(29);
    expect(setup.captureCharFrame()).toContain("!");
    expect(setup.captureCharFrame()).toContain("Long tab 6");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

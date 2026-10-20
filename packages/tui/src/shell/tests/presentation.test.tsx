import { expect, test } from "bun:test";

import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  parseColor,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { type Command } from "@work-craft/server/client";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { calculateShellLayout } from "@/shell/layout.ts";
import { SessionSwitcher } from "@/shell/session-switcher.tsx";
import { WorkCraftShell } from "@/shell/shell.tsx";
import { StatusBar } from "@/shell/status-bar.tsx";
import {
  liveInputFixture,
  openFixtureItem,
  splitSurfaceSnapshot,
  statusText,
  surfaceSnapshot,
  testRender,
  workCraftStateFixture,
} from "@/shell/tests/fixtures";
import { WorkspaceBar } from "@/shell/workspace-bar.tsx";
import { snapshotFixture } from "@/tests/support/fixtures.ts";
import { Box } from "@/ui/primitives/box.tsx";
import type { Theme } from "@/ui/theming/theme";
import { ThemeProvider } from "@/ui/theming/theme-provider.tsx";
import { defaultTheme } from "@/ui/theming/themes/default.ts";
import { draculaTheme } from "@/ui/theming/themes/dracula.ts";
import { paneIds } from "@/workbench/layout.ts";

for (const direction of ["single", "horizontal", "vertical"] as const) {
  for (const stopped of [false, true]) {
    test(`restyled ${direction} ${stopped ? "stopped" : "running"} layout keeps native geometry above the final status row`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.tabs[0]!.layout =
        direction === "single"
          ? { type: "pane", paneId: "pane-1" }
          : {
              ...initial.tabs[0]!.layout!,
              type: "split",
              direction,
              ratio: 0.5,
              first: { type: "pane", paneId: "pane-1" },
              second: { type: "pane", paneId: "pane-2" },
            };
      if (stopped) {
        initial.panes.forEach((pane) => {
          pane.processStatus = "exited";
        });
      }
      const setup = await liveInputFixture(initial);
      await setup.publish({ ...initial, revision: 5, categories: snapshotFixture().categories });
      const original = setup.renderer.root.findDescendantById("terminal:pane-1")!;
      function assertLayout(width: number, height: number, navigatorOpen: boolean): void {
        const root = setup.renderer.root;
        const header = root.findDescendantById("shell-header")!;
        const status = root.findDescendantById("status")!;
        expect([status.screenY, status.height]).toEqual([height - 1, 1]);
        expect([header.screenY, header.getLayout().height]).toEqual([0, Math.min(3, height - 1)]);
        expect(header.visible).toBe(height > 1);
        const body = root.findDescendantById("region:category")!.parent!;
        expect(body.getLayout().height).toBe(Math.max(0, height - 4));
        if (height > 4) {
          expect(body.screenY).toBe(3);
        }
        expect(body.visible).toBe(height > 4);
        const line = setup.captureSpans().lines[height - 1]!;
        const badge = line.spans.find(({ text }) => /HINTS|INFO/.test(text));
        expect(badge).toBeDefined();
        expect(badge!.bg.toInts()).toEqual(
          parseColor(
            defaultTheme.colors[badge!.text.includes("INFO") ? "info" : "primary"],
          ).toInts(),
        );
        expect(line.spans.map(({ text }) => text).join("")).not.toContain("Reactivate");
        const layout = calculateShellLayout({
          terminalWidth: width,
          terminalHeight: height,
          navigatorOpen,
          preferredNavigatorWidth: 45,
          paneLayout: initial.tabs[0]!.layout,
          panes: initial.panes,
          connected: true,
        });
        if (!layout.undersized) {
          for (const node of layout.focusNodes.filter(
            ({ target }) => target.region === "workbench",
          )) {
            if (node.target.region !== "workbench") {
              continue;
            }
            const rendered = root.findDescendantById(
              `${node.target.control ? "reactivate" : "terminal"}:${node.target.paneId}`,
            )!;
            expect({
              x: rendered.screenX,
              y: rendered.screenY,
              width: rendered.width,
              height: rendered.height,
            }).toEqual(node.rect);
          }
          for (const id of paneIds(initial.tabs[0]!.layout)) {
            const terminal = root.findDescendantById(`terminal:${id}`)!;
            const pane = terminal.parent!;
            expect(terminal.screenY).toBe(pane.screenY + 1);
            expect(terminal.screenY + terminal.height).toBeLessThanOrEqual(
              pane.screenY + pane.height,
            );
            const alert = root.findDescendantById(`pane-alert:${id}`);
            if (alert) {
              expect(alert.screenY).toBe(terminal.screenY + terminal.height);
              expect(alert.screenY + alert.height).toBe(pane.screenY + pane.height);
            }
            expect(pane.screenY + pane.height).toBeLessThanOrEqual(status.screenY);
          }
        }
        expect(root.findDescendantById("terminal:pane-1")).toBe(original);
      }
      try {
        assertLayout(120, 40, true);
        const first = setup.renderer.root.findDescendantById("terminal:pane-1")!;
        expect([first.screenX, first.screenY, first.width, first.height]).toEqual(
          direction === "single"
            ? [51, 6, 68, stopped ? 30 : 33]
            : direction === "vertical"
              ? [51, 6, 34, stopped ? 30 : 33]
              : [51, 6, 68, stopped ? 13 : 16],
        );
        let navigatorOpen = true;
        for (const [width, height] of [
          [120, 20],
          [100, 20],
          [79, 20],
          [120, 8],
          [120, 6],
          [120, 4],
          [120, 2],
          [120, 1],
          [120, 40],
        ] as const) {
          if (width < 120) {
            navigatorOpen = false;
          }
          act(() => setup.resize(width, height));
          await setup.flush();
          assertLayout(width, height, navigatorOpen);
        }
        act(() => setup.resize(100, 20));
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        await setup.flush();
        assertLayout(100, 20, true);
        const drawer = setup.renderer.root.findDescendantById("navigator-controls")!;
        expect(drawer.screenY + drawer.height).toBeLessThanOrEqual(19);
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        await setup.flush();
        assertLayout(100, 20, true);
        const dialog = setup.renderer.root.findDescendantById("dialog")!.parent!;
        expect(dialog.screenY + dialog.height).toBeLessThanOrEqual(19);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("a captured Reactivate cannot use a footer clipped by a same-batch height shrink", async () => {
  const initial = splitSurfaceSnapshot();
  initial.tabs[0]!.layout = {
    type: "split",
    direction: "horizontal",
    ratio: 4 / 33,
    first: { type: "pane", paneId: "pane-2" },
    second: { type: "pane", paneId: "pane-1" },
  };
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    expect(button.focusable).toBe(true);
    act(() => button.focus());
    await setup.flush();
    await act(async () => {
      setup.resize(120, 32);
      setup.mockInput.pressEnter();
    });
    await setup.flush();
    expect(button.focusable).toBe(false);
    expect(setup.commands.filter(({ type }) => type === "process.restart")).toEqual([]);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("resize guard blocks same-buffer terminal bytes and keeps dialog input mounted above status", async () => {
  const sent: Uint8Array[] = [];
  const workCraft = workCraftStateFixture({
    snapshot: surfaceSnapshot(),
    stream: {
      sendInput: (_id, data) => {
        sent.push(data);
      },
      resize() {},
      close() {},
    },
  });
  const setup = await testRender(<WorkCraftShell workCraft={workCraft} />, {
    width: 120,
    height: 30,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    act(() => {
      setup.resize(64, 30);
      setup.mockInput.typeText("blocked");
      setup.mockInput.pressEscape();
    });
    await setup.flush();
    expect(sent).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Please resize your terminal");
    expect(setup.captureCharFrame()).toContain(
      "Work Craft requires at least 80 columns. Current width: 64.",
    );
    expect(setup.renderer.root.findDescendantById("resize-guard")?.height).toBe(29);
    act(() => setup.resize(120, 30));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("session:search");
    act(() => {
      setup.resize(79, 30);
      setup.mockInput.pressEscape();
    });
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("session:search") === input).toBe(true);
    act(() => setup.resize(80, 30));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("dialog") !== undefined).toBe(true);
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("navigator stops above the status bar", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  const navigator = setup.renderer.root.findDescendantById("region:navigator")!;
  const status = setup.renderer.root.findDescendantById("status")!;
  expect(navigator.y + navigator.height).toBeLessThanOrEqual(status.y);
  act(() => setup.renderer.destroy());
});

test("navigator stays unmounted when fewer than two rows are available", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  for (const height of [1, 2, 3, 4]) {
    act(() => setup.resize(120, height));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  }
  act(() => setup.renderer.destroy());
});

test("size-hiding a focused navigator returns focus to the category rail", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 119,
    height: 20,
    kittyKeyboard: true,
  });
  await setup.flush();
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("HINTS");

  act(() => setup.resize(119, 4));
  await setup.flush();
  act(() => setup.resize(119, 20));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("HINTS");
  act(() => setup.renderer.destroy());
});

test("theme changes preserve workbench identity, focus, hints and status geometry", async () => {
  const snapshot = splitSurfaceSnapshot();
  snapshot.panes[1]!.processStatus = "exited";
  const commands: Command[] = [];
  const received: { paneId: string; bytes: number[] }[] = [];
  const workCraft = workCraftStateFixture({
    snapshot,
    command: async (command) => {
      commands.push(command);
      return { ok: true, revision: snapshot.revision, result: { id: "result-1" } };
    },
    stream: {
      close: () => {},
      resize: () => {},
      sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
    },
  });
  let changeTheme: Dispatch<SetStateAction<Theme>>;
  function Fixture() {
    const [theme, setTheme] = useState<Theme>(defaultTheme);
    changeTheme = setTheme;
    return (
      <ThemeProvider theme={theme}>
        <WorkCraftShell workCraft={workCraft} />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    const root = setup.renderer.root;
    const terminal = root.findDescendantById("terminal:pane-1")!;
    const stoppedTerminal = root.findDescendantById("terminal:pane-2")!;
    expect(terminal).toBeInstanceOf(EmbeddedTerminalRenderable);
    expect(stoppedTerminal).toBeInstanceOf(EmbeddedTerminalRenderable);
    const previousHints = statusText(setup);
    const commandCount = commands.length;
    function assertPalette(theme: Theme, modal = false): void {
      const header = root.findDescendantById("shell-header") as BoxRenderable;
      const strip = root.findDescendantById("region:tabs") as BoxRenderable;
      const status = root.findDescendantById("status") as BoxRenderable;
      const alert = root.findDescendantById("pane-alert:pane-2") as BoxRenderable;
      const button = root.findDescendantById("reactivate:pane-2") as BoxRenderable;
      expect([status.screenY, status.height]).toEqual([39, 1]);
      expect(header.backgroundColor.toInts()).toEqual(parseColor(theme.colors.background).toInts());
      expect(strip.backgroundColor.toInts()).toEqual(parseColor(theme.colors.background).toInts());
      expect(status.backgroundColor.toInts()).toEqual(parseColor(theme.colors.muted).toInts());
      expect((alert.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
        parseColor(theme.colors.warning).toInts(),
      );
      expect(button.backgroundColor.toInts()).toEqual(
        parseColor(theme.colors[modal ? "muted" : "warning"]).toInts(),
      );
      expect((button.getChildren()[0] as TextRenderable).fg.toInts()).toEqual(
        parseColor(theme.colors[modal ? "mutedForeground" : "background"]).toInts(),
      );
      const badge = setup
        .captureSpans()
        .lines[39]!.spans.find(({ text }) => text.includes("HINTS"))!;
      expect(badge.bg.toInts()).toEqual(parseColor(theme.colors.primary).toInts());
      expect(root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(root.findDescendantById("terminal:pane-2")).toBe(stoppedTerminal);
      expect(commands.slice(commandCount)).toEqual([]);
      expect(received).toEqual([]);
    }
    for (const theme of [defaultTheme, draculaTheme, defaultTheme]) {
      act(() => changeTheme(theme));
      await setup.flush();
      assertPalette(theme);
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
      expect(terminal.focused).toBe(true);
      expect(statusText(setup)).toBe(previousHints);
    }
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const search = root.findDescendantById("session:search")!;
    expect(setup.renderer.currentFocusedRenderable).toBe(search);
    const dialogHints = statusText(setup);
    for (const theme of [draculaTheme, defaultTheme]) {
      act(() => changeTheme(theme));
      await setup.flush();
      assertPalette(theme, true);
      expect(root.findDescendantById("session:search")).toBe(search);
      expect(setup.renderer.currentFocusedRenderable).toBe(search);
      expect(statusText(setup)).toBe(dialogHints);
      const overlay = root.findDescendantById("dialog")!.parent!;
      expect(overlay.screenY + overlay.height).toBeLessThanOrEqual(39);
    }
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    assertPalette(defaultTheme);
    expect(root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
    expect(statusText(setup)).toBe(previousHints);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("horizontal pointer scrolling preserves terminal identity and subsequent input", async () => {
  const snapshot = surfaceSnapshot();
  snapshot.workspaces = snapshot.workspaces.map((workspace) => ({
    ...workspace,
    name: `${workspace.name} with a complete very long workspace label`,
  }));
  const received: { paneId: string; bytes: number[] }[] = [];
  const workCraft = workCraftStateFixture({
    snapshot,
    connectionError: "Connection detail ".repeat(10),
    stream: {
      close: () => {},
      resize: () => {},
      sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
    },
  });
  let changeTheme: Dispatch<SetStateAction<Theme>>;
  function Fixture() {
    const [theme, setTheme] = useState<Theme>(defaultTheme);
    changeTheme = setTheme;
    return (
      <ThemeProvider theme={theme}>
        <WorkCraftShell workCraft={workCraft} />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    const category = setup.renderer.root.findDescendantById("category:implementation")!;
    await act(async () => setup.mockMouse.click(category.screenX + 1, category.screenY));
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["j", "\r"]));
    await setup.flush();
    await setup.flush();
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    act(() => terminal.focus());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(terminal.id);
    for (const id of ["workspace-scroll", "status-scroll"]) {
      const area = setup.renderer.root.findDescendantById(`${id}:viewport`) as ScrollBoxRenderable;
      expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
      await act(async () =>
        setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
      );
      const right = setup.renderer.root.findDescendantById(`${id}:right`)!;
      await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
      await setup.flush();
      expect(area.scrollLeft).toBeGreaterThan(0);
      expect(setup.renderer.currentFocusedRenderable === terminal).toBe(true);
      expect(setup.renderer.root.findDescendantById(terminal.id) === terminal).toBe(true);
      expect(
        (
          setup.renderer.root.findDescendantById("workspace:workspace-shared") as BoxRenderable
        ).backgroundColor.toInts(),
      ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    }
    const offsets = ["workspace-scroll", "status-scroll"].map((id) => {
      const area = setup.renderer.root.findDescendantById(`${id}:viewport`) as ScrollBoxRenderable;
      return { id, area, scrollLeft: area.scrollLeft };
    });
    act(() => changeTheme(draculaTheme));
    await setup.flush();
    for (const { id, area, scrollLeft } of offsets) {
      expect(setup.renderer.root.findDescendantById(`${id}:viewport`)).toBe(area);
      expect(area.scrollLeft).toBe(scrollLeft);
    }
    expect(setup.renderer.root.findDescendantById(terminal.id)).toBe(terminal);
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:workspace-shared") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(draculaTheme.colors.foreground).toInts());
    await act(async () => setup.mockInput.pressKey("x"));
    await act(async () => setup.mockInput.pressTab());
    expect(received).toEqual([
      { paneId: "pane-1", bytes: [120] },
      { paneId: "pane-1", bytes: [9] },
    ]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("overflowing header keeps Tab and leader priority", async () => {
  const snapshot = workCraftStateFixture().snapshot!;
  snapshot.workspaces = snapshot.workspaces.map((workspace) => ({
    ...workspace,
    name: `${workspace.name} with a complete very long workspace label`,
  }));
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 80, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("workspace-scroll:right")?.id).toBe(
      "workspace-scroll:right",
    );
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressKeys(["\x00\t"]));
    await setup.flush();
    expect(statusText(setup)).toContain("Invalid leader key: tab");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered header refocus reveals the selected workspace without a prop change", async () => {
  const snapshot = workCraftStateFixture().snapshot!;
  snapshot.workspaces = snapshot.workspaces.map((workspace) => ({
    ...workspace,
    name: `${workspace.name} with a complete very long workspace label`,
  }));
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 80, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await setup.flush();
    const area = setup.renderer.root.findDescendantById(
      "workspace-scroll:viewport",
    ) as ScrollBoxRenderable;
    const right = setup.renderer.root.findDescendantById("workspace-scroll:right")!;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await setup.flush();
    expect(area.scrollLeft).toBeGreaterThan(0);
    await act(async () => setup.mockInput.pressKeys(["\t\x1b[Z"]));
    await setup.flush();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    expect(area.scrollLeft).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("minimum workbench size reserves the pane top border", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  act(() => setup.resize(120, 8));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Workbench too");
  expect(setup.captureCharFrame()).toContain("small.");
  act(() => setup.renderer.destroy());
});

test("narrow shell shows invalid leader feedback", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 80,
    height: 20,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("x"));
  await setup.flush();
  expect(setup.captureCharFrame()).toMatch(/Invalid.leader.key:.x/);
  act(() => setup.renderer.destroy());
});

test("compact navigator status exposes the full cursor label", async () => {
  const setup = await testRender(<StatusBar mode="INFO" text="Ship navigator" />, {
    width: 40,
    height: 2,
  });
  await setup.flush();
  expect(setup.captureCharFrame().trim().replace(/\s+/g, " ")).toBe("INFO Ship navigator");
  act(() => setup.renderer.destroy());
});

test("shell regions use semantic colors from the active theme", async () => {
  const theme = {
    ...defaultTheme,
    name: "semantic-test",
    colors: {
      ...defaultTheme.colors,
      foreground: "#010203",
      mutedForeground: "#040506",
      primary: "#070809",
      success: "#0A0B0C",
      border: "#0D0E0F",
    },
  };
  const setup = await testRender(
    <ThemeProvider theme={theme}>
      <Box>
        <WorkspaceBar
          activeId="active"
          focused
          workspaces={[
            { id: "active", name: "Active" },
            { id: "cursor", name: "Cursor" },
            { id: "muted", name: "Muted" },
          ]}
          onActivate={() => {}}
        />
        <SessionSwitcher focused={false} name="Work" status="connected" onOpen={() => {}} />
      </Box>
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  await setup.flush();

  await act(async () => setup.mockInput.pressKey("l"));
  await setup.flush();
  expect(
    (
      setup.renderer.root.findDescendantById("workspace:active")!.getChildren()[0] as TextRenderable
    ).fg.toInts(),
  ).toEqual(parseColor(theme.colors.background).toInts());
  expect(
    (
      setup.renderer.root.findDescendantById("workspace:cursor")!.getChildren()[0] as TextRenderable
    ).fg.toInts(),
  ).toEqual(parseColor(theme.colors.foreground).toInts());
  expect(
    (
      setup.renderer.root.findDescendantById("workspace:muted")!.getChildren()[0] as TextRenderable
    ).fg.toInts(),
  ).toEqual(parseColor(theme.colors.focus).toInts());
  expect(
    (setup.renderer.root.findDescendantById("connection-status") as TextRenderable).fg.toInts(),
  ).toEqual([10, 11, 12, 255]);
  act(() => setup.renderer.destroy());
});

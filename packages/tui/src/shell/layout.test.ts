import { expect, test } from "bun:test";

import { calculateShellLayout, resizeNavigatorWidth } from "@/shell/layout.ts";

test("79/80/119/120 select guard, drawer and docking without subtracting drawer width", () => {
  for (const [width, mode, blocked] of [
    [79, "hidden", true],
    [80, "drawer", false],
    [119, "drawer", false],
    [120, "docked", false],
  ] as const) {
    const layout = calculateShellLayout({
      terminalWidth: width,
      terminalHeight: 30,
      navigatorOpen: true,
      preferredNavigatorWidth: 32,
      paneLayout: null,
    });
    expect(layout.navigatorMode).toBe(mode);
    expect(layout.resizeBlocked).toBe(blocked);
    expect(layout.workbenchWidth).toBe(width - 5 - (mode === "docked" ? 32 : 0));
  }
});

test("zero/tiny geometry and extreme preferred widths stay nonnegative and bounded", () => {
  for (const width of [0, 1, 79, 80, 120, 160]) {
    for (const height of [0, 1, 2, 3, 10]) {
      for (const preferredNavigatorWidth of [-100, 0, 32, 10000]) {
        const layout = calculateShellLayout({
          terminalWidth: width,
          terminalHeight: height,
          navigatorOpen: true,
          preferredNavigatorWidth,
          paneLayout: { type: "pane", paneId: "p" },
        });
        expect(layout.workbenchWidth).toBeGreaterThanOrEqual(0);
        expect(layout.navigatorWidth).toBeLessThanOrEqual(width);
        for (const node of layout.focusNodes) {
          expect(node.rect.width).toBeGreaterThanOrEqual(0);
          expect(node.rect.height).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }
  expect(resizeNavigatorWidth(32, 1, 160)).toBe(33);
});

test("pane focus rectangles reserve three header rows, two strip rows and the pane top border", () => {
  const input = {
    terminalWidth: 120,
    terminalHeight: 30,
    navigatorOpen: true,
    preferredNavigatorWidth: 32,
    paneLayout: {
      type: "split" as const,
      direction: "vertical" as const,
      ratio: 0.5,
      first: { type: "pane" as const, paneId: "a" },
      second: { type: "pane" as const, paneId: "b" },
    },
  };
  expect(
    calculateShellLayout(input).focusNodes.filter(({ target }) => target.region === "workbench"),
  ).toEqual([
    { target: { region: "workbench", paneId: "a" }, rect: { x: 38, y: 6, width: 40, height: 23 } },
    { target: { region: "workbench", paneId: "b" }, rect: { x: 79, y: 6, width: 40, height: 23 } },
  ]);
  expect(calculateShellLayout(input).workbenchContent).toEqual({
    x: 38,
    y: 5,
    width: 81,
    height: 24,
  });
  expect(
    calculateShellLayout(input).focusNodes.find(({ target }) => target.region === "tabs")!.rect,
  ).toEqual({ x: 37, y: 3, width: 83, height: 2 });
});

test("pane geometry retains undersized leaves as movement origins", () => {
  const layout = calculateShellLayout({
    terminalWidth: 120,
    terminalHeight: 30,
    navigatorOpen: false,
    preferredNavigatorWidth: 32,
    paneLayout: {
      type: "split",
      direction: "vertical",
      ratio: 0.1,
      first: { type: "pane", paneId: "tiny" },
      second: { type: "pane", paneId: "usable" },
    },
  });
  expect(layout.focusNodes.filter(({ target }) => target.region === "workbench")).toEqual([
    {
      target: { region: "workbench", paneId: "tiny" },
      rect: { x: 6, y: 6, width: 11, height: 23 },
    },
    {
      target: { region: "workbench", paneId: "usable" },
      rect: { x: 18, y: 6, width: 101, height: 23 },
    },
  ]);
});

test("borderless workbench preserves the actual 60 by 5 terminal minimum below its top border", () => {
  for (const [width, height, undersized, contentHeight] of [
    [67, 12, false, 6],
    [66, 12, true, 6],
    [67, 11, true, 5],
  ] as const) {
    const layout = calculateShellLayout({
      terminalWidth: width,
      terminalHeight: height,
      navigatorOpen: false,
      preferredNavigatorWidth: 32,
      paneLayout: null,
    });
    expect(layout.undersized).toBe(undersized);
    expect(layout.workbenchContent.height).toBe(contentHeight);
  }
});
test("exited action geometry occupies the footer interior, not the unavailable PTY rectangle", () => {
  const input = {
    terminalWidth: 120,
    terminalHeight: 40,
    navigatorOpen: false,
    preferredNavigatorWidth: 32,
    paneLayout: { type: "pane" as const, paneId: "p" },
    panes: [
      {
        id: "p",
        surfaceId: "s",
        kind: "terminal" as const,
        title: "Shell",
        cwd: "/tmp",
        restorePolicy: { type: "shell" as const, executable: "/bin/sh", args: [] },
        processStatus: "exited" as const,
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  };
  expect(
    calculateShellLayout(input).focusNodes.filter(({ target }) => target.region === "workbench"),
  ).toEqual([
    { target: { region: "workbench", paneId: "p" }, rect: { x: 6, y: 6, width: 113, height: 30 } },
    {
      target: { region: "workbench", paneId: "p", control: "reactivate" },
      rect: { x: 105, y: 37, width: 12, height: 1 },
    },
  ]);
  expect(
    calculateShellLayout({ ...input, connected: false }).focusNodes.some(
      ({ target }) => target.region === "workbench" && target.control === "reactivate",
    ),
  ).toBe(false);
});

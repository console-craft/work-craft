import { expect, test } from "bun:test";

import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import type { LayoutNode, Snapshot } from "@work-craft/server/client";
import { act, type ReactNode, useState } from "react";

import { snapshotTerminals } from "@/client/terminal-buffer";
import {
  snapshotFixture,
  streamFixture,
  terminalBufferFixture,
  terminalSnapshotFixture,
} from "@/tests/support/fixtures.ts";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender as renderWithoutTheme } from "@/tests/support/render";
import { Box } from "@/ui/primitives/box.tsx";
import { ThemeProvider } from "@/ui/theming/theme-provider.tsx";
import { defaultTheme } from "@/ui/theming/themes/default.ts";
import {
  SurfaceView as NativeSurfaceView,
  type SurfaceViewProps,
  terminalPaneKey,
} from "@/workbench/surface-view.tsx";
import { Workbench } from "@/workbench/workbench.tsx";

extend({ terminal: EmbeddedTerminalRenderable });

function SurfaceView(
  props: Omit<SurfaceViewProps, "activeTabId"> & { activeTabId?: string | null },
) {
  const snapshot = terminalSnapshotFixture(props.snapshot);
  return (
    <NativeSurfaceView
      {...props}
      snapshot={snapshot}
      activeTabId={
        props.activeTabId === undefined
          ? (snapshot.navigation[0]?.tabId ?? null)
          : props.activeTabId
      }
      terminals={snapshotTerminals(snapshot, props.terminals)}
    />
  );
}

test("a missing authoritative tab renders empty rather than entering a fallback terminal", async () => {
  const snapshot = surfaceSnapshot();
  const setup = await testRender(
    <SurfaceView
      {...recoveryProps}
      snapshot={snapshot}
      surface={snapshot.surfaces[0]!}
      activeTabId="missing"
      stream={null}
      terminals={new Map()}
      focusedPaneId={null}
      workbenchFocused={false}
      undersized={false}
      onFocusPane={() => {}}
      onTerminalReady={() => {}}
    />,
    { width: 80, height: 24 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("No terminal panes");
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

const recoveryProps = {
  stamp: {
    epoch: "epoch-a",
    attachmentGeneration: 1,
    navigationGeneration: 1,
    geometrySequence: 0,
  },
  canRespond: () => false,
  inputEvent: () => ({ kind: "key" as const }),
  onMouseInput: () => {},
  onResync: () => {},
  connected: true,
  reactivatingPaneIds: new Set<string>(),
  canReactivate: () => true,
  onReactivatePane: (_paneId: string) => {},
};

async function testRender(node: ReactNode, options: Parameters<typeof renderWithoutTheme>[1]) {
  const setup = await renderWithoutTheme(
    <ThemeProvider theme={defaultTheme}>{node}</ThemeProvider>,
    options,
  );
  return {
    ...setup,
    flush: () => flushMeasured(setup),
  };
}

function surfaceSnapshot(): Snapshot {
  return snapshotFixture({
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
    categories: [
      {
        workspaceId: "workspace-shared",
        kind: "implementation",
        title: "Implementation",
        position: 0,
      },
    ],
    navigation: [
      {
        ...snapshotFixture().navigation[0]!,
        generation: 1,
        category: "implementation",
        itemId: "item-1",
        tabId: "tab-1",
        paneId: "pane-1",
      },
    ],
    surfaces: [{ id: "surface-1", itemId: "item-1" }],
    tabs: [
      {
        id: "tab-1",
        surfaceId: "surface-1",
        title: "Shell",
        position: 0,
        layout: { type: "pane", paneId: "pane-1" },
      },
    ],
    panes: [
      {
        id: "pane-1",
        surfaceId: "surface-1",
        kind: "terminal",
        title: "Shell",
        cwd: "/tmp",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "running",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  });
}

function splitSurfaceSnapshot(direction: "horizontal" | "vertical"): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    tabs: [
      {
        ...snapshot.tabs[0]!,
        layout: {
          type: "split",
          direction,
          ratio: 0.5,
          first: { type: "pane", paneId: "pane-1" },
          second: { type: "pane", paneId: "pane-2" },
        },
      },
    ],
    panes: [{ ...snapshot.panes[0]! }, { ...snapshot.panes[0]!, id: "pane-2" }],
  };
}

test("terminal renderer identity includes the daemon epoch and replay cursor", () => {
  expect(terminalPaneKey("pane-1", undefined)).toBe("pane-1:pending:0");
  expect(terminalPaneKey("pane-1", { epoch: "epoch-2", historyCursor: 42 })).toBe(
    "pane-1:epoch-2:42",
  );
});

for (const source of ["history", "chunks"] as const) {
  for (const { width, height, row } of [
    { width: 120, height: 30, row: 0 },
    { width: 80, height: 25, row: 0 },
    { width: 120, height: 45, row: 29 },
  ]) {
    test(`${source}: tab switching preserves prompt coordinates in a ${width}x${height} host`, async () => {
      const snapshot = surfaceSnapshot();
      snapshot.tabs.push({
        ...snapshot.tabs[0]!,
        id: "tab-2",
        position: 1,
        layout: { type: "pane", paneId: "pane-2" },
      });
      snapshot.panes.push({ ...snapshot.panes[0]!, id: "pane-2" });
      const size = { cols: width, rows: height - 1 };
      snapshot.geometry.panes = snapshot.panes.map(({ id }) => ({ paneId: id, size }));
      const output = new TextEncoder().encode(
        `\x1b[2J\x1b[${row + 1};1HLEFT\x1b[${width - 10}GRIGHT\r\n$ `,
      );
      let activate!: (id: string) => void;
      let deliver!: () => void;
      function Fixture() {
        const [tabId, setTabId] = useState("tab-1");
        const [delivered, setDelivered] = useState(source === "history");
        activate = setTabId;
        deliver = () => setDelivered(true);
        return (
          <SurfaceView
            {...recoveryProps}
            snapshot={snapshot}
            surface={snapshot.surfaces[0]!}
            activeTabId={tabId}
            stream={null}
            terminals={
              new Map([
                [
                  "pane-1",
                  terminalBufferFixture({
                    epoch: snapshot.epoch,
                    initialSize: size,
                    history: source === "history" ? output : new Uint8Array(),
                    historyCursor: source === "history" ? output.byteLength : 0,
                    chunks:
                      source === "chunks" && delivered
                        ? [
                            {
                              cursor: output.byteLength,
                              data: output,
                              geometrySequence: 0,
                              origin: "live",
                            },
                          ]
                        : [],
                  }),
                ],
              ])
            }
            focusedPaneId={tabId === "tab-1" ? "pane-1" : "pane-2"}
            workbenchFocused
            undersized={false}
            onFocusPane={() => {}}
            onTerminalReady={() => {}}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width, height });
      function screen() {
        return (
          setup.renderer.root.findDescendantById("terminal:pane-1") as EmbeddedTerminalRenderable
        ).screen();
      }
      try {
        await setup.flush();
        act(deliver);
        await setup.flush();
        expect((screen().lines[row] ?? "").indexOf("RIGHT")).toBe(width - 11);
        expect(screen().cursor).toMatchObject({ x: 2, y: row + 1 });
        act(() => activate("tab-2"));
        await setup.flush();
        act(() => activate("tab-1"));
        await setup.flush();
        expect((screen().lines[row] ?? "").indexOf("RIGHT")).toBe(width - 11);
        expect(screen().cursor).toMatchObject({ x: 2, y: row + 1 });
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  test(`${direction}: inserting and equalizing splits retains every existing terminal object`, async () => {
    const snapshot = surfaceSnapshot();
    const sourceReadyEvents: (EmbeddedTerminalRenderable | null)[] = [];
    const ready = (id: string, terminal: EmbeddedTerminalRenderable | null) => {
      if (id === "pane-1") {
        sourceReadyEvents.push(terminal);
      }
    };
    const buffer = terminalBufferFixture({
      epoch: snapshot.epoch,
      history: new TextEncoder().encode("retained sentinel\r\n"),
      historyCursor: 19,
      chunks: [],
    });
    let publish!: (value: Snapshot) => void;
    let present!: (value: {
      width: number;
      height: number;
      undersized: boolean;
      covered: boolean;
    }) => void;
    const sent: string[] = [];
    const resized: string[] = [];
    function Fixture() {
      const [current, setCurrent] = useState(snapshot);
      const [size, setSize] = useState({
        width: 100,
        height: 40,
        undersized: false,
        covered: false,
      });
      publish = setCurrent;
      present = setSize;
      return (
        <Box width={size.width} height={size.height}>
          <SurfaceView
            {...recoveryProps}
            snapshot={current}
            surface={current.surfaces[0]!}
            stream={streamFixture({
              close() {},
              sendInput: (id) => sent.push(id),
            })}
            terminals={new Map([["pane-1", buffer]])}
            focusedPaneId="pane-1"
            workbenchFocused
            undersized={size.undersized}
            canReceiveInput={() => !size.covered}
            onFocusPane={() => {}}
            onTerminalReady={ready}
          />
        </Box>
      );
    }
    const setup = await testRender(<Fixture />, { width: 100, height: 40 });
    try {
      await setup.flush();
      const root = setup.renderer.root;
      const sourceTerminal = root.findDescendantById(
        "terminal:pane-1",
      ) as EmbeddedTerminalRenderable;
      const sourceHost = sourceTerminal.parent;
      const split = splitSurfaceSnapshot(direction);
      act(() => publish(split));
      await setup.flush();
      expect(root.findDescendantById("terminal:pane-1")).toBe(sourceTerminal);
      const secondTerminal = root.findDescendantById("terminal:pane-2")!;
      const inner: LayoutNode = {
        type: "split",
        direction: direction === "vertical" ? "horizontal" : "vertical",
        ratio: 0.5,
        first: { type: "pane", paneId: "pane-1" },
        second: { type: "pane", paneId: "pane-3" },
      };
      const nested: LayoutNode = {
        type: "split",
        direction,
        ratio: 0.5,
        first: inner,
        second: { type: "pane", paneId: "pane-2" },
      };
      const withThirdPane = {
        ...split,
        tabs: [{ ...split.tabs[0]!, layout: nested }],
        panes: [...split.panes, { ...split.panes[0]!, id: "pane-3" }],
      };
      act(() => publish(withThirdPane));
      await setup.flush();
      const thirdTerminal = root.findDescendantById("terminal:pane-3")!;
      act(() =>
        publish({
          ...withThirdPane,
          tabs: [
            {
              ...split.tabs[0]!,
              layout: {
                ...nested,
                ratio: 0.6,
                first: { ...inner, ratio: 0.3 },
              },
            },
          ],
        }),
      );
      await setup.flush();
      for (const size of [
        { width: 0, height: 0, undersized: false, covered: false },
        { width: 10, height: 3, undersized: false, covered: false },
        { width: 100, height: 40, undersized: true, covered: false },
        { width: 100, height: 40, undersized: false, covered: true },
        { width: 90, height: 36, undersized: false, covered: false },
      ]) {
        act(() => present(size));
        await setup.flush();
        expect(root.findDescendantById("terminal:pane-1")).toBe(sourceTerminal);
        expect(sourceTerminal.parent).toBe(sourceHost);
        expect(root.findDescendantById("terminal:pane-2")).toBe(secondTerminal);
        expect(root.findDescendantById("terminal:pane-3")).toBe(thirdTerminal);
        if (size.width < 20 || size.undersized || size.covered) {
          expect(sourceTerminal.focusable).toBe(false);
          sent.length = 0;
          resized.length = 0;
          sourceTerminal.onData!(Uint8Array.of(65), "input");
          sourceTerminal.onData!(Uint8Array.of(66), "response");
          expect(sent).toEqual([]);
          expect(resized).toEqual([]);
        }
        if (size.width >= 20 && !size.undersized) {
          expect([sourceTerminal.width, sourceTerminal.height]).toEqual([80, 24]);
        }
      }
      expect(sourceTerminal.screen().text).toContain("retained sentinel");
      expect(sourceReadyEvents.filter((value) => value === null)).toHaveLength(0);
      // Hand-derived rectangles for a 90x36 host after both ratios change.
      expect([
        sourceTerminal.screenX,
        sourceTerminal.screenY,
        sourceTerminal.width,
        sourceTerminal.height,
      ]).toEqual([0, 1, 80, 24]);
      expect([
        secondTerminal.screenX,
        secondTerminal.screenY,
        secondTerminal.width,
        secondTerminal.height,
      ]).toEqual(direction === "vertical" ? [54, 1, 80, 24] : [0, 23, 80, 24]);
      expect([
        thirdTerminal.screenX,
        thirdTerminal.screenY,
        thirdTerminal.width,
        thirdTerminal.height,
      ]).toEqual(direction === "vertical" ? [0, 13, 80, 24] : [28, 1, 80, 24]);
      expect(sourceTerminal.focusable).toBe(true);
      sent.length = 0;
      sourceTerminal.onData!(Uint8Array.of(67), "input");
      expect(sent).toEqual(["pane-1"]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("a mounted terminal becomes focusable when live local selection becomes eligible", async () => {
  const snapshot = surfaceSnapshot();
  let select!: () => void;
  function Fixture() {
    const [eligible, setEligible] = useState(false);
    select = () => setEligible(true);
    return (
      <SurfaceView
        {...recoveryProps}
        snapshot={snapshot}
        stream={null}
        surface={snapshot.surfaces[0]!}
        terminals={new Map()}
        focusedPaneId={null}
        workbenchFocused={false}
        undersized={false}
        canReceiveInput={() => eligible}
        onFocusPane={() => {}}
        onTerminalReady={() => {}}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 80, height: 20 });
  try {
    await setup.flush();
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    expect(terminal.focusable).toBe(false);
    act(select);
    await setup.flush();
    expect(terminal.focusable).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const [width, height, eligible] of [
  [20, 6, true],
  [20, 5, false],
  [19, 6, false],
] as const) {
  test(`a ${width}x${height} bordered pane requires an actual 20x5 terminal for input and resize`, async () => {
    const snapshot = surfaceSnapshot();
    const sent: string[] = [];
    const resized: string[] = [];
    const setup = await testRender(
      <SurfaceView
        {...recoveryProps}
        snapshot={snapshot}
        surface={snapshot.surfaces[0]!}
        stream={streamFixture({ sendInput: (id) => sent.push(id) })}
        terminals={new Map()}
        focusedPaneId="pane-1"
        workbenchFocused
        undersized={false}
        onFocusPane={() => {}}
        onTerminalReady={() => {}}
      />,
      { width, height },
    );
    try {
      await setup.flush();
      const terminal = setup.renderer.root.findDescendantById(
        "terminal:pane-1",
      ) as EmbeddedTerminalRenderable;
      expect([terminal.width, terminal.height]).toEqual([80, 24]);
      expect(terminal.focusable).toBe(eligible);
      sent.length = 0;
      resized.length = 0;
      terminal.onData!(Uint8Array.of(65), "input");
      terminal.onData!(Uint8Array.of(66), "response");
      expect(sent).toEqual(eligible ? ["pane-1"] : []);
      expect(resized).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const status of ["exited", "failed", "interrupted"] as const) {
  test(`${status} terminal stays mounted and replays output but rejects every input source`, async () => {
    const snapshot = surfaceSnapshot();
    const sent: number[][] = [];
    const resized: number[][] = [];
    const selected: string[] = [];
    let live = true;
    let publish!: (snapshot: Snapshot) => void;
    const buffer = terminalBufferFixture({
      epoch: snapshot.epoch,
      history: new TextEncoder().encode("preserved output\r\n"),
      historyCursor: 18,
      chunks: [],
    });
    function Fixture() {
      const [current, setCurrent] = useState(snapshot);
      publish = setCurrent;
      return (
        <SurfaceView
          {...recoveryProps}
          snapshot={current}
          stream={streamFixture({
            close() {},
            sendInput: (_id, data) => sent.push([...data]),
          })}
          surface={current.surfaces[0]!}
          terminals={
            new Map([
              [
                "pane-1",
                {
                  ...buffer,
                  chunks:
                    current.panes[0]!.processStatus === "running"
                      ? []
                      : [
                          {
                            cursor: 30,
                            data: new TextEncoder().encode("after exit\r\n"),
                            geometrySequence: 0,
                            origin: "live",
                          },
                        ],
                },
              ],
            ])
          }
          focusedPaneId="pane-1"
          workbenchFocused
          undersized={false}
          canReceiveInput={(id) => live && id === "pane-1"}
          onFocusPane={(id) => selected.push(id)}
          onTerminalReady={() => {}}
        />
      );
    }
    const setup = await testRender(<Fixture />, { width: 80, height: 20 });
    try {
      await setup.flush();
      const terminal = setup.renderer.root.findDescendantById(
        "terminal:pane-1",
      ) as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      sent.length = 0;
      live = false;
      resized.length = 0;
      // These callbacks can already be queued when the authoritative snapshot arrives.
      for (const source of ["input", "response"] as const) {
        captured(Uint8Array.of(65), source);
      }
      expect(sent).toEqual([]);
      act(() =>
        publish({ ...snapshot, panes: [{ ...snapshot.panes[0]!, processStatus: status }] }),
      );
      await setup.flush();
      expect(setup.captureCharFrame()).toContain(status);
      expect(setup.captureCharFrame()).toContain("preserved output");
      expect(setup.captureCharFrame()).toContain("after exit");
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(terminal.focusable).toBe(false);
      expect(terminal.focused).toBe(false);
      await act(async () => setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1));
      expect(selected).toEqual(["pane-1"]);
      expect(terminal.focused).toBe(false);
      live = true;
      terminal.onData!(Uint8Array.of(66), "input");
      terminal.onData!(Uint8Array.of(67), "response");
      expect(sent).toEqual([]);
      act(() => setup.resize(90, 22));
      await setup.flush();
      expect(resized).toEqual([]);
      expect(setup.captureCharFrame().match(/preserved output/g)).toHaveLength(1);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("workbench warns before its content narrows below 60 columns", async () => {
  const snapshot = surfaceSnapshot();
  const small = await testRender(
    <SurfaceView
      {...recoveryProps}
      focusedPaneId={null}
      snapshot={snapshot}
      stream={null}
      surface={snapshot.surfaces[0]!}
      terminals={new Map()}
      undersized
      workbenchFocused={false}
      onFocusPane={() => {}}
      onTerminalReady={() => {}}
    />,
    { width: 73, height: 20 },
  );
  await small.flush();
  expect(small.captureCharFrame()).toContain("too small.");
  act(() => small.renderer.destroy());
});

test("only vertical dividers are visible while horizontal divider spacing is retained", async () => {
  for (const [direction, glyph] of [
    ["vertical", "│"],
    ["horizontal", "─"],
  ] as const) {
    const snapshot = splitSurfaceSnapshot(direction);
    const setup = await testRender(
      <SurfaceView
        {...recoveryProps}
        focusedPaneId={null}
        snapshot={snapshot}
        stream={null}
        surface={snapshot.surfaces[0]!}
        terminals={new Map()}
        undersized={false}
        workbenchFocused={false}
        onFocusPane={() => {}}
        onTerminalReady={() => {}}
      />,
      { width: 30, height: 8 },
    );
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame.includes(glyph)).toBe(direction === "vertical");
    const first = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    const second = setup.renderer.root.findDescendantById("terminal:pane-2")!;
    if (direction === "vertical") {
      expect([first.parent!.width, second.parent!.width]).toEqual([15, 14]);
    } else {
      expect(frame.split("\n")[4]!.trim()).toBe("");
      expect([first.screenY, first.parent!.height, second.screenY, second.parent!.height]).toEqual([
        1, 3, 6, 2,
      ]);
    }
    act(() => setup.renderer.destroy());
  }
});

test("surface-not-opened state includes a compact title and description without actions", async () => {
  const setup = await testRender(
    <Workbench
      {...recoveryProps}
      snapshot={null}
      stream={null}
      terminals={new Map()}
      surface={undefined}
      tabs={[]}
      activeTabId={null}
      tabCursorId={null}
      tabsFocused={false}
      workbenchFocused={false}
      focusedPaneId={null}
      undersized={false}
      failed
      onFocusTab={() => {}}
      onActivateTab={() => {}}
      onEnterTab={() => {}}
      onTabScrollInteraction={() => {}}
      onFocusPane={() => {}}
      onTerminalReady={() => {}}
    />,
    { width: 80, height: 6 },
  );
  try {
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("No execution surface");
    expect(frame).toContain("Select an item with an execution surface");
    expect(frame).not.toContain("Operation failed");
    expect(frame).not.toContain("Reactivate");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("empty tab shows a compact title and description in a short host", async () => {
  const snapshot = surfaceSnapshot();
  snapshot.tabs[0]!.layout = null;
  const setup = await testRender(
    <SurfaceView
      {...recoveryProps}
      snapshot={snapshot}
      surface={snapshot.surfaces[0]!}
      stream={null}
      terminals={new Map()}
      focusedPaneId={null}
      workbenchFocused={false}
      undersized={false}
      onFocusPane={() => {}}
      onTerminalReady={() => {}}
    />,
    { width: 60, height: 2 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("No terminal panes");
    expect(setup.captureCharFrame()).toContain("Create a terminal tab to get started");
    expect(setup.captureCharFrame()).not.toContain("Reactivate");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("transparent undimmed output reserves its double top border and bottom recovery footer without replacing the terminal", async () => {
  const snapshot = surfaceSnapshot();
  let present!: (
    status: Snapshot["panes"][number]["processStatus"],
    connected: boolean,
    width?: number,
    height?: number,
  ) => void;
  function Fixture() {
    const [view, setView] = useState({
      status: "running" as Snapshot["panes"][number]["processStatus"],
      connected: true,
      width: 60,
      height: 12,
    });
    present = (status, connected, width = 60, height = 12) =>
      setView({ status, connected, width, height });
    return (
      <Box width="100%" height="100%" bg="background">
        <Box id="pane-test-host" width={view.width} height={view.height}>
          <SurfaceView
            {...recoveryProps}
            connected={view.connected}
            canReactivate={() => view.connected}
            snapshot={{
              ...snapshot,
              panes: [
                {
                  ...snapshot.panes[0]!,
                  processStatus: view.status,
                  errorText: "FULL ERROR MUST NOT APPEAR",
                },
              ],
            }}
            surface={snapshot.surfaces[0]!}
            stream={null}
            terminals={new Map()}
            focusedPaneId={null}
            workbenchFocused={false}
            undersized={false}
            onFocusPane={() => {}}
            onTerminalReady={() => {}}
          />
        </Box>
      </Box>
    );
  }
  const setup = await testRender(<Fixture />, { width: 60, height: 12 });
  try {
    await setup.flush();
    const root = setup.renderer.root;
    const original = root.findDescendantById("terminal:pane-1")!;
    expect(original.opacity).toBe(1);
    for (const [status, connected, title] of [
      ["starting", true, "Starting terminal"],
      ["exited", true, "Terminal exited"],
      ["failed", true, "Terminal failed"],
      ["interrupted", true, "Terminal interrupted"],
      ["exited", false, "Disconnected"],
      ["running", false, "Disconnected"],
    ] as const) {
      act(() => present(status, connected));
      await setup.flush();
      const alert = root.findDescendantById("pane-alert:pane-1")!;
      expect(original.opacity).toBe(1);
      expect((original as EmbeddedTerminalRenderable).transparentBackground).toBe(true);
      expect([original.screenY, original.parent!.height]).toEqual([1, 8]);
      expect(original.height).toBe(24);
      expect(alert.height).toBe(3);
      expect(alert.opacity).toBe(1);
      expect(alert.screenY + alert.height).toBe(12);
      expect(original.parent!.screenY + original.parent!.height).toBe(alert.screenY);
      expect(setup.captureCharFrame()).toContain(title);
      expect(setup.captureCharFrame()).not.toContain("FULL ERROR");
      const button = root.findDescendantById("reactivate:pane-1");
      expect(button !== undefined).toBe(status === "exited");
      if (button) {
        expect([button.screenX, button.screenY, button.width, button.height]).toEqual([
          46, 10, 12, 1,
        ]);
        expect(button.height).toBe(1);
        expect(button.opacity).toBe(1);
        expect(button.screenY).toBe(alert.screenY + 1);
        expect(button.focusable).toBe(connected);
      }
      expect(root.findDescendantById("terminal:pane-1")).toBe(original);
    }
    for (const [width, height, eligible] of [
      [20, 4, true],
      [19, 4, false],
      [20, 3, false],
      [20, 2, false],
      [20, 1, false],
      [1, 3, false],
      [0, 0, false],
    ] as const) {
      act(() => present("exited", true, width, height));
      await setup.flush();
      const button = root.findDescendantById("reactivate:pane-1")!;
      expect(button.focusable).toBe(eligible);
      expect(original.parent!.getLayout().height).toBe(0);
      expect(root.findDescendantById("terminal:pane-1")).toBe(original);
      expect(setup.captureCharFrame().split("\n").slice(height).join("\n").trim()).toBe("");
    }
    act(() => present("running", true));
    await setup.flush();
    expect(original.opacity).toBe(1);
    expect(original.parent!.height).toBe(11);
    expect(root.findDescendantById("pane-alert:pane-1")).toBeUndefined();
    expect(root.findDescendantById("terminal:pane-1")).toBe(original);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

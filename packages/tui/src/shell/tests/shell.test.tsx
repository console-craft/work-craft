import { expect, test } from "bun:test";

import {
  BoxRenderable,
  CliRenderEvents,
  EmbeddedTerminalRenderable,
  InputRenderable,
  type MouseEvent,
  parseColor,
  type Renderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { extend } from "@opentui/react";
import {
  ApiError,
  type Command,
  type CommandResponse,
  type Snapshot,
} from "@work-craft/server/client";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { createWorkCraftStore, type WorkCraftState } from "@/client/use-work-craft.ts";
import { CreatePrompt } from "@/shell/create-prompt.tsx";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { Header } from "@/shell/header.tsx";
import { calculateShellLayout } from "@/shell/layout.ts";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import { SessionSwitcher } from "@/shell/session-switcher.tsx";
import { WorkCraftShell } from "@/shell/shell.tsx";
import type { DialogState } from "@/shell/state";
import { StatusBar } from "@/shell/status-bar.tsx";
import { WorkspaceBar } from "@/shell/workspace-bar.tsx";
import { snapshotFixture } from "@/tests/support/fixtures.ts";
import { testRender as renderWithoutTheme } from "@/tests/support/render";
import { Dialog } from "@/ui/components/dialog";
import { getControlHints } from "@/ui/control-hints";
import { isEligibleFocusTarget } from "@/ui/focus-utils";
import { icons } from "@/ui/icons/nerd";
import { Box } from "@/ui/primitives/box.tsx";
import { Stack } from "@/ui/primitives/stack";
import type { Theme } from "@/ui/theme";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";
import { draculaTheme } from "@/ui/themes/dracula.ts";
import { paneIds } from "@/workbench/layout.ts";

extend({ terminal: EmbeddedTerminalRenderable });

async function testRender(node: ReactNode, options: Parameters<typeof renderWithoutTheme>[1]) {
  const setup = await renderWithoutTheme(
    <ThemeProvider theme={defaultTheme}>{node}</ThemeProvider>,
    { exitOnCtrlC: false, ...options },
  );
  return {
    ...setup,
    // Native frames now publish focused action metadata into React.
    flush: async (...args: Parameters<typeof setup.flush>) => {
      await act(async () => setup.flush(...args));
      // Surface host measurement commits pane rectangles for the following native frame.
      await act(async () => setup.flush(...args));
    },
  };
}

function statusText(setup: Awaited<ReturnType<typeof testRender>>): string {
  function text(node: Renderable): string {
    return node instanceof TextRenderable
      ? node.plainText
      : node.getChildren().map(text).filter(Boolean).join(" ");
  }
  return text(setup.renderer.root.findDescendantById("status")!);
}

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

test("status acceptance hints follow list, Tab, button and creation input focus", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  function assertHints(action: string, create: boolean): void {
    const text = statusText(setup);
    expect(text).toContain(action);
    expect(text).toContain(`${icons.keyboard} r Reconnect`);
    expect(text).toContain(`${icons.keyboard} q Quit`);
    expect(text).toContain(`${icons.escape} Cancel`);
    expect(text.includes(`${icons.space} n Create`)).toBe(create);
    for (const movement of [
      `${icons.control} h`,
      `${icons.control} j`,
      `${icons.control} k`,
      `${icons.control} l`,
      icons.tab,
      `${icons.keyboard} j`,
    ]) {
      expect(text).not.toContain(movement);
    }
  }
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    assertHints(`${icons.return} Attach`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    expect(statusText(setup)).not.toContain("Attach");
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return} Attach`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    await act(async () => setup.mockInput.pressKey(" "));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    assertHints(`${icons.return} Submit`, false);
    expect(statusText(setup)).not.toContain("Activate");
    expect(statusText(setup)).not.toContain("Attach");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a dialog above narrow navigation retains dialog HINTS", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 80,
    height: 20,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
    expect(statusText(setup)).toContain(`${icons.return} Attach`);
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const kind of [
  "sessions",
  "session",
  "workspace",
  "directory",
  "generic-root",
  "generic-child",
] as const) {
  test(`${kind} overlay leaves status hints uncovered across resize`, async () => {
    const dialog: Exclude<DialogState, null> =
      kind === "sessions"
        ? { kind, returnFocus: { region: "category" } }
        : { kind: "create", createKind: kind, returnFocus: { region: "category" } };
    let cancellations = 0;
    const setup = await testRender(
      <Stack width="100%" height="100%" gap={0}>
        <Box flexGrow={1} />
        <StatusBar mode="HINTS" hints={[{ keys: "Escape", label: "Cancel" }]} />
        <DialogOverlay
          dialog={dialog}
          canCancel
          sessions={snapshotFixture().sessions}
          promptValue=""
          error={null}
          onCreateSession={() => {}}
          onSelectSession={() => {}}
          onCancel={() => cancellations++}
          onPromptChange={() => {}}
          onPromptSubmit={() => {}}
        />
      </Stack>,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      for (const height of [40, 20, 6, 2, 1]) {
        act(() => setup.resize(120, height));
        await setup.flush();
        const status = setup.renderer.root.findDescendantById("status")!;
        const content = setup.renderer.root.findDescendantById("dialog")!;
        const overlay = content.parent!;
        if (height === 1) {
          expect(overlay.visible).toBe(false);
        } else {
          expect(overlay.screenY + overlay.height).toBeLessThanOrEqual(status.screenY);
        }
        const statusLine = setup.captureSpans().lines[height - 1]!;
        const badge = statusLine.spans.find(({ text }) => text.includes("HINTS"));
        expect(badge).toBeDefined();
        expect(badge!.bg.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());
        expect(statusLine.spans.map(({ text }) => text).join("")).toContain("Cancel");
      }
      const focus = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockMouse.click(1, 0));
      await setup.flush();
      expect(cancellations).toBe(0);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(focus?.id);
      act(() => setup.resize(120, 20));
      await setup.flush();
      const restoredFocus = setup.renderer.currentFocusedRenderable;
      const content = setup.renderer.root.findDescendantById("dialog")!;
      expect(restoredFocus).not.toBeNull();
      expect(isEligibleFocusTarget(restoredFocus!, content)).toBe(true);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("modal button mouse-down updates focus, styling and hints before a cancelled release", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    const label = button.getChildren()[0] as TextRenderable;
    let mouseDown: MouseEvent | undefined;
    label.onMouseDown = (event) => {
      mouseDown = event;
    };
    const query = list.value;
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockMouse.pressDown(label.screenX, label.screenY));
    await setup.flush();
    expect(mouseDown?.target).toBe(label);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    expect(mouseDown?.defaultPrevented).toBe(false);
    expect(button.focused).toBe(true);
    expect(list.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    expect(statusText(setup)).toContain(`${icons.return}/${icons.space} Activate`);
    expect(statusText(setup)).not.toContain(`${icons.return} Attach`);
    expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
    await act(async () => {
      await setup.mockMouse.moveTo(0, 0);
      await setup.mockMouse.release(0, 0);
      setup.mockInput.pressKey("j");
    });
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    expect(list.value).toBe(query);
    expect(setup.renderer.root.findDescendantById("session:search")).toBe(list);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal list mouse-down takes focus back from its sibling without closing the fixture", async () => {
  const selected: string[] = [];
  let backgroundPresses = 0;
  const setup = await testRender(
    <Box onMouseDown={() => backgroundPresses++}>
      <DialogOverlay
        dialog={{ kind: "sessions", returnFocus: { region: "category" } }}
        canCancel={false}
        sessions={snapshotFixture().sessions}
        promptValue=""
        error={null}
        onCreateSession={() => {}}
        onCancel={() => {}}
        onSelectSession={(id) => selected.push(id)}
        onPromptChange={() => {}}
        onPromptSubmit={() => {}}
      />
    </Box>,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    act(() => button.focus());
    await setup.flush();
    expect(getControlHints(button)).toEqual([{ keys: "Enter/Space", label: "Activate" }]);
    const row = setup.renderer.root.findDescendantById("session:item:session-work")!;
    await act(async () => setup.mockMouse.pressDown(row.screenX + 1, row.screenY));
    await setup.flush();
    expect(selected).toEqual([]);
    expect(setup.renderer.root.findDescendantById("session:search")).toBe(list);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog");
    expect(list.focused).toBe(false);
    expect(button.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    expect(getControlHints(list)).toEqual([]);
    expect(getControlHints(button)).toEqual([]);
    expect(backgroundPresses).toBe(0);
    await act(async () => setup.mockMouse.release(row.screenX + 1, row.screenY));
    expect(selected).toEqual(["session-work"]);
    act(() => list.focus());

    await act(async () => setup.mockMouse.click(0, 0));
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    expect(backgroundPresses).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

for (const order of ["response first", "snapshot first"] as const) {
  for (const activation of ["return", "space", "mouse"] as const) {
    test(`native Reactivate ${activation}, ${order}: transfers origin before disabling and enters only its exact ready pane`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        const root = setup.renderer.root;
        const original = root.findDescendantById("terminal:pane-2")!;
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("reactivate:pane-2");
        const button = root.findDescendantById("reactivate:pane-2")!;
        if (activation === "mouse") {
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        } else {
          await act(async () =>
            activation === "return" ? setup.mockInput.pressEnter() : setup.mockInput.pressKey(" "),
          );
        }
        await setup.flush();
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
          { type: "process.restart", paneId: "pane-2" },
        ]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(button.focusable).toBe(false);
        expect(setup.sent).toEqual([]);
        const respond = () =>
          act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
          );
        const next = { ...splitSurfaceSnapshot(), revision: 5 };
        if (order === "response first") {
          await respond();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          expect(button.focusable).toBe(false);
        } else {
          await setup.publish(next);
          expect(root.findDescendantById("reactivate:pane-2")).toBeUndefined();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (order === "response first") {
          await setup.publish(next);
        } else {
          await respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
        expect(root.findDescendantById("terminal:pane-2")).toBe(original);
        expect(root.findDescendantById("terminal:pane-2")!.opacity).toBe(1);
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const change of [
  "running",
  "starting",
  "epoch",
  "disconnect",
  "active tab",
  "item archived",
  "parent archived",
  "resize",
  "drawer",
  "modal",
] as const) {
  test(`captured native Reactivate rejects precommit ${change} without restart or PTY leakage`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.panes[1]!.processStatus = "exited";
    const setup = await liveInputFixture(initial);
    try {
      const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(button).toBeDefined();
      act(() => button.focus());
      await setup.flush();
      const terminal = setup.renderer.root.findDescendantById(
        "terminal:pane-2",
      ) as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      const capturedResize = terminal.onTerminalResize!;
      const next = structuredClone(initial);
      next.revision = 5;
      if (change === "disconnect") {
        setup.store.stop();
      } else if (change === "resize") {
        act(() => setup.resize(79, 40));
      } else if (change === "drawer") {
        await act(async () => {
          setup.resize(100, 40);
          setup.mockInput.pressKeys(["\x00b"]);
        });
      } else if (change === "modal") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else {
        if (change === "epoch") {
          next.epoch = "epoch-b";
        } else if (change === "active tab") {
          next.surfaces[0]!.activeTabId = "missing";
        } else if (change === "item archived" || change === "parent archived") {
          next.items.find(
            (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
          )!.archived = true;
        } else {
          next.panes[1]!.processStatus = change;
        }
        await setup.publish(next, false);
      }
      setup.resized.length = 0;
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      await act(async () => {
        setup.mockInput.pressEnter();
        setup.mockInput.pasteBracketedText("not PTY input");
        terminal.write(new TextEncoder().encode("\x1b[5n"));
        await setup.mockMouse.click(button.screenX + 1, button.screenY);
      });
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      expect(setup.sent).toEqual([]);
      expect(setup.resized).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const stage of ["before response", "after response"] as const) {
  for (const cancellation of [
    "input",
    "paste",
    "focus",
    "modal",
    "context",
    "archive",
    "disconnect",
    "epoch",
  ] as const) {
    test(`Reactivate ${cancellation} ${stage} cancels exact-pane handoff permanently`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (stage === "after response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 6, result: { id: "pane-2" } }),
          );
        }
        const next = { ...splitSurfaceSnapshot(), revision: 6 };
        if (cancellation === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancellation === "paste") {
          await act(async () => setup.mockInput.pasteBracketedText("cancel"));
        } else if (cancellation === "focus") {
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:tabs")!.focus();
          });
        } else if (cancellation === "modal") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        } else if (cancellation === "context") {
          const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
          await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
        } else if (cancellation === "disconnect") {
          setup.store.stop();
          setup.renderCurrent();
          await setup.flush();
        } else if (cancellation === "epoch") {
          next.epoch = "epoch-b";
        } else {
          const archived = structuredClone(initial);
          archived.revision = 5;
          archived.items.find((item) => item.id === "root-1")!.archived = true;
          await setup.publish(archived);
        }
        await setup.publish(next);
        if (stage === "before response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 6, result: { id: "pane-2" } }),
          );
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("an unrelated running sibling cannot complete an exact-pane Reactivate handoff", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    const starting = structuredClone(initial);
    starting.revision = 5;
    starting.panes[1]!.processStatus = "starting";
    await setup.publish(starting);
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")!.opacity).toBe(1);
    const running = { ...splitSurfaceSnapshot(), revision: 6 };
    await setup.publish(running);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const cancellation of ["none", "input", "focus", "modal"] as const) {
  for (const duplicate of ["button", "leader"] as const) {
    test(`response-first restart retains command protection after ${cancellation} focus cancellation against ${duplicate}`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (cancellation === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancellation === "focus") {
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:tabs")!.focus();
          });
        } else if (cancellation === "modal") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          await act(async () => setup.mockInput.pressEscape());
        }
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
        await setup.flush();
        if (duplicate === "button") {
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        } else {
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        }
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
          { type: "process.restart", paneId: "pane-2" },
        ]);
        expect(button.focusable).toBe(false);
        const running = { ...splitSurfaceSnapshot(), revision: 7 };
        await setup.publish(running);
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("response-first restart releases protection only at its response revision, then permits a new explicit restart", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
    );
    await setup.flush();
    expect(button.focusable).toBe(false);
    for (const revision of [5, 6]) {
      await setup.publish({ ...initial, revision });
      expect(button.focusable).toBe(false);
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.restarts).toHaveLength(1);
    }
    await setup.publish({ ...initial, revision: 7 });
    expect(button.focusable).toBe(true);
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
      { type: "process.restart", paneId: "pane-2" },
    ]);
    await act(async () => setup.restarts[1]!.reject(new Error("Retry refused")));
    await setup.flush();
    expect(button.focusable).toBe(true);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("restart failure releases command protection after native focus intent was cancelled", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () => setup.restarts[0]!.reject(new Error("Cancelled request refused")));
    await setup.flush();
    expect(button.focusable).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" "));
    expect(setup.restarts).toHaveLength(2);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("a later authoritative exit can reactivate again after successful restart protection catches up", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const original = setup.renderer.root.findDescendantById("terminal:pane-2");
    act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
    );
    await setup.publish({ ...splitSurfaceSnapshot(), revision: 5 });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    await setup.publish({ ...initial, revision: 6 });
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    expect(button.focusable).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(original);
    await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
      { type: "process.restart", paneId: "pane-2" },
    ]);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const transition of ["disconnect", "epoch"] as const) {
  for (const stage of ["pending response", "pending snapshot"] as const) {
    test(`restart protection clears across ${transition} with ${stage} without old cleanup releasing a newer request`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (stage === "pending snapshot") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
          );
          await setup.flush();
          expect(setup.renderer.root.findDescendantById("reactivate:pane-2")!.focusable).toBe(
            false,
          );
        }
        if (transition === "disconnect") {
          setup.store.stop();
          setup.renderCurrent();
          await setup.flush();
          await setup.store.start();
          setup.renderCurrent();
          await setup.flush();
        } else if (transition === "epoch") {
          await setup.publish({ ...initial, epoch: "epoch-b", revision: 5 });
        }
        const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
        expect(button.focusable).toBe(true);
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.restarts).toHaveLength(2);
        if (stage === "pending response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
          );
          await setup.flush();
        }
        expect(button.focusable).toBe(false);
        await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        expect(setup.restarts).toHaveLength(2);
        await act(async () => setup.restarts[1]!.reject(new Error("New request refused")));
        await setup.flush();
        expect(button.focusable).toBe(true);
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const outcome of ["response first", "snapshot first", "failure"] as const) {
  test(`same-epoch tab context changes retain restart protection until ${outcome} settles, then release it off-context`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.panes[1]!.processStatus = "exited";
    initial.tabs.push({
      ...initial.tabs[0]!,
      id: "other-tab",
      position: 1,
      layout: { type: "pane", paneId: "pane-3" },
    });
    initial.panes.push({ ...initial.panes[0]!, id: "pane-3" });
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      if (outcome === "response first") {
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
      }
      const away = {
        ...initial,
        surfaces: [{ ...initial.surfaces[0]!, activeTabId: "other-tab" }],
      };
      await setup.publish({ ...away, revision: 5 });
      await setup.publish({ ...initial, revision: 6 });
      const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(button.focusable).toBe(false);
      await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.restarts).toHaveLength(1);
      await setup.publish({ ...away, revision: 7 });
      if (outcome === "snapshot first") {
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
      } else if (outcome === "failure") {
        await act(async () => setup.restarts[0]!.reject(new Error("Off-context restart refused")));
      }
      await setup.publish({ ...initial, revision: 8 });
      const nextButton = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(nextButton.focusable).toBe(true);
      act(() => nextButton.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      expect(setup.restarts).toHaveLength(2);
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

test("Reactivate failure retains valid strip focus, reports once and allows retry without history replacement", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const original = setup.renderer.root.findDescendantById("terminal:pane-2");
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.restarts[0]!.reject(new Error("Reactivate refused")));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(button.focusable).toBe(true);
    expect(statusText(setup).match(/Reactivate refused/g)).toHaveLength(1);
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(original);
    expect(setup.sent).toEqual([]);
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.filter((command) => command.type === "process.restart")).toHaveLength(2);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("leader restart from an exited action transfers to tabs and disables duplicate Reactivate submissions", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(button.focusable).toBe(false);
    await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
    ]);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

function workCraftStateFixture(overrides: Partial<WorkCraftState> = {}): WorkCraftState {
  const snapshot = snapshotFixture({
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
    categories: [
      {
        workspaceId: "workspace-shared",
        kind: "implementation",
        title: "Implementation",
        position: 0,
      },
    ],
  });
  const fixture: WorkCraftState = {
    snapshot,
    status: "connected",
    connectionError: null,
    canSendInput: (paneId, epoch) => {
      const current = fixture.snapshot;
      const pane = current?.panes.find((pane) => pane.id === paneId);
      const surface = current?.surfaces.find((surface) => surface.id === pane?.surfaceId);
      const tab = current?.tabs.find(
        (tab) => tab.id === surface?.activeTabId && tab.surfaceId === surface?.id,
      );
      return (
        fixture.status === "connected" &&
        current?.epoch === epoch &&
        pane?.processStatus === "running" &&
        paneIds(tab?.layout ?? null).includes(paneId)
      );
    },
    canReactivate: (paneId, epoch) => {
      const current = fixture.snapshot;
      const pane = current?.panes.find((pane) => pane.id === paneId);
      const surface = current?.surfaces.find((surface) => surface.id === pane?.surfaceId);
      const item = current?.items.find((item) => item.id === surface?.itemId);
      const parent = current?.items.find((parent) => parent.id === item?.parentId);
      const tab = current?.tabs.find(
        (tab) => tab.id === surface?.activeTabId && tab.surfaceId === surface?.id,
      );
      return (
        fixture.status === "connected" &&
        current?.epoch === epoch &&
        pane?.processStatus === "exited" &&
        item !== undefined &&
        !item.archived &&
        (item.parentId === null ||
          (parent !== undefined &&
            !parent.archived &&
            parent.parentId === null &&
            parent.workspaceId === item.workspaceId &&
            parent.category === item.category)) &&
        paneIds(tab?.layout ?? null).includes(paneId)
      );
    },
    command: async () => ({ ok: true, revision: 1, result: { id: "result-1" } }),
    reload: async () => {},
    stream: null,
    terminals: new Map(),
    ...overrides,
  };
  return fixture;
}

async function liveInputFixture(initial = splitSurfaceSnapshot()) {
  const sent: { paneId: string; bytes: number[] }[] = [];
  const resized: { paneId: string; cols: number; rows: number }[] = [];
  const commands: Command[] = [];
  const restarts: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const splits: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const tabCreates: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const store = createWorkCraftStore({
    ensureDaemon: async () => {},
    health: async () => ({ epoch: initial.epoch, revision: initial.revision, pid: 1 }),
    snapshot: async () => initial,
    streamOnce: async () => ({ type: "snapshot", snapshot: initial }),
    stream: async () => ({
      close() {},
      resize: (paneId, cols, rows) => resized.push({ paneId, cols, rows }),
      sendInput: (paneId, bytes) => sent.push({ paneId, bytes: [...bytes] }),
    }),
    command: async (command) => {
      commands.push(command);
      if (command.type === "process.restart") {
        const request = deferred<CommandResponse>();
        restarts.push(request);
        return request.promise;
      }
      if (command.type === "pane.split") {
        const request = deferred<CommandResponse>();
        splits.push(request);
        return request.promise;
      }
      if (command.type === "tab.create") {
        const request = deferred<CommandResponse>();
        tabCreates.push(request);
        return request.promise;
      }
      return { ok: true, revision: initial.revision, result: { id: "surface-1" } };
    },
  });
  await store.start();
  let commit!: (state: WorkCraftState) => void;
  function Fixture() {
    const [state, setState] = useState(store.getState());
    commit = setState;
    return <WorkCraftShell workCraft={state} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  await setup.flush();
  await openFixtureItem(setup);
  act(() => setup.renderer.root.findDescendantById("terminal:pane-1")!.focus());
  await setup.flush();
  sent.length = 0;
  return {
    ...setup,
    store,
    sent,
    resized,
    commands,
    restarts,
    splits,
    tabCreates,
    renderCurrent() {
      act(() => commit(store.getState()));
    },
    async publish(snapshot: Snapshot, render = true) {
      await store.apply({ type: "snapshot", snapshot });
      if (render) {
        act(() => commit(store.getState()));
        await setup.flush();
      }
    },
  };
}

for (const status of ["exited", "failed", "interrupted"] as const) {
  for (const focused of [true, false]) {
    test(`${status} ${focused ? "focused" : "unfocused"} pane rejects captured precommit input and retains restart selection`, async () => {
      const setup = await liveInputFixture();
      try {
        const terminal = setup.renderer.root.findDescendantById(
          "terminal:pane-1",
        ) as EmbeddedTerminalRenderable;
        const stoppedId = focused ? "pane-1" : "pane-2";
        const captured = (
          setup.renderer.root.findDescendantById(
            `terminal:${stoppedId}`,
          ) as EmbeddedTerminalRenderable
        ).onData!;
        const stopped = splitSurfaceSnapshot();
        stopped.revision = 5;
        stopped.panes.find((pane) => pane.id === stoppedId)!.processStatus = status;
        await setup.publish(stopped, false);
        captured(Uint8Array.of(65), "input");
        captured(new TextEncoder().encode("\x1b[0n"), "response");
        expect(setup.sent).toEqual([]);
        await setup.publish(stopped);
        expect(setup.renderer.root.findDescendantById(`pane-alert:${stoppedId}`)).toBeDefined();
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          focused ? "region:tabs" : "terminal:pane-1",
        );
        if (focused) {
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
          expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        }
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const interaction of ["pointer", "spatial"] as const) {
  for (const allStopped of [false, true]) {
    test(`${interaction} selects a non-first stopped split for exact restart (${allStopped ? "all stopped" : "running sibling"})`, async () => {
      const setup = await liveInputFixture();
      try {
        const stopped = splitSurfaceSnapshot();
        stopped.revision = 5;
        stopped.panes[1]!.processStatus = "exited";
        if (allStopped) {
          stopped.panes[0]!.processStatus = "exited";
        }
        await setup.publish(stopped);
        const terminal = setup.renderer.root.findDescendantById(
          "terminal:pane-2",
        ) as EmbeddedTerminalRenderable;
        if (interaction === "pointer") {
          await act(async () => setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1));
        } else {
          if (allStopped) {
            // Enter the layout from tabs, then move to its second split.
            await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
          }
          await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          interaction === "spatial" ? "reactivate:pane-2" : "region:tabs",
        );
        expect(terminal.focusable).toBe(false);
        terminal.onData!(Uint8Array.of(65), "input");
        terminal.onData!(Uint8Array.of(66), "response");
        expect(setup.sent).toEqual([]);
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-2" });
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const orientation of ["stacked", "side-by-side"] as const) {
  for (const backwards of [false, true]) {
    test(`${orientation} all-stopped spatial ${backwards ? "previous" : "next"} selects exact restart and preserves shell boundaries`, async () => {
      const initial = splitSurfaceSnapshot();
      if (initial.tabs[0]!.layout?.type === "split") {
        initial.tabs[0]!.layout.direction = orientation === "stacked" ? "horizontal" : "vertical";
      }
      const setup = await liveInputFixture(initial);
      try {
        const stopped = structuredClone(initial);
        stopped.revision = 5;
        stopped.panes.forEach((pane) => {
          pane.processStatus = "exited";
        });
        await setup.publish(stopped);
        const second = setup.renderer.root.findDescendantById("terminal:pane-2")!;
        if (backwards) {
          await act(async () => setup.mockMouse.click(second.screenX + 1, second.screenY + 1));
        }
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        const key = orientation === "stacked" ? (backwards ? "k" : "j") : backwards ? "h" : "l";
        await act(async () => setup.mockInput.pressKey(key, { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          `reactivate:${backwards ? "pane-1" : "pane-2"}`,
        );
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({
          type: "process.restart",
          paneId: backwards ? "pane-1" : "pane-2",
        });
        // Leaving the pane layout must still reach shell controls, not cycle on tabs.
        if (!backwards) {
          const first = setup.renderer.root.findDescendantById("terminal:pane-1")!;
          await act(async () => setup.mockMouse.click(first.screenX + 1, first.screenY + 1));
        }
        await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
        await setup.flush();
        if (setup.renderer.currentFocusedRenderable?.id === "region:tabs") {
          await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
          await setup.flush();
        }
        const headerFocus = setup.renderer.currentFocusedRenderable;
        expect(headerFocus).not.toBeNull();
        expect(
          isEligibleFocusTarget(
            headerFocus!,
            setup.renderer.root.findDescendantById("shell-header")!,
          ),
        ).toBe(true);
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
        for (const id of ["pane-1", "pane-2"]) {
          const terminal = setup.renderer.root.findDescendantById(
            `terminal:${id}`,
          ) as EmbeddedTerminalRenderable;
          expect(terminal.focusable).toBe(false);
          terminal.onData!(Uint8Array.of(65), "input");
          terminal.onData!(Uint8Array.of(66), "response");
        }
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("a stopped selected pane does not steal focus from a shell control", async () => {
  const setup = await liveInputFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    const stopped = splitSurfaceSnapshot();
    stopped.revision = 5;
    stopped.panes[0]!.processStatus = "exited";
    await setup.publish(stopped);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("running terminal keeps raw Tab Shift+Tab Ctrl+C Escape double-prefix and ordinary bytes", async () => {
  const setup = await liveInputFixture();
  try {
    await act(async () => setup.mockInput.pressTab());
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    await act(async () => setup.mockInput.pressEscape());
    await act(async () => setup.mockInput.pressKeys(["\x00\x00"]));
    await act(async () => setup.mockInput.pressKey("x"));
    expect(setup.sent.flatMap(({ bytes }) => bytes)).toEqual([9, 27, 91, 90, 3, 27, 0, 120]);
    expect(setup.sent.every(({ paneId }) => paneId === "pane-1")).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const order of ["response first", "snapshot first"] as const) {
  for (const outcome of [
    "success",
    "failure",
    "input",
    "paste",
    "focus",
    "dialog",
    "guard",
  ] as const) {
    test(`explicit restart ${outcome} with ${order} waits for exact running pane without stealing superseded focus`, async () => {
      const stopped = splitSurfaceSnapshot();
      stopped.panes[0]!.processStatus = "exited";
      const setup = await liveInputFixture(stopped);
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        const running = splitSurfaceSnapshot();
        running.revision = 5;
        async function respond() {
          await act(async () => {
            if (outcome === "failure") {
              setup.restarts[0]!.reject(new Error("Restart refused"));
            } else {
              setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } });
            }
          });
        }
        if (order === "response first") {
          await respond();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (outcome === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (outcome === "paste") {
          await act(async () => setup.mockInput.pasteBracketedText("ignored"));
        } else if (outcome === "focus") {
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        } else if (outcome === "dialog") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        } else if (outcome === "guard") {
          act(() => setup.resize(79, 40));
          await setup.flush();
          act(() => setup.resize(120, 40));
        }
        await setup.publish(outcome === "failure" ? { ...stopped, revision: 5 } : running);
        if (order === "snapshot first") {
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
          await respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id === "terminal:pane-1").toBe(
          outcome === "success",
        );
        if (outcome === "failure") {
          expect(statusText(setup)).toContain("Restart refused");
        }
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("typing cannot renew a process failure status or churn its scroller", async () => {
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  const failed = splitSurfaceSnapshot();
  failed.panes[0]!.processStatus = "failed";
  failed.panes[0]!.errorText = "Missing executable";
  const setup = await liveInputFixture(failed);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    const before = statusText(setup);
    expect(before).toContain("Missing executable");
    const scroller = setup.renderer.root.findDescendantById("status-scroll:viewport");
    clock += 4000;
    await act(async () => setup.mockInput.pressKeys(["ordinary-text"]));
    await act(async () => setup.mockInput.pasteBracketedText("ordinary-paste"));
    await setup.publish({ ...failed, revision: 5 });
    expect(statusText(setup)).toBe(before);
    expect(setup.renderer.root.findDescendantById("status-scroll:viewport")).toBe(scroller);
    expect(setup.sent).toEqual([]);
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
    clock += 4001;
    await act(async () => setup.mockInput.pressKey("x"));
    await setup.publish({ ...failed, revision: 6 });
    expect(statusText(setup)).toContain("HINTS");
    expect(statusText(setup)).not.toContain("Missing executable");
  } finally {
    Date.now = now;
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("explicit restart clears its own entry failure after exact running readiness", async () => {
  const stopped = splitSurfaceSnapshot();
  stopped.panes[0]!.processStatus = "exited";
  const setup = await liveInputFixture(stopped);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } }),
    );
    await setup.publish({ ...stopped, revision: 5 });
    expect(statusText(setup)).toContain("Terminal entry failed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    const starting = splitSurfaceSnapshot();
    starting.revision = 6;
    starting.panes[0]!.processStatus = "starting";
    await setup.publish(starting);
    await act(async () =>
      setup.restarts[1]!.resolve({ ok: true, revision: 6, result: { id: "pane-1" } }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(statusText(setup)).toContain("Terminal entry failed");
    await setup.publish({ ...splitSurfaceSnapshot(), revision: 7 });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const change of [
  "exited",
  "failed",
  "interrupted",
  "epoch",
  "disconnect",
  "active tab",
  "item archived",
  "parent archived",
] as const) {
  test(`native keyboard paste mouse focus-report and emulator response reject precommit ${change}`, async () => {
    const setup = await liveInputFixture();
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      const capturedResize = terminal.onTerminalResize!;
      act(() =>
        terminal.write(new TextEncoder().encode("\x1b[?1004h\x1b[?1000h\x1b[?1006h\x1b[?2004h")),
      );
      const next = splitSurfaceSnapshot();
      next.revision = 5;
      if (change === "epoch") {
        next.epoch = "epoch-b";
      } else if (change === "active tab") {
        next.surfaces[0]!.activeTabId = "other-tab";
      } else if (change === "item archived" || change === "parent archived") {
        next.items.find(
          (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
        )!.archived = true;
      } else if (change !== "disconnect") {
        next.panes[0]!.processStatus = change;
      }
      if (change === "disconnect") {
        setup.store.stop();
      } else {
        await setup.publish(next, false);
      }
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
      setup.resized.length = 0;
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      await act(async () => {
        setup.mockInput.pressKey("x");
        setup.mockInput.pasteBracketedText("ignored-paste");
        terminal.blur();
        terminal.focus();
        terminal.write(new TextEncoder().encode("\x1b[5n"));
        await setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1);
      });
      expect(setup.sent).toEqual([]);
      expect(setup.resized).toEqual([]);
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      if (change === "item archived" || change === "parent archived") {
        await setup.publish(next);
        captured(Uint8Array.of(67), "input");
        captured(Uint8Array.of(68), "response");
        expect(setup.sent).toEqual([]);
        expect(setup.store.snapshot()!.panes[0]!.processStatus).toBe("running");
        await setup.store.apply({
          type: "terminal.output",
          epoch: next.epoch,
          paneId: "pane-1",
          cursor: 4,
          data: Buffer.from("kept").toString("base64"),
        });
        expect(
          new TextDecoder().decode(setup.store.getState().terminals.get("pane-1")!.chunks[0]!.data),
        ).toBe("kept");
      }
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const coverage of ["dialog", "drawer", "guard", "height", "item"] as const) {
  test(`captured callbacks cannot reach the old pane after same-batch ${coverage} change`, async () => {
    const setup = await liveInputFixture(twoSurfaceSnapshot());
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
      }
      await act(async () => {
        if (coverage === "dialog") {
          setup.mockInput.pressKey("s", { hyper: true });
        } else if (coverage === "drawer") {
          setup.mockInput.pressKey(" ", { ctrl: true });
          setup.mockInput.pressKey("b");
        } else if (coverage === "guard" || coverage === "height") {
          setup.resize(coverage === "guard" ? 79 : 120, coverage === "height" ? 8 : 40);
        } else {
          setup.mockInput.pressKey("j", { hyper: true });
        }
        captured(Uint8Array.of(65), "input");
        captured(Uint8Array.of(66), "response");
      });
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const entry of ["origin", "remembered"] as const) {
  test(`160→80 leaf shrink preserves ${entry} navigation to the usable sibling`, async () => {
    const snapshot = splitSurfaceSnapshot();
    const split = snapshot.tabs[0]!.layout!;
    if (split.type === "split") {
      split.ratio = 0.25;
    }
    const sent: string[] = [];
    const resized: string[] = [];
    const setup = await testRender(
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          stream: {
            close() {},
            sendInput: (id) => sent.push(id),
            resize: (id) => resized.push(id),
          },
        })}
      />,
      { width: 160, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      await openFixtureItem(setup);
      await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      await setup.flush();
      const root = setup.renderer.root;
      const a = root.findDescendantById("terminal:pane-1") as EmbeddedTerminalRenderable;
      const b = root.findDescendantById("terminal:pane-2") as EmbeddedTerminalRenderable;
      act(() => a.focus());
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(a);
      expect([a.width, b.width]).toEqual([38, 114]);
      const capturedInput = a.onData!;
      sent.length = 0;
      resized.length = 0;
      act(() => {
        setup.resize(80, 40);
        capturedInput(Uint8Array.of(65), "input");
        capturedInput(Uint8Array.of(66), "response");
      });
      expect(sent).toEqual([]);
      await setup.flush();
      expect([a.width, b.width]).toEqual([18, 54]);
      expect(a.focusable).toBe(false);
      expect(b.focusable).toBe(true);
      a.onData!(Uint8Array.of(67), "input");
      a.onData!(Uint8Array.of(68), "response");
      a.onTerminalResize!(80, 20);
      expect(sent).toEqual([]);
      expect(resized).not.toContain("pane-1");
      if (entry === "remembered") {
        act(() => root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
      }
      await act(async () =>
        setup.mockInput.pressKey(entry === "origin" ? "l" : "j", { ctrl: true }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
      b.onData!(Uint8Array.of(69), "input");
      expect(sent).toEqual(["pane-2"]);
      await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      expect(root.findDescendantById("terminal:pane-1") === a).toBe(true);
      expect(root.findDescendantById("terminal:pane-2") === b).toBe(true);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("same-batch split resize checks the bordered interior rather than stale native dimensions", async () => {
  const snapshot = splitSurfaceSnapshot();
  const split = snapshot.tabs[0]!.layout!;
  if (split.type === "split") {
    split.direction = "horizontal";
  }
  const setup = await liveInputFixture(snapshot);
  try {
    const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
    const captured = terminal.onData!;
    const capturedResize = terminal.onTerminalResize!;
    expect(terminal.height).toBeGreaterThanOrEqual(5);
    terminal.write(new TextEncoder().encode("\x1b[?1004h\x1b[?1000h\x1b[?1006h\x1b[?2004h"));
    setup.resized.length = 0;
    await act(async () => {
      setup.resize(120, 14);
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      setup.mockInput.pressKey("x");
      setup.mockInput.pasteBracketedText("ignored-paste");
      terminal.write(new TextEncoder().encode("\x1b[5n"));
      await setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1);
    });
    expect(setup.sent).toEqual([]);
    expect(setup.resized).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const coverage of ["none", "dialog", "drawer"] as const) {
  test(`${coverage} overlay restoration synchronizes the latest measured PTY size`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.tabs[0]!.layout = { type: "pane", paneId: "pane-1" };
    const setup = await liveInputFixture(initial);
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const capturedInput = terminal.onData!;
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      }
      await setup.flush();
      setup.resized.length = 0;
      for (const [width, height] of coverage === "drawer"
        ? [
            [105, 42],
            [110, 45],
          ]
        : [
            [140, 42],
            [150, 45],
          ]) {
        act(() => setup.resize(width!, height!));
        await setup.flush();
      }
      if (coverage !== "none") {
        capturedInput(Uint8Array.of(65), "input");
        expect(setup.sent).toEqual([]);
        expect(setup.resized).toEqual([]);
        await act(async () => setup.mockInput.pressEscape());
        await setup.flush();
      }
      const cols = coverage === "drawer" ? 103 : 98;
      expect([terminal.width, terminal.height]).toEqual([cols, 38]);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(setup.resized).toContainEqual({ paneId: "pane-1", cols, rows: 38 });
      setup.resized.length = 0;
      await setup.flush();
      expect(setup.resized).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const coverage of ["dialog", "drawer", "guard", "height"] as const) {
  test(`${coverage} restoration cannot refocus a terminal that stopped while covered`, async () => {
    const setup = await liveInputFixture();
    try {
      const terminal = setup.renderer.currentFocusedRenderable;
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      } else {
        act(() => setup.resize(coverage === "guard" ? 79 : 120, coverage === "height" ? 8 : 40));
      }
      await setup.flush();
      const stopped = splitSurfaceSnapshot();
      stopped.revision = 5;
      stopped.panes[0]!.processStatus = "exited";
      await setup.publish(stopped);
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressEscape());
      } else if (coverage === "drawer") {
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      } else {
        act(() => setup.resize(120, 40));
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal!);
      expect(terminal!.focusable).toBe(false);
      expect(setup.sent).toEqual([]);
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

test("session attachment focuses workspace without resetting focus on refresh", async () => {
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(workCraftStateFixture().snapshot!);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () =>
      publish((snapshot) => ({ ...snapshot, revision: snapshot.revision + 1 })),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace browsing follows rendered order after a shared-workspace session switch", async () => {
  const base = snapshotFixture();
  const snapshot = {
    ...base,
    workspaces: [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
      { id: "c", name: "Gamma" },
    ],
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "a", position: 0 },
      { sessionId: "session-work", workspaceId: "b", position: 1 },
      { sessionId: "session-work", workspaceId: "c", position: 2 },
      { sessionId: "session-personal", workspaceId: "a", position: 0 },
      { sessionId: "session-personal", workspaceId: "c", position: 1 },
      { sessionId: "session-personal", workspaceId: "b", position: 2 },
    ],
  };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["Work\r"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["Personal\r"]));
    await setup.flush();
    const group = setup.renderer.root.findDescendantById("region:workspace")!;
    expect(
      group
        .findDescendantById("workspace-scroll:viewport")!
        .getChildren()
        .map(({ id }) => id),
    ).toEqual(["workspace:a", "workspace:c", "workspace:b"]);
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
    });
    await setup.flush();
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:c") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const activation of ["Enter", "Space", "mouse"] as const) {
  test(`workspace activation enters category (${activation})`, async () => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
      await setup.flush();
      await act(async () => {
        if (activation === "mouse") {
          const row = setup.renderer.root.findDescendantById("workspace:workspace-shared")!;
          await setup.mockMouse.click(row.screenX, row.screenY);
        } else if (activation === "Space") {
          setup.mockInput.pressKey(" ");
        } else {
          setup.mockInput.pressEnter();
        }
      });
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("session reselection drills down while cancellation restores its origin", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an attached empty workspace bar allows creation but cannot activate", async () => {
  const snapshot = { ...workCraftStateFixture().snapshot!, workspaces: [], sessionWorkspaces: [] };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    expect(setup.captureCharFrame()).toContain("New workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

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
    surfaces: [{ id: "surface-1", itemId: "item-1", activeTabId: "tab-1" }],
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

for (const createKind of ["directory", "generic-root"] as const) {
  for (const order of ["snapshot first", "response first"] as const) {
    test(`first ${createKind} creation closes its form with ${order}`, async () => {
      const category = createKind === "directory" ? "implementation" : "design";
      const inputId = createKind === "directory" ? "create:path" : "create:title";
      const value = createKind === "directory" ? "/work/New root" : "New root";
      const initial = snapshotFixture({
        revision: 1,
        sessions: [{ id: "session-work", name: "Work", position: 0 }],
        categories: [
          { workspaceId: "workspace-shared", kind: category, title: category, position: 0 },
        ],
        items: [],
      });
      const created =
        createKind === "directory"
          ? {
              ...snapshotFixture().items[0]!,
              id: "new-root",
              title: "New root",
              data: {
                path: value,
                branch: null,
                availability: "available" as const,
                isGitCheckout: false,
                gitCommonDir: null,
              },
            }
          : {
              ...snapshotFixture().items[0]!,
              id: "new-root",
              title: value,
              category: "design" as const,
              kind: "generic" as const,
              data: {},
            };
      const surface = surfaceSnapshot();
      const ready: Snapshot = {
        ...initial,
        revision: 3,
        items: [created],
        surfaces: [{ ...surface.surfaces[0]!, itemId: "new-root" }],
        tabs: surface.tabs,
        panes: surface.panes,
      };
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const sent: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                sent.push(command);
                return command.type === "surface.ensure" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(inputId);
        await act(async () => setup.mockInput.typeText(value));
        await act(async () => setup.mockInput.pressEnter());
        expect(sent).toHaveLength(1);
        if (order === "snapshot first") {
          act(() => publish(ready));
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe(inputId);
        }
        await act(async () =>
          response.resolve({
            ok: true,
            revision: 2,
            result: { id: "new-root", itemId: "new-root", rootItemId: "new-root" },
          }),
        );
        await setup.flush();
        expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
        expect(sent[1]).toEqual({ type: "surface.ensure", itemId: "new-root" });
        await act(async () =>
          opened.resolve({ ok: true, revision: 3, result: { id: "surface-1" } }),
        );
        if (order === "response first") {
          act(() => publish(ready));
          await setup.flush();
        }
        expect(setup.renderer.root.findDescendantById("navigator-row:new-root")).toBeDefined();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
        expect(sent).toEqual([
          createKind === "directory"
            ? { type: "directory.register", workspaceId: "workspace-shared", path: value }
            : {
                type: "item.create",
                workspaceId: "workspace-shared",
                category: "design",
                title: value,
              },
          { type: "surface.ensure", itemId: "new-root" },
        ]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const kind of ["new-linked", "duplicate-linked", "generic-child"] as const) {
  for (const order of ["response first", "snapshot first"] as const) {
    for (const query of ["", "no match"] as const) {
      if (kind === "generic-child" && query) {
        continue;
      }
      test(`${kind} creation enters exact child with ${order}, query=${query}`, async () => {
        const generic = kind === "generic-child";
        const duplicate = kind === "duplicate-linked";
        const base = surfaceSnapshot();
        const items: Snapshot["items"] = generic
          ? base.items.map((item) => ({ ...item, category: "design", kind: "generic", data: {} }))
          : base.items;
        const ready: Snapshot = {
          ...base,
          revision: 3,
          items,
          categories: [
            {
              workspaceId: "workspace-shared",
              kind: generic ? "design" : "implementation",
              title: "Work",
              position: 0,
            },
          ],
        };
        const initial: Snapshot = duplicate
          ? { ...ready, revision: 1 }
          : {
              ...ready,
              revision: 1,
              items: kind === "new-linked" ? [] : [items[0]!],
              surfaces: [],
              tabs: [],
              panes: [],
            };
        const response = deferred<CommandResponse>();
        const opened = deferred<CommandResponse>();
        const commands: Command[] = [];
        let publish!: Dispatch<SetStateAction<Snapshot>>;
        function Fixture() {
          const [snapshot, setSnapshot] = useState(initial);
          publish = setSnapshot;
          return (
            <WorkCraftShell
              workCraft={workCraftStateFixture({
                snapshot,
                command: (command) => {
                  commands.push(command);
                  return command.type === "surface.ensure" ? opened.promise : response.promise;
                },
              })}
            />
          );
        }
        const setup = await testRender(<Fixture />, {
          width: 120,
          height: 40,
          kittyKeyboard: true,
        });
        try {
          await setup.flush();
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
          await act(async () => setup.mockInput.pressEnter());
          if (duplicate) {
            await act(async () => setup.mockInput.pressKey("l"));
            await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
            await setup.flush();
            commands.length = 0;
          }
          const originalTerminal = setup.renderer.root.findDescendantById("terminal:pane-1");
          if (query) {
            act(() => setup.renderer.root.findDescendantById("navigator:filter")!.focus());
            await act(async () => setup.mockInput.typeText(query));
            act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
          }
          if (generic) {
            await act(async () => setup.mockInput.pressKeys(["\x00n"]));
          } else {
            await act(async () => setup.mockInput.pressKey("n"));
          }
          await setup.flush();
          const value = generic ? "Child" : "/work/linked";
          await act(async () => setup.mockInput.typeText(value));
          await act(async () => setup.mockInput.pressEnter());
          expect(commands).toHaveLength(1);
          if (order === "snapshot first") {
            act(() => publish(ready));
            await setup.flush();
          }
          await act(async () =>
            response.resolve({
              ok: true,
              revision: 2,
              result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
            }),
          );
          await setup.flush();
          expect(commands.map(({ type }) => type)).toEqual([
            generic ? "item.create" : "directory.register",
            "surface.ensure",
          ]);
          expect(commands[1]).toEqual({ type: "surface.ensure", itemId: "item-1" });
          expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
          await act(async () =>
            opened.resolve({ ok: true, revision: 3, result: { id: "surface-1" } }),
          );
          if (order === "response first") {
            act(() => publish(ready));
          }
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
          expect(
            (setup.renderer.root.findDescendantById("navigator:filter") as InputRenderable).value,
          ).toBe(query);
          if (originalTerminal) {
            expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(
              originalTerminal,
            );
          }
          if (!query) {
            expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeDefined();
          }
        } finally {
          act(() => setup.renderer.destroy());
        }
      });
    }
  }
}

for (const width of [120, 100]) {
  for (const outcome of [
    "running",
    "starting",
    "exited",
    "ensure failure",
    "missing surface",
    "missing target",
    "undersized",
  ] as const) {
    test(`creation entry ${outcome} at width ${width} keeps successful metadata and drawer policy`, async () => {
      const ready = { ...surfaceSnapshot(), revision: 3 };
      const initial = { ...ready, revision: 1, surfaces: [], tabs: [], panes: [] };
      if (outcome === "starting" || outcome === "exited") {
        ready.panes[0]!.processStatus = outcome;
      }
      if (outcome === "missing surface") {
        ready.surfaces = [];
        ready.tabs = [];
        ready.panes = [];
      }
      if (outcome === "missing target") {
        ready.items = [ready.items[0]!];
        ready.surfaces = [];
        ready.tabs = [];
        ready.panes = [];
      }
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const commands: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                commands.push(command);
                return command.type === "surface.ensure" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, {
        width,
        height: outcome === "undersized" ? 7 : 40,
        kittyKeyboard: true,
      });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        await act(async () => setup.mockInput.typeText("/work/linked"));
        await act(async () => setup.mockInput.pressEnter());
        await act(async () =>
          response.resolve({
            ok: true,
            revision: 2,
            result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
          }),
        );
        await setup.flush();
        expect(commands.map(({ type }) => type)).toEqual(["directory.register", "surface.ensure"]);
        expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
        if (outcome === "ensure failure") {
          await act(async () => opened.reject(new Error("Cannot open requested checkout")));
        } else {
          await act(async () =>
            opened.resolve({ ok: true, revision: 3, result: { id: "surface-1" } }),
          );
        }
        act(() => publish(ready));
        await setup.flush();
        if (outcome === "starting") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          expect(statusText(setup)).not.toContain("failed");
          act(() =>
            publish({ ...ready, panes: [{ ...ready.panes[0]!, processStatus: "running" }] }),
          );
          await setup.flush();
        }
        if (outcome === "running" || outcome === "starting") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
        } else {
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
          expect(statusText(setup)).toContain("failed");
          expect(statusText(setup)).not.toContain("directory.register failed");
          if (width === 100) {
            expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(
              true,
            );
          }
          // Later readiness must not resurrect a failed entry.
          act(() => publish({ ...surfaceSnapshot(), revision: 4 }));
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
        }
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const stage of ["registration", "ensure", "readiness"] as const) {
  for (const cancel of [
    "input",
    "native leave-and-return",
    "pointer press",
    "disclosure press",
    "form cancellation",
    "replacement",
    "context",
    "epoch",
    "guard",
    "hide",
    "archive",
  ] as const) {
    if ((cancel === "form cancellation" || cancel === "replacement") && stage !== "registration") {
      continue;
    }
    if ((cancel === "pointer press" || cancel === "disclosure press") && stage === "registration") {
      continue;
    }
    test(`creation ${stage} is cancelled by ${cancel} without stale entry`, async () => {
      const ready = { ...surfaceSnapshot(), revision: 3 };
      const initial = { ...ready, revision: 1, surfaces: [], tabs: [], panes: [] };
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const commands: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                commands.push(command);
                return command.type === "surface.ensure" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        await act(async () => setup.mockInput.typeText("/work/linked"));
        await act(async () => setup.mockInput.pressEnter());
        const registered: CommandResponse = {
          ok: true,
          revision: 2,
          result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
        };
        if (stage !== "registration") {
          await act(async () => response.resolve(registered));
          await setup.flush();
        }
        if (stage === "readiness") {
          await act(async () =>
            opened.resolve({ ok: true, revision: 3, result: { id: "surface-1" } }),
          );
          act(() =>
            publish({ ...ready, panes: [{ ...ready.panes[0]!, processStatus: "starting" }] }),
          );
          await setup.flush();
        }
        let final = ready;
        if (cancel === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancel === "native leave-and-return") {
          const origin = setup.renderer.currentFocusedRenderable!;
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            origin.focus();
          });
        } else if (cancel === "pointer press" || cancel === "disclosure press") {
          const row = setup.renderer.root.findDescendantById("navigator-row:root-1")!;
          await act(async () =>
            setup.mockMouse.pressDown(
              row.screenX + (cancel === "pointer press" ? 8 : 2),
              row.screenY,
            ),
          );
          await act(async () => setup.mockMouse.release(0, 0));
        } else if (cancel === "form cancellation" || cancel === "replacement") {
          await act(async () => setup.mockInput.pressEscape());
          if (cancel === "replacement") {
            await act(async () => setup.mockInput.pressKey("n"));
            await setup.flush();
            await act(async () => setup.mockInput.typeText("/work/replacement"));
          }
        } else if (cancel === "context") {
          final = {
            ...ready,
            categories: [
              { workspaceId: "workspace-shared", kind: "design", title: "Design", position: 0 },
            ],
          };
        } else if (cancel === "epoch") {
          final = { ...ready, epoch: "replacement-epoch" };
        } else if (cancel === "guard") {
          act(() => setup.resize(79, 40));
        } else if (cancel === "hide") {
          await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        } else {
          final = { ...ready, items: ready.items.map((item) => ({ ...item, archived: true })) };
        }
        act(() => publish(final));
        await setup.flush();
        await act(async () => response.resolve(registered));
        await act(async () =>
          opened.resolve({ ok: true, revision: 3, result: { id: "surface-1" } }),
        );
        await setup.flush();
        if (cancel === "guard") {
          act(() => setup.resize(120, 40));
          await setup.flush();
        }
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
        if (stage === "registration") {
          expect(commands).toHaveLength(1);
        }
        if (cancel === "replacement") {
          expect(
            (setup.renderer.root.findDescendantById("create:path") as InputRenderable).value,
          ).toBe("/work/replacement");
        }
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("generic child creation from a native terminal enters the new child's terminal", async () => {
  const base = surfaceSnapshot();
  const initial: Snapshot = {
    ...base,
    items: base.items.map((item) => ({ ...item, category: "design", kind: "generic", data: {} })),
    categories: [{ workspaceId: "workspace-shared", kind: "design", title: "Design", position: 0 }],
  };
  const response = deferred<CommandResponse>();
  const opened = deferred<CommandResponse>();
  const commands: Command[] = [];
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: (command) => {
            commands.push(command);
            return command.type === "surface.ensure" ? opened.promise : response.promise;
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    act(() => setup.renderer.root.findDescendantById("terminal:pane-1")!.focus());
    await setup.flush();
    commands.length = 0;
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["New child\r"]));
    expect(commands).toEqual([
      {
        type: "item.create",
        workspaceId: "workspace-shared",
        category: "design",
        title: "New child",
        parentId: "root-1",
      },
    ]);
    await act(async () => response.resolve({ ok: true, revision: 5, result: { id: "new-child" } }));
    await setup.flush();
    expect(commands[1]).toEqual({ type: "surface.ensure", itemId: "new-child" });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => opened.resolve({ ok: true, revision: 6, result: { id: "surface-2" } }));
    act(() =>
      publish({
        ...initial,
        revision: 6,
        items: [...initial.items, { ...initial.items[1]!, id: "new-child" }],
        surfaces: [
          ...initial.surfaces,
          { id: "surface-2", itemId: "new-child", activeTabId: "tab-2" },
        ],
        tabs: [
          ...initial.tabs,
          {
            ...initial.tabs[0]!,
            id: "tab-2",
            surfaceId: "surface-2",
            layout: { type: "pane", paneId: "pane-2" },
          },
        ],
        panes: [...initial.panes, { ...initial.panes[0]!, id: "pane-2", surfaceId: "surface-2" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer registration supersedes the old form without blocking its own terminal entry", async () => {
  const first = deferred<CommandResponse>();
  const second = deferred<CommandResponse>();
  const opened = deferred<CommandResponse>();
  const commands: Command[] = [];
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState({
      ...surfaceSnapshot(),
      revision: 1,
      surfaces: [],
      tabs: [],
      panes: [],
    } as Snapshot);
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: (command) => {
            commands.push(command);
            return command.type === "surface.ensure"
              ? opened.promise
              : commands.length === 1
                ? first.promise
                : second.promise;
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    for (const path of ["/work/old", "/work/new"]) {
      await act(async () => setup.mockInput.pressKey("n"));
      await setup.flush();
      await act(async () => setup.mockInput.typeText(path));
      await act(async () => setup.mockInput.pressEnter());
      if (path === "/work/old") {
        await act(async () => setup.mockInput.pressEscape());
      }
    }
    await act(async () =>
      first.resolve({
        ok: true,
        revision: 2,
        result: { id: "root-1", itemId: "root-1", rootItemId: "root-1" },
      }),
    );
    await setup.flush();
    expect(commands).toHaveLength(2);
    expect((setup.renderer.root.findDescendantById("create:path") as InputRenderable).value).toBe(
      "/work/new",
    );
    await act(async () =>
      second.resolve({
        ok: true,
        revision: 3,
        result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
      }),
    );
    expect(commands[2]).toEqual({ type: "surface.ensure", itemId: "item-1" });
    await act(async () => opened.resolve({ ok: true, revision: 4, result: { id: "surface-1" } }));
    act(() => publish({ ...surfaceSnapshot(), revision: 4 }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a cancelled ensure failure cannot report status over a replacement form", async () => {
  const opened = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: (command) =>
          command.type === "surface.ensure"
            ? opened.promise
            : Promise.resolve({
                ok: true,
                revision: 4,
                result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
              }),
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["/work/linked\r"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:path");
    await act(async () => opened.reject(new Error("Obsolete entry failure")));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(input!);
    expect(statusText(setup)).not.toContain("Obsolete entry failure");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("directory validation retry retains edited input and deduplicates buffered submits", async () => {
  const response = deferred<CommandResponse>();
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: (command) => {
          commands.push(command);
          return response.promise;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:path") as InputRenderable;
    await act(async () => setup.mockInput.pressKeys(["/work/linkedX\x08\t\r\r"]));
    expect(commands).toEqual([
      { type: "directory.register", workspaceId: "workspace-shared", path: "/work/linked" },
    ]);
    await act(async () => response.reject(new ApiError("Invalid checkout path", "path")));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("create:path")).toBe(input);
    expect(input.value).toBe("/work/linked");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:submit");
    expect(setup.captureCharFrame()).toContain("Invalid checkout path");
    expect(statusText(setup)).not.toContain("directory.register failed");
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toHaveLength(2);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

function splitSurfaceSnapshot(): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => ({
      ...tab,
      layout: {
        type: "split" as const,
        direction: "vertical" as const,
        ratio: 0.5,
        first: { type: "pane" as const, paneId: "pane-1" },
        second: { type: "pane" as const, paneId: "pane-2" },
      },
    })),
    panes: [...snapshot.panes, { ...snapshot.panes[0]!, id: "pane-2", title: "Second" }],
  };
}

function twoSurfaceSnapshot(): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    items: [
      ...snapshot.items,
      { ...snapshot.items[1]!, id: "item-2", title: "Second item", position: 1 },
    ],
    surfaces: [...snapshot.surfaces, { id: "surface-2", itemId: "item-2", activeTabId: "tab-2" }],
    tabs: [
      ...snapshot.tabs,
      {
        id: "tab-2",
        surfaceId: "surface-2",
        title: "Second",
        position: 0,
        layout: { type: "pane" as const, paneId: "pane-2" },
      },
    ],
    panes: [...snapshot.panes, { ...snapshot.panes[0]!, id: "pane-2", surfaceId: "surface-2" }],
  };
}

function twoTabSnapshot(activeTabId = "tab-1", revision = 4, count = 2): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    revision,
    surfaces: [{ ...snapshot.surfaces[0]!, activeTabId }],
    tabs: Array.from({ length: count }, (_, index) => index + 1).map((tab) => ({
      ...snapshot.tabs[0]!,
      id: `tab-${tab}`,
      position: tab - 1,
      title: `Tab ${tab}`,
      layout: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "pane", paneId: `pane-${tab}a` },
        second: { type: "pane", paneId: `pane-${tab}b` },
      },
    })),
    panes: Array.from({ length: count }, (_, index) => [`${index + 1}a`, `${index + 1}b`])
      .flat()
      .map((id) => ({ ...snapshot.panes[0]!, id: `pane-${id}` })),
  };
}

async function localTabFixture(rememberDestination = true, count = 2, creating = false) {
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  let connect!: (value: boolean) => void;
  const requests: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const commands: Command[] = [];
  const received: { paneId: string; bytes: number[] }[] = [];
  function Fixture() {
    const [snapshot, setSnapshot] = useState(
      twoTabSnapshot(rememberDestination ? "tab-2" : "tab-1", 4, count),
    );
    const [connected, setConnected] = useState(true);
    connect = setConnected;
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          status: connected ? "connected" : "disconnected",
          canSendInput: () => connected,
          stream: {
            close() {},
            resize() {},
            sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
          },
          command: async (command) => {
            commands.push(command);
            if (
              command.type === "surface.selectTab" ||
              command.type === "process.restart" ||
              command.type === "tab.create"
            ) {
              const request = deferred<CommandResponse>();
              requests.push(request);
              return request.promise;
            }
            return { ok: true, revision: 4, result: { id: "surface-1" } };
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  await setup.flush();
  await openFixtureItem(setup);
  if (rememberDestination) {
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    act(() => publish(twoTabSnapshot("tab-1")));
    await setup.flush();
  } else {
    act(() => setup.renderer.root.findDescendantById("terminal:pane-1a")!.focus());
    await setup.flush();
  }
  await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
  commands.length = 0;
  return {
    ...setup,
    commands,
    requests,
    received,
    connect: (value: boolean) => act(() => connect(value)),
    publish: (snapshot: Snapshot) => act(() => publish(snapshot)),
    respond: (index = 0, revision = 5) =>
      act(async () =>
        requests[index]!.resolve({
          ok: true,
          revision,
          result: { id: "tab-2", ...(creating ? { tabId: "tab-2", paneId: "pane-2b" } : {}) },
        }),
      ),
    next: () => act(async () => setup.mockInput.pressKey(creating ? "n" : "]", { hyper: true })),
    previous: () => act(async () => setup.mockInput.pressKey("[", { hyper: true })),
  };
}

test("tab entry waits across a frame before the new terminal has native layout", async () => {
  const setup = await localTabFixture(false);
  try {
    await setup.next();
    await setup.respond();
    setup.publish(twoTabSnapshot("tab-2", 5));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-2a")!;
    expect(terminal.width).toBe(0);
    act(() => setup.renderer.emit(CliRenderEvents.FRAME, { frameId: 100 }));
    expect(statusText(setup)).not.toContain("too small");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
    await act(async () => setup.mockInput.pressKey("x"));
    expect(setup.received).toEqual([{ paneId: "pane-2a", bytes: [120] }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("explicit tab entry focuses the selected exited action without pressing; action-source Hyper and leader never become terminal input", async () => {
  const setup = await localTabFixture(false);
  try {
    const stopped = twoTabSnapshot("tab-1", 5);
    stopped.panes
      .filter((pane) => pane.id.startsWith("pane-1"))
      .forEach((pane) => {
        pane.processStatus = "exited";
      });
    setup.publish(stopped);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressEnter());
    await setup.respond(0, 5);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reactivate:pane-1b");
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
    await act(async () => setup.mockInput.pressKeys(["\x00\x00"]));
    await act(async () => setup.mockInput.pasteBracketedText("not terminal data"));
    expect(setup.received).toEqual([]);
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.respond(1, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).not.toStartWith("terminal:");
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const [width, height, eligible] of [
  [20, 4, true],
  [19, 4, false],
  [20, 3, false],
  [20, 2, false],
] as const) {
  test(`native ${width}x${height} action eligibility is separate from 20x5 terminal readiness`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.tabs[0]!.layout = {
      type: "split",
      direction: "vertical",
      ratio: width / 67,
      first: {
        type: "split",
        direction: "horizontal",
        ratio: height / 33,
        first: { type: "pane", paneId: "pane-1" },
        second: { type: "pane", paneId: "pane-3" },
      },
      second: { type: "pane", paneId: "pane-2" },
    };
    initial.panes[0]!.processStatus = "exited";
    initial.panes.push({ ...initial.panes[1]!, id: "pane-3" });
    const setup = await liveInputFixture(initial);
    try {
      const button = setup.renderer.root.findDescendantById("reactivate:pane-1")!;
      expect(button.focusable).toBe(eligible);
      const original = setup.renderer.root.findDescendantById("terminal:pane-1")!;
      expect(original.parent!.width).toBe(width);
      expect(original.visible).toBe(false);
      expect(original.parent!.height).toBe(height);
      if (eligible) {
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        const next = structuredClone(initial);
        next.revision = 5;
        next.panes[0]!.processStatus = "running";
        await setup.publish(next);
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } }),
        );
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(original.focusable).toBe(false);
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(original);
        expect(statusText(setup)).toContain("too small");
      }
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const order of ["response first", "snapshot first"] as const) {
  test(`buffered strip right/right/Enter waits for exact requested revision with ${order}`, async () => {
    const setup = await localTabFixture(false, 3);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\x1b[C\r")));
      expect(setup.commands).toEqual([
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-3" },
      ]);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      if (order === "response first") {
        await setup.respond(1, 6);
        setup.publish(twoTabSnapshot("tab-3", 5, 3));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      }
      setup.publish(twoTabSnapshot("tab-3", 6, 3));
      await setup.flush();
      if (order === "snapshot first") {
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        await setup.respond(1, 6);
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3a");
      await setup.respond(0, 5);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3a");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const pointer of ["wheel", "arrow", "edge arrow"] as const) {
  for (const stage of ["before response", "after response", "snapshot first"] as const) {
    test(`contained strip ${pointer} cancels delayed entry ${stage} without undoing selection; fresh Enter works`, async () => {
      const setup = await localTabFixture(false, 12);
      try {
        const list = setup.renderer.root.findDescendantById("region:tabs")!;
        act(() => list.focus());
        await setup.flush();
        act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
        expect(setup.commands).toEqual([
          { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        ]);
        if (stage === "after response") {
          await setup.respond();
        } else if (stage === "snapshot first") {
          setup.publish(twoTabSnapshot("tab-2", 5, 12));
        }
        await setup.flush();
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
        expect(area.scrollLeft).toBe(0);
        const before = area.scrollLeft;
        if (pointer === "wheel") {
          await act(async () =>
            setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
          );
        } else {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.pressDown(arrow.screenX, arrow.screenY));
          expect(area.scrollLeft).toBe(before);
          // Commit while held: primary down, not release/viewport movement, is newer intent.
        }
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        if (stage !== "after response") {
          await setup.respond();
        }
        setup.publish(twoTabSnapshot("tab-2", 5, 12));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.renderer.root.findDescendantById("terminal:pane-2a")).toBeDefined();
        expect(setup.commands).toHaveLength(1);
        if (pointer !== "wheel") {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.release(arrow.screenX, arrow.screenY));
        }
        await setup.flush();
        if (pointer === "edge arrow") {
          expect(area.scrollLeft).toBe(before);
        } else {
          expect(area.scrollLeft).toBeGreaterThan(before);
        }
        setup.publish(twoTabSnapshot("tab-2", 6, 12));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.received).toEqual([]);
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.commands.at(-1)).toEqual({
          type: "surface.selectTab",
          surfaceId: "surface-1",
          tabId: "tab-2",
        });
        await setup.respond(1, 6);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }

  test(`contained strip ${pointer} preserves outside focus across late selection`, async () => {
    const setup = await localTabFixture(false, 12);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
      const outside = setup.renderer.root.findDescendantById("region:category")!;
      act(() => outside.focus());
      await setup.flush();
      const area = setup.renderer.root.findDescendantById(
        "region:tabs:scroller:viewport",
      ) as ScrollBoxRenderable;
      if (pointer === "wheel") {
        await act(async () =>
          setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
        );
      } else {
        const arrow = setup.renderer.root.findDescendantById(
          `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
        )!;
        await act(async () => setup.mockMouse.click(arrow.screenX, arrow.screenY));
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      setup.publish(twoTabSnapshot("tab-2", 5, 12));
      await setup.respond();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      expect(setup.commands).toHaveLength(1);
      expect(setup.received).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });

  for (const duplicate of [false, true]) {
    test(`contained strip ${pointer} cancels response-first restart entry (duplicate attempts=${duplicate})`, async () => {
      const setup = await localTabFixture(false, 12);
      try {
        const stopped = twoTabSnapshot("tab-1", 5, 12);
        stopped.panes.find((pane) => pane.id === "pane-1b")!.processStatus = "exited";
        setup.publish(stopped);
        await setup.flush();
        const button = setup.renderer.root.findDescendantById("reactivate:pane-1b")!;
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        await setup.respond(0, 7);
        await setup.flush();
        expect(button.focusable).toBe(false);
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        if (pointer === "wheel") {
          await act(async () =>
            setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
          );
        } else {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.click(arrow.screenX, arrow.screenY));
        }
        if (duplicate) {
          setup.publish({ ...stopped, revision: 6 });
          await setup.flush();
          expect(button.focusable).toBe(false);
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        }
        // Without duplicate attempts, scrolling is the only newer intent before readiness.
        setup.publish(twoTabSnapshot("tab-1", 7, 12));
        await setup.flush();
        expect(setup.commands).toEqual([{ type: "process.restart", paneId: "pane-1b" }]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.received).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("fresh Enter after contained strip scrolling reuses the unresolved durable selection", async () => {
  const setup = await localTabFixture(false, 12);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
    const edge = setup.renderer.root.findDescendantById("region:tabs:scroller:left")!;
    await act(async () => setup.mockMouse.click(edge.screenX, edge.screenY));
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    setup.publish(twoTabSnapshot("tab-2", 5, 12));
    await setup.respond();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
    expect(setup.received).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("strip browsing selects without entry and a rejected latest selection restores active cursor", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    expect(setup.renderer.root.findDescendantById("terminal:pane-1b")).toBeDefined();
    await act(async () => setup.requests[0]!.reject(new Error("Selection rejected")));
    await setup.flush();
    expect(statusText(setup)).toContain("Selection rejected");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.at(-1)).toEqual({
      type: "surface.selectTab",
      surfaceId: "surface-1",
      tabId: "tab-1",
    });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("rapid reversal ignores older failure and mouse intent supersedes pending strip entry", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\x1b[D\r")));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-1" },
    ]);
    const tab = setup.renderer.root.findDescendantById("tab:tab-2")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(setup.commands).toHaveLength(3);
    await act(async () => setup.requests[0]!.reject(new Error("Obsolete selection")));
    await setup.respond(1, 6);
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    expect(statusText(setup)).not.toContain("Obsolete selection");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer control-source Hyper selection cannot be rolled back by the old strip request", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.next();
    await act(async () => setup.requests[0]!.reject(new Error("Obsolete browse")));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.at(-1)).toEqual({
      type: "surface.selectTab",
      surfaceId: "surface-1",
      tabId: "tab-2",
    });
    expect(statusText(setup)).not.toContain("Obsolete browse");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("clicking and reclicking the active tab enters via one guarded no-op selection", async () => {
  const setup = await localTabFixture();
  try {
    for (const revision of [5, 6]) {
      const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
      await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      expect(setup.commands).toHaveLength(revision - 4);
      expect(setup.commands.at(-1)).toEqual({
        type: "surface.selectTab",
        surfaceId: "surface-1",
        tabId: "tab-1",
      });
      await setup.respond(revision - 5, revision);
      setup.publish(twoTabSnapshot("tab-1", revision));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer explicit Enter reuses an active-tab selection without losing its response", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands).toHaveLength(1);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-1", 5));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("entry after a settled browse obtains a fresh revision instead of reusing an obsolete selection", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" "));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    await setup.respond(1, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disconnected strip browsing and activation send no commands or terminal input", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    setup.connect(false);
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
    await setup.flush();
    expect(setup.commands).toEqual([]);
    expect(setup.received).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(statusText(setup)).not.toContain("Enter terminal");
    setup.connect(true);
    await setup.flush();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const owner of ["item-1", "root-1"] as const) {
  for (const newerEntry of [false, true]) {
    test(`${owner} archive then unarchive before selection response cancels entry${newerEntry ? " without undoing newer intent" : " permanently"}`, async () => {
      const setup = await localTabFixture();
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
        expect(setup.commands).toHaveLength(1);
        setup.publish(twoTabSnapshot("tab-2", 5));
        await setup.flush();
        const archived = twoTabSnapshot("tab-2", 6);
        archived.items.find((item) => item.id === owner)!.archived = true;
        setup.publish(archived);
        await setup.flush();
        setup.publish(twoTabSnapshot("tab-2", 7));
        await setup.flush();
        if (newerEntry) {
          const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
          await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
          expect(setup.commands).toHaveLength(2);
        }
        await setup.respond(0, 5);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        setup.publish(twoTabSnapshot(newerEntry ? "tab-1" : "tab-2", 8));
        if (newerEntry) {
          await setup.respond(1, 8);
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          newerEntry ? "terminal:pane-1b" : "region:tabs",
        );
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("archived parent suppresses strip entry hints and requests without disabling browsing", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    const archived = twoTabSnapshot("tab-1", 5);
    archived.items.find((item) => item.id === "root-1")!.archived = true;
    setup.publish(archived);
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("region:tabs")!;
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey(" "));
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(setup.commands).toEqual([]);
    expect(getControlHints(list)).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.respond(0, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const cancel of ["focus", "dialog", "item", "archive", "epoch", "disconnect"] as const) {
  test(`strip activation is cancelled by newer ${cancel} before readiness`, async () => {
    const setup = await localTabFixture();
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
      expect(setup.commands).toHaveLength(1);
      const ready = twoTabSnapshot("tab-2", 5);
      if (cancel === "focus") {
        act(() => {
          setup.renderer.root.findDescendantById("region:category")!.focus();
          setup.renderer.root.findDescendantById("region:tabs")!.focus();
        });
      } else if (cancel === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        await setup.flush();
        await act(async () => setup.mockInput.pressEscape());
      } else if (cancel === "item") {
        const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
        await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
      } else if (cancel === "archive") {
        ready.items.find((item) => item.id === "item-1")!.archived = true;
      } else if (cancel === "epoch") {
        ready.epoch = "replacement-epoch";
      } else {
        setup.connect(false);
      }
      setup.publish(ready);
      await setup.flush();
      await setup.respond();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
      setup.connect(true);
      setup.publish({ ...ready, revision: 6 });
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const stage of ["before response", "after response"] as const) {
  for (const interaction of ["paste", "same-source pane mouse-down"] as const) {
    test(`terminal ${interaction} cancels pending tab entry ${stage} without changing bytes`, async () => {
      const setup = await localTabFixture();
      try {
        const source = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
        await setup.next();
        if (stage === "after response") {
          await setup.respond();
        }
        if (interaction === "paste") {
          act(() => source.write(new TextEncoder().encode("\x1b[?2004h")));
          await act(async () => setup.mockInput.pasteBracketedText("source-only"));
          expect(setup.received).toEqual([
            {
              paneId: "pane-1b",
              bytes: [...new TextEncoder().encode("\x1b[200~source-only\x1b[201~")],
            },
          ]);
        } else {
          await act(async () => setup.mockMouse.pressDown(source.screenX + 1, source.screenY + 1));
          expect(setup.received).toEqual([]);
        }
        expect(setup.renderer.currentFocusedRenderable === source).toBe(true);
        if (stage === "before response") {
          await setup.respond();
        }
        setup.publish(twoTabSnapshot("tab-2", 5));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        setup.publish(twoTabSnapshot("tab-2", 6));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }

  test(`terminal emulator reply preserves pending tab entry ${stage} and its response bytes`, async () => {
    const setup = await localTabFixture();
    try {
      const source = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      await setup.next();
      if (stage === "after response") {
        await setup.respond();
      }
      act(() => source.write(new TextEncoder().encode("\x1b[5n")));
      expect(setup.received).toEqual([
        { paneId: "pane-1b", bytes: [...new TextEncoder().encode("\x1b[0n")] },
      ]);
      if (stage === "before response") {
        await setup.respond();
      }
      setup.publish(twoTabSnapshot("tab-2", 5));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const order of ["response first", "snapshot first"] as const) {
  test(`terminal Hyper tab switch enters destination memory with ${order}`, async () => {
    const setup = await localTabFixture();
    try {
      const originalTerminal = setup.renderer.currentFocusedRenderable;
      await setup.previous();
      expect(setup.commands).toEqual([]);
      expect(setup.renderer.currentFocusedRenderable === originalTerminal).toBe(true);
      await setup.next();
      if (order === "response first") {
        await setup.respond();
        expect(setup.renderer.currentFocusedRenderable === originalTerminal).toBe(true);
      }
      setup.publish(twoTabSnapshot("tab-2", 5));
      await setup.flush();
      const destination = setup.renderer.root.findDescendantById("terminal:pane-2b");
      if (order === "snapshot first") {
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        await setup.respond();
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
      expect(setup.renderer.currentFocusedRenderable === destination).toBe(true);
      expect(setup.commands).toEqual([
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      ]);
      await setup.previous();
      await setup.respond(1, 6);
      setup.publish(twoTabSnapshot("tab-1", 6));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("control-source Hyper preserves strip focus, mouse enters, and background snapshots preserve controls", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.respond();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.respond(1, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("tab pointer-down cancels a snapshot-first projected entry even on the same native endpoint", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    const tab = setup.renderer.root.findDescendantById("region:tabs")!;
    await act(async () => setup.mockMouse.pressDown(tab.screenX + tab.width - 1, tab.screenY));
    expect(setup.commands).toHaveLength(1);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("tab entry recovery clears only its own source after a deliberate successful retry", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    const stopped = twoTabSnapshot("tab-2", 5);
    stopped.panes
      .filter((pane) => pane.id.startsWith("pane-2"))
      .forEach((pane) => {
        pane.processStatus = "exited";
      });
    await setup.respond();
    setup.publish(stopped);
    await setup.flush();
    expect(statusText(setup)).toContain("Tab 2");
    expect(statusText(setup)).toContain("Terminal entry failed");
    // Browsing back and entering the source tab is not recovery for Tab 2.
    await setup.previous();
    await setup.respond(1, 6);
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
    expect(statusText(setup)).toContain("Terminal entry failed");
    await setup.next();
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const order of ["response first", "snapshot first"] as const) {
  for (const remembered of [false, true]) {
    test(`tab entry skips ${remembered ? "remembered" : "first"} tiny pane with ${order}`, async () => {
      const setup = await localTabFixture(remembered);
      try {
        await setup.next();
        const ready = twoTabSnapshot("tab-2", 5);
        const layout = ready.tabs[1]!.layout!;
        if (layout.type === "split") {
          layout.ratio = remembered ? 0.9 : 0.1;
        }
        if (order === "response first") {
          await setup.respond();
        }
        setup.publish(ready);
        await setup.flush();
        if (order === "snapshot first") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await setup.respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          remembered ? "terminal:pane-2a" : "terminal:pane-2b",
        );
        expect(statusText(setup)).not.toContain("Terminal entry failed");
        expect(setup.commands).toEqual([
          { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        ]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("item entry skips its tiny first pane for a usable running sibling", async () => {
  const snapshot = splitSurfaceSnapshot();
  const layout = snapshot.tabs[0]!.layout!;
  if (layout.type === "split") {
    layout.ratio = 0.1;
  }
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const remembered of ["stopped", "missing"] as const) {
  test(`tab entry falls back from ${remembered} memory to the first running destination pane`, async () => {
    const setup = await localTabFixture();
    try {
      await setup.next();
      const ready = twoTabSnapshot("tab-2", 5);
      if (remembered === "stopped") {
        ready.panes.find((pane) => pane.id === "pane-2b")!.processStatus = "exited";
      } else {
        ready.panes = ready.panes.filter((pane) => pane.id !== "pane-2b");
      }
      setup.publish(ready);
      await setup.respond();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const destination of [
  "starting",
  "stopped",
  "empty",
  "missing tab",
  "missing panes",
  "undersized",
] as const) {
  test(`tab entry handles ${destination} without choosing another tab or reviving failed entry`, async () => {
    const setup = await localTabFixture();
    try {
      await setup.next();
      const ready = twoTabSnapshot("tab-2", 5);
      if (destination === "starting" || destination === "stopped") {
        for (const pane of ready.panes.filter((pane) => pane.id.startsWith("pane-2"))) {
          pane.processStatus = destination === "starting" ? "starting" : "exited";
        }
      } else if (destination === "empty") {
        ready.tabs[1]!.layout = null;
      } else if (destination === "missing tab") {
        ready.tabs = ready.tabs.slice(0, 1);
      } else if (destination === "missing panes") {
        ready.panes = ready.panes.filter((pane) => !pane.id.startsWith("pane-2"));
      } else {
        const layout = ready.tabs[1]!.layout!;
        if (layout.type === "split") {
          layout.ratio = 0.9999;
        }
        ready.panes.find((pane) => pane.id === "pane-2a")!.processStatus = "exited";
      }
      await setup.respond();
      setup.publish(ready);
      await setup.flush();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      if (destination === "stopped") {
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-2b" });
      }
      if (destination !== "starting") {
        expect(statusText(setup)).toContain("Terminal entry failed");
      }
      setup.publish(twoTabSnapshot("tab-2", 6));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        destination === "starting" ? "terminal:pane-2b" : "region:tabs",
      );
      expect(setup.commands.filter((command) => command.type === "surface.selectTab")).toHaveLength(
        1,
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const stage of [
  "before response",
  "after response",
  "snapshot first",
  "create before response",
] as const) {
  for (const cancel of [
    "input",
    "native leave-and-return",
    "dialog",
    "drawer",
    "guard",
    "context",
    "epoch",
  ] as const) {
    test(`local tab entry cancels on ${cancel} ${stage}`, async () => {
      const setup =
        stage === "create before response"
          ? await localTabFixture(false, 1, true)
          : await localTabFixture();
      try {
        await setup.next();
        if (stage === "after response") {
          await setup.respond();
        }
        if (stage === "snapshot first") {
          setup.publish(twoTabSnapshot("tab-2", 5));
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (cancel === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancel === "native leave-and-return") {
          const origin = setup.renderer.currentFocusedRenderable!;
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            origin.focus();
          });
        } else if (cancel === "dialog") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          await act(async () => setup.mockInput.pressEscape());
        } else if (cancel === "drawer") {
          act(() => setup.resize(100, 40));
          await setup.flush();
          await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        } else if (cancel === "guard") {
          act(() => setup.resize(79, 40));
          await setup.flush();
          act(() => setup.resize(120, 40));
        } else if (cancel === "context") {
          const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
          await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
          await setup.flush();
          expect(setup.renderer.root.findDescendantById("terminal:pane-1b")).toBeUndefined();
        }
        const ready = twoTabSnapshot("tab-2", 6);
        if (cancel === "epoch") {
          ready.epoch = "epoch-replaced";
        }
        if (cancel === "epoch") {
          setup.publish(ready);
          await setup.flush();
        }
        if (stage !== "after response") {
          await setup.respond();
        }
        setup.publish(ready);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
        setup.publish({ ...ready, revision: 7 });
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("repeated and reversed tab requests ignore out-of-order completions", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    await setup.next();
    await setup.respond(1, 6);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    await setup.previous();
    setup.publish(twoTabSnapshot("tab-1", 7));
    await setup.flush();
    // Reversing from the projected tabs is browsing, not new terminal intent.
    await setup.next();
    await setup.respond(3, 8);
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

async function openFixtureItem(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  await setup.flush();
  // Hyper selection intentionally does not create local terminal-entry intent.
  await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
  await setup.flush();
}

for (const width of [120, 80]) {
  for (const empty of [false, true]) {
    for (const activation of ["Enter", "Space", "mouse"] as const) {
      test(`category activation enters navigation (${width}, empty=${empty}, ${activation})`, async () => {
        const snapshot = workCraftStateFixture().snapshot!;
        const setup = await testRender(
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot: empty ? { ...snapshot, items: [] } : snapshot,
            })}
          />,
          { width, height: 40, kittyKeyboard: true },
        );
        try {
          await setup.flush();
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
          await setup.flush();
          await act(async () => {
            if (activation === "mouse") {
              const row = setup.renderer.root.findDescendantById("category:implementation")!;
              await setup.mockMouse.click(row.screenX + 2, row.screenY);
            } else if (activation === "Space") {
              setup.mockInput.pressKey(" ");
            } else {
              setup.mockInput.pressEnter();
            }
          });
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
        } finally {
          act(() => setup.renderer.destroy());
        }
      });
    }
  }
}

test("Hyper category selection preserves focus and a hidden navigator", async () => {
  const snapshot = {
    ...snapshotFixture(),
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
  };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("l", { hyper: true }));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    const selected = setup.renderer.root.findDescendantById("category:today") as BoxRenderable;
    expect(selected.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.muted).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered workspace activation hands subsequent keys to category", async () => {
  const base = workCraftStateFixture().snapshot!;
  const snapshot = {
    ...base,
    categories: [
      { workspaceId: "workspace-shared", kind: "inbox" as const, title: "Inbox", position: 0 },
      { workspaceId: "workspace-shared", kind: "today" as const, title: "Today", position: 1 },
      { workspaceId: "workspace-work", kind: "inbox" as const, title: "Inbox", position: 0 },
      { workspaceId: "workspace-work", kind: "today" as const, title: "Today", position: 1 },
    ],
  };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
      setup.mockInput.pressKey("j");
    });
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:workspace-work") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    expect(
      (
        setup.renderer.root.findDescendantById("category:today") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    expect(setup.captureCharFrame()).toContain("TODAY");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category Enter enters expanded and compact navigators while project Enter stays local", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    act(() => setup.resize(119, 40));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const initiallyHidden of [false, true]) {
  test(`buffered category activation cannot undo navigator reveal (hidden=${initiallyHidden})`, async () => {
    const snapshot = {
      ...snapshotFixture(),
      sessions: [{ id: "session-work", name: "Work", position: 0 }],
    };
    const setup = await testRender(
      <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
      if (initiallyHidden) {
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        await setup.flush();
        expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
        await act(async () => setup.mockInput.pressKeys(["\rj\r"]));
      } else {
        await act(async () => setup.mockInput.pressKeys(["\x00b\r"]));
      }
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("category activation reveals a manually hidden navigator and retains focus", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("b"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.renderOnce());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("b"));
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    act(() => setup.resize(120, 4));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category Enter enters an empty navigator so its create action is accessible", async () => {
  const snapshot = { ...surfaceSnapshot(), items: [] };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("n"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:path");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const unavailable of ["empty", "undersized"] as const) {
  test(`item Enter keeps navigator focus when its workbench is ${unavailable}`, async () => {
    const snapshot = surfaceSnapshot();
    if (unavailable === "empty") {
      snapshot.tabs[0]!.layout = null;
    }
    const setup = await testRender(
      <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
      {
        width: 120,
        height: unavailable === "undersized" ? 8 : 40,
        kittyKeyboard: true,
      },
    );
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
      await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey("l"));
      await act(async () => setup.mockInput.pressKey("j"));
      await act(async () => setup.mockInput.pressEnter());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("item Enter enters and restores a remembered active-tab pane without remounting it", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: splitSurfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("l"));
    await act(async () => setup.mockInput.pressKey("j"));
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const remembered = setup.renderer.currentFocusedRenderable;
    expect(remembered?.id).toBe("terminal:pane-2");
    await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(remembered!);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const action of ["item Enter", "root Enter"] as const) {
  for (const order of ["response first", "snapshot first"] as const) {
    test(`${action} enters its new pane with ${order}`, async () => {
      const open = deferred<CommandResponse>();
      let publishSnapshot!: Dispatch<SetStateAction<Snapshot>>;
      const sent: Command[] = [];
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
          ...surfaceSnapshot(),
          revision: 1,
          items: surfaceSnapshot().items,
          surfaces: [],
          tabs: [],
          panes: [],
        }));
        publishSnapshot = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                sent.push(command);
                return open.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        if (action === "item Enter") {
          await act(async () => setup.mockInput.pressKey("l"));
          await act(async () => setup.mockInput.pressKey("j"));
          await act(async () => setup.mockInput.pressEnter());
        } else {
          await act(async () => setup.mockInput.pressEnter());
        }
        expect(sent).toEqual([
          action === "item Enter"
            ? { type: "surface.ensure", itemId: "item-1" }
            : { type: "surface.ensure", itemId: "root-1" },
        ]);
        const ready = {
          ...surfaceSnapshot(),
          revision: 3,
          surfaces: [
            {
              ...surfaceSnapshot().surfaces[0]!,
              itemId: action === "root Enter" ? "root-1" : "item-1",
            },
          ],
        };
        if (order === "snapshot first") {
          act(() => publishSnapshot(ready));
          await setup.flush();
        }
        await act(async () =>
          open.resolve({
            ok: true,
            revision: 3,
            result: {
              id: "surface-1",
              itemId: "item-1",
              surfaceId: "surface-1",
              tabId: "tab-1",
              paneId: "pane-1",
            },
          }),
        );
        if (order === "response first") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          act(() =>
            publishSnapshot({
              ...ready,
              revision: 2,
              items: ready.items,
              surfaces: [],
              tabs: [],
              panes: [],
            }),
          );
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          act(() => publishSnapshot(ready));
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("project expansion and collapse cancel a pending open-focus handoff", async () => {
  const open = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: {
          ...surfaceSnapshot(),
          surfaces: surfaceSnapshot().surfaces.map((surface) => ({ ...surface, itemId: "root-1" })),
        },
        command: () => open.promise,
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKeys(["l", "h"]));
    await act(async () =>
      open.resolve({
        ok: true,
        revision: 4,
        result: { id: "surface-1", itemId: "item-1", surfaceId: "surface-1" },
      }),
    );
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const when of ["before response", "after response"] as const) {
  for (const interaction of ["native leave-and-return", "local browsing at an edge"] as const) {
    test(`item-open focus is cancelled by ${interaction} ${when}`, async () => {
      const open = deferred<CommandResponse>();
      let publishSnapshot!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
          ...surfaceSnapshot(),
          revision: 1,
          surfaces: [],
          tabs: [],
          panes: [],
        }));
        publishSnapshot = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({ snapshot, command: () => open.promise })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey("l"));
        await act(async () => setup.mockInput.pressKey("j"));
        await act(async () => setup.mockInput.pressEnter());
        const response: CommandResponse = {
          ok: true,
          revision: 3,
          result: { id: "surface-1", itemId: "item-1", surfaceId: "surface-1", paneId: "pane-1" },
        };
        if (when === "after response") {
          await act(async () => open.resolve(response));
        }
        if (interaction === "native leave-and-return") {
          // No React commit between focus changes: returning does not revive the request.
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:navigator")!.focus();
          });
        } else {
          await act(async () => setup.mockInput.pressKey("h"));
        }
        if (when === "before response") {
          await act(async () => open.resolve(response));
        }
        act(() => publishSnapshot({ ...surfaceSnapshot(), revision: 3 }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("starting entry waits, failure reports status and a later running snapshot never revives it", async () => {
  const initial = surfaceSnapshot();
  initial.panes[0]!.processStatus = "starting";
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    act(() =>
      publish({
        ...initial,
        revision: 6,
        panes: [{ ...initial.panes[0]!, processStatus: "failed", errorText: "spawn refused" }],
      }),
    );
    await setup.flush();
    expect(statusText(setup)).toContain("failed");
    act(() =>
      publish({
        ...initial,
        revision: 7,
        panes: [{ ...initial.panes[0]!, processStatus: "running" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered browsing then Archive confirms and archives the live candidate rather than the previous row", async () => {
  const snapshot = workCraftStateFixture().snapshot!;
  for (const item of snapshot.items) {
    if (item.kind !== "generic") {
      item.data.availability = "unavailable";
    }
  }
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot,
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: snapshot.revision, result: { id: "item-1" } };
        },
      })}
    />,
    { width: 120, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    await act(async () => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("a");
    });
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Archive Ship navigator?");
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toEqual([{ type: "item.setArchived", itemId: "item-1", archived: true }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a deliberate successful terminal retry clears its matching entry failure without reviving old intent", async () => {
  const initial = surfaceSnapshot();
  initial.panes[0]!.processStatus = "exited";
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 30, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(statusText(setup)).toContain("Terminal entry failed");
    act(() =>
      publish({
        ...initial,
        revision: initial.revision + 1,
        panes: [{ ...initial.panes[0]!, processStatus: "running" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
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

test("drawer entry closes coverage without remounting its terminal and dismissal restores focus", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1");
    act(() => setup.resize(100, 30));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-controls")?.width).toBe(95);
    expect(terminal?.focusable).toBe(false);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(setup.renderer.root.findDescendantById("terminal:pane-1") === terminal).toBe(true);
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("mouse category activation drills down and item release enters while Hyper selection does not", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const category = setup.renderer.root.findDescendantById("category:implementation")!;
    await act(async () => setup.mockMouse.click(category.screenX + 2, category.screenY));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    const item = setup.renderer.root.findDescendantById("navigator-row:item-1")!;
    await act(async () => setup.mockMouse.click(item.screenX + 2, item.screenY));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
    await act(async () => setup.mockInput.pressKey("k", { hyper: true }));
    await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered spatial movement uses the actual native source", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: splitSurfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await openFixtureItem(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKeys(["\x0c", "\x0c"]));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("mouse session opening restores the native session endpoint", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const session = setup.renderer.root.findDescendantById("region:session")!;
    await act(async () => setup.mockMouse.click(session.screenX + 1, session.screenY));
    expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Tab stays within the header and reaches the session button", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
    const session = setup.renderer.root.findDescendantById("region:session")!;
    act(() => workspace.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => {
      await setup.mockInput.pressTab();
      await setup.mockInput.pressTab();
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("header Tab does not steal modified Tab or active leader input", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
    act(() => workspace.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressTab({ ctrl: true }));
    expect(setup.renderer.currentFocusedRenderable).toBe(workspace);
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    expect(statusText(setup)).toContain("Invalid leader key: tab");
    expect(setup.renderer.currentFocusedRenderable).toBe(workspace);
    const category = setup.renderer.root.findDescendantById("region:category")!;
    act(() => category.focus());
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable).toBe(category);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered leader prefix takes priority over header Tab", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00\t"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    expect(statusText(setup)).toContain("Invalid leader key: tab");
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("spatial header movement uses the rendered controls after resizing", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    for (const width of [120, 80]) {
      act(() => setup.resize(width, 40));
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
      await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each(["Enter", "Space", "Hyper+s"] as const)(
  "session switcher opens with %s and restores the initiating focus",
  async (key) => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      const session = setup.renderer.root.findDescendantById("region:session")!;
      if (key !== "Hyper+s") {
        act(() => session.focus());
        await setup.flush();
      }
      const returnTarget = setup.renderer.currentFocusedRenderable;
      await act(async () => {
        if (key === "Enter") {
          await setup.mockInput.pressEnter();
        } else if (key === "Space") {
          await setup.mockInput.pressKey(" ");
        } else {
          await setup.mockInput.pressKey("s", { hyper: true });
        }
      });
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
      await act(async () => setup.mockInput.pressEscape());
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable).toBe(returnTarget);
      if (key !== "Hyper+s") {
        expect(getControlHints(session)).toContainEqual({ keys: "Enter/Space", label: "Activate" });
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("buffered movement through tabs restores the last native pane", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: splitSurfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKeys(["\x0c", "\x0c", "\x0b", "\n"]));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered project expansion requests remain explicit and idempotent", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKeys(["k", "h", "h"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeUndefined();
    await act(async () => setup.mockInput.pressKeys(["l", "h", "l", "l"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeDefined();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered spatial movement recomputes contextual creation from the native source", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKeys(["\x0c", "n"]));
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Register directory");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:path");
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a direct tab request while undersized cancels automatic workbench restoration", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "tab-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    act(() => setup.resize(120, 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(commands.at(-1)).toEqual({
      type: "surface.selectTab",
      surfaceId: "surface-1",
      tabId: "tab-1",
    });
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a cancelled click on a stretched tab cancels automatic workbench restoration", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    act(() => setup.resize(120, 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tabs = setup.renderer.root.findDescendantById("region:tabs")!;
    const label = setup.renderer.root.findDescendantById("tab:tab-1")!;
    const x = tabs.screenX + tabs.width - 1;
    expect(x).toBe(label.screenX + label.width - 1);
    const count = commands.length;
    await act(async () => setup.mockMouse.pressDown(x, tabs.screenY));
    await act(async () => setup.mockMouse.release(x, tabs.screenY + tabs.height));
    expect(commands).toHaveLength(count);
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("chooser and prompt keep every shell region mounted", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  const initial = setup.captureCharFrame();
  expect(initial).toContain("HINTS");
  expect(initial).toContain("IMPLEMENTATION");

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  const chooser = setup.captureCharFrame();
  expect(chooser).toContain("Sessions");
  expect(chooser).toContain("HINTS");
  const dialog = setup.renderer.root.findDescendantById("dialog") as BoxRenderable;
  expect(dialog.backgroundColor.a).toBe(1);
  expect(dialog.width).toBeLessThanOrEqual(120);
  expect(dialog.height).toBeLessThanOrEqual(40);
  expect(dialog.screenX).toBeGreaterThanOrEqual(0);
  expect(dialog.screenY).toBeGreaterThanOrEqual(0);
  expect(setup.renderer.root.findDescendantById("region:workbench")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("cancelling session creation in an empty installation returns to the chooser", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({ snapshot: snapshotFixture({ sessions: [] }) })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  expect(statusText(setup)).toContain(`${icons.return}/${icons.space} Activate`);
  expect(statusText(setup)).toContain(`${icons.keyboard} r Reconnect`);
  expect(statusText(setup)).toContain(`${icons.keyboard} q Quit`);
  expect(statusText(setup)).not.toContain(`${icons.escape} Cancel`);
  expect(statusText(setup)).not.toContain(`${icons.return} Attach`);
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  expect(statusText(setup)).toContain(`${icons.return} Submit`);
  expect(statusText(setup)).toContain(`${icons.escape} Cancel`);

  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("No sessions yet.");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressKeys(["\x00n"]));
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();
  const create = setup.renderer.root.findDescendantById("session:create")!;
  await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  act(() => setup.renderer.destroy());
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

test("browsing stays local until Enter activates the item", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  expect(commands).toEqual([]);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(commands[0]).toEqual({ type: "surface.ensure", itemId: "item-1" });
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("a current item-open failure remains visible after activation", async () => {
  const open = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) =>
          command.type === "surface.ensure"
            ? open.promise
            : { ok: true, revision: 1, result: { id: "result-1" } },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();

  await act(async () => {
    open.reject(new Error("open failed"));
    await open.promise.catch(() => {});
  });
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("open failed");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("leader status resolves commands and reports invalid input", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await setup.flush();
  expect(statusText(setup).startsWith("LEADER ")).toBe(true);
  expect(statusText(setup)).not.toContain(`${icons.return} Activate`);
  await act(async () => setup.mockInput.pressKey("x"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("ERROR");
  expect(setup.captureCharFrame()).toMatch(/Invalid.leader.key:.x/);
  act(() => setup.renderer.destroy());
});

test("navigator hides, restores expanded, and resizes one column", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  const navigator = setup.renderer.root.findDescendantById("navigator-controls")!;
  const initialWidth = navigator.width;
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(navigator.width).toBe(initialWidth);

  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("ARROW_RIGHT", { ctrl: true }));
  await setup.flush();
  expect(navigator.width).toBe(initialWidth + 1);
  act(() => setup.renderer.destroy());
});

test("narrow shells start hidden rather than compact", async () => {
  const compact = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 119,
    height: 20,
    kittyKeyboard: true,
  });
  await compact.flush();
  expect(compact.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  act(() => compact.renderer.destroy());
});

test("undersizing a focused workbench moves focus to its tab", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(true);

  act(() => setup.resize(120, 8));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(false);

  act(() => setup.resize(120, 40));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
});

test("changing the active item leaves stale workbench focus on the tab strip", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: twoSurfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(false);

  await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
});

test("closing a dialog with a stale return pane focuses the valid native tab fallback", async () => {
  let changeSnapshot!: Dispatch<SetStateAction<Snapshot>>;
  function SnapshotHarness() {
    const [snapshot, setSnapshot] = useState(splitSurfaceSnapshot);
    changeSnapshot = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<SnapshotHarness />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const original = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    const fallback = setup.renderer.root.findDescendantById("region:tabs")!;
    expect(setup.renderer.currentFocusedRenderable).toBe(original);
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    await act(async () => setup.mockInput.typeText("Retained"));
    await act(async () =>
      changeSnapshot((snapshot) => ({
        ...snapshot,
        revision: snapshot.revision + 1,
        tabs: snapshot.tabs.map((tab) => ({ ...tab, layout: { type: "pane", paneId: "pane-2" } })),
        panes: snapshot.panes.filter(({ id }) => id !== "pane-1"),
      })),
    );
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(input);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(input.value).toBe("Retained");
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("region:tabs")).toBe(fallback);
    expect(setup.renderer.currentFocusedRenderable).toBe(fallback);
    expect(fallback.focused).toBe(true);
    expect(fallback.isDestroyed).toBe(false);
    expect(fallback.visible).toBe(true);
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disconnected durable commands are disabled while reload remains available", async () => {
  let commands = 0;
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        status: "disconnected",
        command: async () => {
          commands += 1;
          throw new Error("offline");
        },
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
  await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
  expect(commands).toBe(0);
  expect(reloads).toBe(1);
  act(() => setup.renderer.destroy());
});

test("shell-only state changes preserve terminal renderable identity", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  const terminal = setup.renderer.root.findDescendantById("terminal:pane-1");
  expect(terminal).toBeDefined();

  for (const region of ["workspace", "category"] as const) {
    act(() => setup.renderer.root.findDescendantById(`region:${region}`)!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  }

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  await act(async () => setup.mockInput.pressEscape());
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
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

test("modal status scrolling leaves dialog focus and background selection intact", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({ connectionError: "Connection detail ".repeat(10) })}
    />,
    {
      width: 80,
      height: 20,
      kittyKeyboard: true,
    },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await setup.flush();
    const target = setup.renderer.currentFocusedRenderable!;
    expect(target.id).toBe("session:search");
    const area = setup.renderer.root.findDescendantById(
      "status-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    const right = setup.renderer.root.findDescendantById("status-scroll:right")!;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await setup.flush();
    expect(area.scrollLeft).toBeGreaterThan(0);
    expect(setup.renderer.currentFocusedRenderable === target).toBe(true);
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:workspace-shared") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    const overlay = setup.renderer.root.findDescendantById("dialog")!.parent!;
    const status = setup.renderer.root.findDescendantById("status")!;
    expect(overlay.screenY + overlay.height).toBeLessThanOrEqual(status.screenY);
    const badge = setup.captureSpans().lines[19]!.spans.find(({ text }) => text.includes("ERROR"))!;
    expect(badge.bg.toInts()).toEqual(parseColor(defaultTheme.colors.error).toInts());
    await act(async () => setup.mockInput.pressKey("n"));
    expect((target as InputRenderable).value).toBe("n");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("dialogs blur and restore the focused terminal", async () => {
  const received: { paneId: string; bytes: number[] }[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        stream: {
          close: () => {},
          resize: () => {},
          sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
  expect(terminal.focused).toBe(true);
  await act(async () => setup.mockInput.pressTab());
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  expect(terminal?.focused).toBe(false);
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);

  await act(async () => {
    await setup.mockMouse.click(terminal!.screenX + 1, terminal!.screenY + 1);
  });
  expect(terminal?.focused).toBe(true);
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();

  await act(async () => setup.mockInput.pressEscape());
  expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  expect(terminal?.focused).toBe(true);
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(received).toEqual([
    { paneId: "pane-1", bytes: [9] },
    { paneId: "pane-1", bytes: [27, 91, 90] },
  ]);
  act(() => setup.renderer.destroy());
});

test("session dialog traps tab focus above the mounted terminal", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");

  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");

  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  act(() => setup.renderer.destroy());
});

test("session command browses without activation and confirms its cursor with Enter", async () => {
  const snapshot = snapshotFixture();
  snapshot.sessions.push({ id: "session-third", name: "Third", position: 2 });
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
  expect(list).toBeInstanceOf(InputRenderable);
  expect(list.focused).toBe(true);
  const sessionName = setup.renderer.root
    .findDescendantById("region:session")!
    .getChildren()[1] as TextRenderable;

  await act(async () => setup.mockInput.pressArrow("up"));
  await setup.flush();
  expect(sessionName.plainText).toBe("Select session...");

  await act(async () => setup.mockInput.pressArrow("down"));
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(sessionName.plainText).toBe("Personal");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("session command preserves create and cancel shortcuts", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  await act(async () => setup.mockInput.pressKeys(["\x00n"]));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");
  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressEscape());
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("chooser search keeps n local, Ctrl+C clears it, and Escape dismisses a pending prefix", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const origin = setup.renderer.currentFocusedRenderable;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    await act(async () => setup.mockInput.typeText("njk"));
    await setup.flush();
    expect(query.value).toBe("njk");
    expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
    await act(async () => setup.mockInput.pressKeys(["\x00\x03"]));
    await setup.flush();
    expect(query.value).toBe("");
    expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
    expect(statusText(setup)).not.toContain("Invalid leader");
    await act(async () => setup.mockInput.typeText("unchanged"));
    await act(async () => setup.mockInput.pressKeys(["\x00\x1b[27u"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(origin);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const [direction, tab] of [
  ["forward", "\t"],
  ["backward", "\x1b[Z"],
] as const) {
  test(`buffered chooser leader takes priority over ${direction} Tab`, async () => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      await setup.flush();
      const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
      await act(async () => setup.mockInput.pressKeys([`\x00${tab}n`]));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
      expect(query.value).toBe("n");
      expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
      expect(statusText(setup)).toContain("Invalid leader key: tab");
      await act(async () => setup.mockInput.pressTab());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("chooser repairs a removed match without attaching a stale session", async () => {
  const snapshot = snapshotFixture({
    sessions: [
      { id: "gone", name: "Remove me", position: 0 },
      { id: "keep-a", name: "Keep A", position: 1 },
      { id: "keep-b", name: "Keep B", position: 2 },
    ],
  });
  let update!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [current, setCurrent] = useState(snapshot);
    update = setCurrent;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: current })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    await act(async () => setup.mockInput.typeText("Remove"));
    await act(async () =>
      update((current) => ({
        ...current,
        revision: current.revision + 1,
        sessions: current.sessions.filter(({ id }) => id !== "gone"),
      })),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(query);
    expect(query.value).toBe("Remove");
    expect(setup.captureCharFrame()).toContain("No matching sessions.");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(
      (setup.renderer.root.findDescendantById("region:session")!.getChildren()[1] as TextRenderable)
        .plainText,
    ).toBe("Select session...");
    expect(setup.renderer.root.findDescendantById("session:create")).toBeDefined();
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session command activates the clicked row after scrolling and resizing", async () => {
  const sessions = Array.from({ length: 30 }, (_, position) => ({
    id: `session-${position}`,
    name: `Session ${position}`,
    position,
  }));
  const calls: string[] = [];
  const setup = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={sessions}
        onSelect={(id) => calls.push(`select:${id}`)}
        onCreate={() => {}}
      />
    </Dialog>,
    { width: 40, height: 12, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
  expect(list).toBeInstanceOf(InputRenderable);
  act(() => list.focus());
  await act(async () => setup.mockInput.typeText("Session 29"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Session 29");
  expect(setup.captureCharFrame()).not.toContain("Session 0");
  act(() => setup.resize(40, 10));
  await setup.flush();
  calls.length = 0;
  const row = setup.renderer.root.findDescendantById("session:item:session-29")!;
  await act(async () => setup.mockMouse.click(row.screenX + 2, row.screenY));
  expect(calls).toEqual(["select:session-29"]);
  act(() => setup.renderer.destroy());
});

test("focused session create button handles Enter without selecting the session cursor", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressEnter());
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressKey("j"));
  act(() => setup.renderer.root.findDescendantById("session:create")?.focus());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("New session");
  expect(
    (setup.renderer.root.findDescendantById("region:session")!.getChildren()[1] as TextRenderable)
      .plainText,
  ).toBe("Personal");
  act(() => setup.renderer.destroy());
});

test("session button never browses its sibling list", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    act(() => setup.renderer.root.findDescendantById("session:create")!.focus());
    const query = list.value;
    const keys = [
      ["j", {}],
      ["k", {}],
      ["ARROW_DOWN", {}],
      ["ARROW_UP", {}],
      ["g", {}],
      ["g", { shift: true }],
      ["n", { ctrl: true }],
      ["p", { ctrl: true }],
      ["d", { ctrl: true }],
      ["u", { ctrl: true }],
    ] as const;
    for (const [name, modifiers] of keys) {
      await act(async () => setup.mockInput.pressKey(name, modifiers));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
      expect(list.value).toBe(query);
    }
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("creation input edits navigation letters with Ctrl+h and submits the edited name", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    await act(async () => setup.mockInput.pressKeys(["n", "j", "k"]));
    expect(input.value).toBe("njk");
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    await setup.flush();
    expect(input.value).toBe("nj");
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(commands).toEqual([]);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "nj" }]);
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("creation failure preserves the native name input and focus", async () => {
  const pending = deferred<CommandResponse>();
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: (command) => {
          commands.push(command);
          return pending.promise;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await act(async () => setup.mockInput.typeText("Repeated"));
    await setup.flush();
    const nameInput = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toEqual([{ type: "session.create", name: "Repeated" }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    await act(async () => {
      pending.reject(new Error("Name already exists"));
      await pending.promise.catch(() => {});
    });
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(nameInput);
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    expect(nameInput.value).toBe("Repeated");
    expect(setup.captureCharFrame()).toContain("Name already exists");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered typing, Tab and Create submit the full name and preserve button focus on failure", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: async (command) => {
          commands.push(command);
          throw new Error("Name already exists");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    const create = setup.renderer.root.findDescendantById("create:submit")!;
    await act(async () => setup.mockInput.pressKeys(["  Buffered name  \t\r"]));
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "Buffered name" }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(create);
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(name);
    expect(name.value).toBe("  Buffered name  ");
    expect(setup.captureCharFrame()).toContain("Name already exists");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session creation shows required-name feedback without sending an invalid command", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: snapshotFixture({ sessions: [] }),
        command: async (command) => {
          commands.push(command);
          throw new Error("Server unavailable");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    const create = setup.renderer.root.findDescendantById("create:submit")!;
    for (const value of ["", "   "]) {
      act(() => name.focus());
      await act(async () => setup.mockInput.typeText(value));
      await setup.flush();
      await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
      await setup.flush();
      expect(commands).toEqual([]);
      expect(setup.captureCharFrame()).toContain("Name is required.");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:submit");
      expect(name.value).toBe(value);
    }
    act(() => name.focus());
    await act(async () => setup.mockInput.typeText("Fixed"));
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Name is required.");
    await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "Fixed" }]);
    expect(setup.captureCharFrame()).toContain("Server unavailable");
    expect(name.value).toBe("   Fixed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const action of ["escape", "cancel", "backdrop"] as const) {
  test(`startup form ${action} returns to a non-dismissible chooser`, async () => {
    const setup = await testRender(
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot: snapshotFixture({ sessions: [] }),
        })}
      />,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      await setup.flush();
      const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
      await act(async () => setup.mockInput.typeText("clear me"));
      await act(async () => setup.mockInput.pressCtrlC());
      expect(name.value).toBe("");
      expect(setup.renderer.currentFocusedRenderable).toBe(name);
      await act(async () => setup.mockInput.pressKeys(["\x00n"]));
      expect(name.value).toBe("n");
      await act(async () => setup.mockInput.typeText("draft"));
      if (action === "escape") {
        await act(async () => setup.mockInput.pressEscape());
      } else if (action === "cancel") {
        const cancel = setup.renderer.root.findDescendantById("dialog:cancel")!;
        await act(async () => setup.mockMouse.click(cancel.screenX, cancel.screenY));
      } else {
        await act(async () => setup.mockMouse.click(0, 0));
      }
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
      expect(setup.renderer.root.findDescendantById("dialog:cancel")).toBeUndefined();
      await act(async () => setup.mockInput.pressKeys(["\x00\x1b[27u"]));
      await act(async () => setup.mockMouse.click(0, 0));
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("dialogs block background commands and mouse activation while allowing reconnect", async () => {
  const commands: Command[] = [];
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: twoSurfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    const commandCount = commands.length;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    for (const dialog of ["sessions", "create"] as const) {
      if (dialog === "create") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        await act(async () => setup.mockInput.pressKeys(["\x00n"]));
        await setup.flush();
      }
      const endpoint = dialog === "sessions" ? "session:search" : "create:name";
      for (const name of ["h", "j", "k", "l", "[", "]", "n", "s"]) {
        await act(async () => setup.mockInput.pressKey(name, { hyper: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(endpoint);
      }
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey("v"));
      await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
      expect(reloads).toBe(dialog === "sessions" ? 1 : 2);
      await act(async () => setup.mockMouse.pressDown(terminal.screenX + 1, terminal.screenY + 1));
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
      expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
      await act(async () => setup.mockMouse.release(terminal.screenX + 1, terminal.screenY + 1));
      await setup.flush();
      expect(commands.length).toBe(commandCount);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
      expect(terminal.focused).toBe(true);
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
    }
    await act(async () => setup.mockInput.pressKey("b"));
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(terminal.focused).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal quit destroys the renderer", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("q", { hyper: true }));
    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    if (!setup.renderer.isDestroyed) {
      act(() => setup.renderer.destroy());
    }
  }
});

test("opening a dialog by mouse clears a pending shell leader", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await setup.flush();
    expect(statusText(setup).startsWith("LEADER ")).toBe(true);
    const session = setup.renderer.root.findDescendantById("region:session")!;
    await act(async () => setup.mockMouse.click(session.screenX + 1, session.screenY));
    await setup.flush();
    expect(statusText(setup).startsWith("LEADER ")).toBe(false);
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
    await act(async () => setup.mockInput.pressKey("b"));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(statusText(setup).startsWith("LEADER ")).toBe(false);
    expect(setup.captureCharFrame()).not.toContain("ERROR");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("unavailable modal scopes consume input instead of sending it to the retained terminal", async () => {
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const overlay = setup.renderer.root.findDescendantById("dialog")!;
    const parent = overlay.parent!;
    const received: string[] = [];
    terminal.onKeyDown = (key) => received.push(key.name);
    for (const unavailable of ["hidden", "missing"] as const) {
      act(() => {
        if (unavailable === "hidden") {
          overlay.visible = false;
        } else {
          parent.remove(overlay);
        }
        terminal.focus();
      });
      await act(async () => {
        setup.mockInput.pressTab();
        setup.mockInput.pressTab({ shift: true });
        setup.mockInput.pressKey("x");
        setup.mockInput.pressKey("h", { ctrl: true });
      });
      expect(received).toEqual([]);
      await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
      expect(reloads).toBe(unavailable === "hidden" ? 1 : 2);
    }
    await act(async () => {
      parent.add(overlay);
      overlay.visible = true;
      await setup.flush();
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("spatial focus moves between workbench panes", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: splitSurfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  commands.length = 0;
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("v"));
  expect(commands.at(-1)).toEqual({
    type: "pane.split",
    paneId: "pane-2",
    direction: "vertical",
  });
  act(() => setup.renderer.destroy());
});

function createdTabSnapshot(
  revision: number,
  status: "starting" | "running" = "running",
): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    revision,
    surfaces: [{ ...snapshot.surfaces[0]!, activeTabId: "created-tab" }],
    tabs: [
      ...snapshot.tabs,
      {
        ...snapshot.tabs[0]!,
        id: "created-tab",
        position: 1,
        layout: { type: "pane", paneId: "created-pane" },
      },
    ],
    panes: [
      ...snapshot.panes,
      { ...snapshot.panes[0]!, id: "created-pane", processStatus: status },
    ],
  };
}

for (const [origin, order, readiness] of [
  ["terminal:pane-1", "response first", "running"],
  ["terminal:pane-1", "snapshot first", "starting"],
  ["region:tabs", "snapshot first", "running"],
  ["region:category", "response first", "starting"],
  ["region:navigator", "snapshot first", "starting"],
] as const) {
  test(`native Hyper+n from ${origin} ${order} ${readiness} enters only the created pane`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      act(() => setup.renderer.root.findDescendantById(origin)!.focus());
      await setup.flush();
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      expect(setup.commands.filter((command) => command.type.startsWith("tab."))).toEqual([
        { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
      ]);
      if (order === "snapshot first") {
        await setup.publish(createdTabSnapshot(2, readiness));
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 3,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      await setup.flush();
      if (order === "response first") {
        expect(setup.renderer.currentFocusedRenderable).toBe(source);
        await setup.publish(createdTabSnapshot(2, readiness));
      }
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
      await setup.publish(createdTabSnapshot(3, readiness));
      if (readiness === "starting") {
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
        await setup.publish(createdTabSnapshot(4));
      }
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:created-pane");
      expect(setup.commands.filter((command) => command.type === "surface.selectTab")).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

test("native Hyper+n waits for exact returned pane native eligibility without entering a running sibling", async () => {
  const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
  try {
    await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
    const ready = createdTabSnapshot(2);
    ready.tabs[1]!.layout = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: "decoy" },
      second: { type: "pane", paneId: "created-pane" },
    };
    ready.panes.push({ ...ready.panes[0]!, id: "decoy" });
    await setup.publish(ready);
    const target = setup.renderer.root.findDescendantById("terminal:created-pane")!;
    act(() => {
      target.visible = false;
    });
    await act(async () =>
      setup.tabCreates[0]!.resolve({
        ok: true,
        revision: 2,
        result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.sent).toEqual([]);
    act(() => {
      target.visible = true;
    });
    await setup.flush();
    await act(async () => setup.mockInput.typeText("x"));
    expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(target);
  } finally {
    act(() => {
      setup.store.stop();
      setup.renderer.destroy();
    });
  }
});

for (const unavailable of ["tiny", "failed", "exited"] as const) {
  test(`native Hyper+n ${unavailable} destination never receives input, restarts or revives entry`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      if (unavailable === "tiny") {
        act(() => setup.resize(120, 10));
        await setup.flush();
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      const ready = createdTabSnapshot(2);
      if (unavailable !== "tiny") {
        ready.panes[1]!.processStatus = unavailable;
      }
      await setup.publish(ready);
      await setup.flush();
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      act(() => setup.resize(120, 40));
      await setup.publish(createdTabSnapshot(3));
      await setup.publish(createdTabSnapshot(4));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      await act(async () => setup.mockInput.typeText("y"));
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const cancel of ["scroll", "disconnect"] as const) {
  test(`native Hyper+n pre-response ${cancel} cancels entry permanently`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    initial.tabs.push(
      ...Array.from({ length: 10 }, (_, index) => ({
        ...initial.tabs[0]!,
        id: `other-${index}`,
        position: index + 1,
        title: `Long terminal tab ${index}`,
        layout: null,
      })),
    );
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      if (cancel === "scroll") {
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
        await act(async () =>
          setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
        );
      } else {
        act(() => {
          setup.store.stop();
          setup.renderCurrent();
        });
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      if (cancel === "disconnect") {
        await setup.store.start();
      }
      await setup.publish(createdTabSnapshot(2));
      await setup.publish(createdTabSnapshot(3));
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const transition of [
  "item archive",
  "parent archive",
  "existing tab",
  "source tab after new selection",
  "context",
] as const) {
  test(`native Hyper+n pre-response ${transition} restoration cannot rearm control-origin entry`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    initial.tabs.push({ ...initial.tabs[0]!, id: "other-tab", layout: null, position: 1 });
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      const changed =
        transition === "source tab after new selection"
          ? createdTabSnapshot(2)
          : structuredClone(initial);
      if (transition === "source tab after new selection") {
        changed.tabs.push(initial.tabs[1]!);
      }
      changed.revision = 2;
      if (transition === "existing tab") {
        changed.surfaces[0]!.activeTabId = "other-tab";
      } else if (transition === "context") {
        changed.items = [];
      } else if (transition === "item archive" || transition === "parent archive") {
        changed.items.find(
          (item) => item.id === (transition === "item archive" ? "item-1" : "root-1"),
        )!.archived = true;
      }
      await setup.publish(changed);
      await setup.publish({
        ...(transition === "source tab after new selection" ? changed : initial),
        revision: 3,
        surfaces: initial.surfaces,
      });
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 4,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      await setup.publish(createdTabSnapshot(4));
      await setup.publish(createdTabSnapshot(5));
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const origin of ["terminal:pane-1", "region:tabs", "region:category"] as const) {
  for (const oldOrder of ["response first", "snapshot first"] as const) {
    for (const newOrder of ["response first", "snapshot first"] as const) {
      test(`overlapping successful Hyper+n from ${origin}, old ${oldOrder}, newest ${newOrder} enters only newest pane`, async () => {
        const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
        try {
          act(() => setup.renderer.root.findDescendantById(origin)!.focus());
          await setup.flush();
          const focused: (string | undefined)[] = [];
          setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, () => {
            focused.push(setup.renderer.currentFocusedRenderable?.id);
          });
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
          expect(setup.tabCreates).toHaveLength(2);
          const old = createdTabSnapshot(2);
          old.surfaces[0]!.activeTabId = "old-tab";
          old.tabs[1]!.id = "old-tab";
          old.tabs[1]!.layout = { type: "pane", paneId: "old-pane" };
          old.panes[1]!.id = "old-pane";
          const newest = createdTabSnapshot(4, "starting");
          newest.tabs[1]!.position = 2;
          newest.tabs.push(old.tabs[1]!);
          newest.panes.push(old.panes[1]!);
          async function respond(index: 0 | 1): Promise<void> {
            await act(async () =>
              setup.tabCreates[index]!.resolve({
                ok: true,
                revision: index === 0 ? 2 : 4,
                result:
                  index === 0
                    ? { id: "old-tab", tabId: "old-tab", paneId: "old-pane" }
                    : { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
              }),
            );
            await setup.flush();
          }
          if (oldOrder === "response first") {
            await respond(0);
          }
          if (newOrder === "response first") {
            await respond(1);
          }
          await setup.publish(old);
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
          if (oldOrder === "snapshot first") {
            await respond(0);
          }
          await setup.publish({ ...old, revision: 3 });
          expect(setup.renderer.currentFocusedRenderable?.id).toBe(
            origin === "terminal:pane-1" ? "region:tabs" : origin,
          );
          expect(focused).not.toContain("terminal:old-pane");
          await setup.publish(newest);
          if (newOrder === "snapshot first") {
            await respond(1);
          }
          expect(focused).not.toContain("terminal:created-pane");
          expect(setup.sent).toEqual([]);
          await setup.publish({
            ...newest,
            revision: 5,
            panes: newest.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
          });
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:created-pane");
          expect(focused).not.toContain("terminal:old-pane");
          expect(setup.commands.filter((command) => command.type === "tab.create")).toEqual([
            { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
            { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
          ]);
          expect(setup.commands.filter((command) => command.type === "surface.selectTab")).toEqual(
            [],
          );
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }
}

for (const newer of [false, true]) {
  for (const outcome of ["failure", "cancelled success"] as const) {
    test(`native Hyper+n ${outcome} cleans its observer without removing newer intent (${newer})`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
        await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + 1);
        if (newer) {
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
        }
        await act(async () => {
          if (outcome === "failure") {
            setup.tabCreates[0]!.reject(new Error("Create refused"));
          } else {
            if (!newer) {
              setup.mockInput.typeText("z");
            }
            setup.tabCreates[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "old-tab", tabId: "old-tab", paneId: "old-pane" },
            });
          }
        });
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + (newer ? 1 : 0));
        if (newer) {
          await setup.publish(createdTabSnapshot(2, "starting"));
          await act(async () =>
            setup.tabCreates[1]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
            }),
          );
          await setup.publish(createdTabSnapshot(3));
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
          expect(statusText(setup)).not.toContain("Create refused");
        } else {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          expect(setup.sent).toEqual([]);
          if (outcome === "failure") {
            expect(statusText(setup)).toContain("Create refused");
          }
        }
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  for (const transition of ["item archive", "parent archive", "tab switch"] as const) {
    for (const order of ["response first", "snapshot first"] as const) {
      test(`native split pre-response invalidation ${direction} ${transition} ${order} cannot rearm after restore; fresh intent works`, async () => {
        const initial = { ...surfaceSnapshot(), revision: 1 };
        initial.tabs.push({ ...initial.tabs[0]!, id: "other-tab", position: 1, layout: null });
        const setup = await liveInputFixture(initial);
        try {
          act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
          await setup.flush();
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const changed = { ...initial, revision: 2 };
          if (transition === "tab switch") {
            changed.surfaces = initial.surfaces.map((surface) => ({
              ...surface,
              activeTabId: "other-tab",
            }));
          } else {
            changed.items = initial.items.map((item) =>
              item.id === (transition === "item archive" ? "item-1" : "root-1")
                ? { ...item, archived: true }
                : item,
            );
          }
          await setup.publish(changed);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await setup.publish({ ...initial, revision: 3 });
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          const source = setup.renderer.root.findDescendantById("terminal:pane-1")!;
          const split = { ...splitSurfaceSnapshot(), revision: 4 };
          if (split.tabs[0]!.layout?.type === "split") {
            split.tabs[0]!.layout.direction = direction;
          }
          split.tabs.push(initial.tabs[1]!);
          if (order === "snapshot first") {
            await setup.publish(split);
          }
          await act(async () =>
            setup.splits[0]!.resolve({
              ok: true,
              revision: 4,
              result: { id: "pane-2", paneId: "pane-2" },
            }),
          );
          if (order === "response first") {
            await setup.publish(split);
          }
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([]);
          const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source);

          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const fresh: Snapshot = {
            ...split,
            revision: 5,
            tabs: [
              {
                ...split.tabs[0]!,
                layout: {
                  type: "split",
                  direction,
                  ratio: 1 / 3,
                  first: { type: "pane", paneId: "pane-1" },
                  second: {
                    type: "split",
                    direction,
                    ratio: 0.5,
                    first: { type: "pane", paneId: "pane-2" },
                    second: { type: "pane", paneId: "pane-3" },
                  },
                },
              },
              split.tabs[1]!,
            ],
            panes: [...split.panes, { ...split.panes[0]!, id: "pane-3" }],
          };
          await act(async () =>
            setup.splits[1]!.resolve({
              ok: true,
              revision: 5,
              result: { id: "pane-3", paneId: "pane-3" },
            }),
          );
          await setup.publish(fresh);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3");
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source);
          expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
          await act(async () => setup.mockInput.typeText("y"));
          expect(setup.sent).toEqual([{ paneId: "pane-3", bytes: [121] }]);
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }

  for (const outcome of ["failure", "cancelled success"] as const) {
    test(`native split RPC cleanup ${direction} ${outcome} from old request preserves newer pending entry`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        for (let request = 0; request < 2; request++) {
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        }
        await act(async () => {
          if (outcome === "failure") {
            setup.splits[0]!.reject(new Error("Old split refused"));
          } else {
            setup.splits[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "old-pane", paneId: "old-pane" },
            });
          }
        });
        const starting = { ...splitSurfaceSnapshot(), revision: 2 };
        if (starting.tabs[0]!.layout?.type === "split") {
          starting.tabs[0]!.layout.direction = direction;
        }
        starting.panes[1]!.processStatus = "starting";
        await setup.publish(starting);
        await act(async () =>
          setup.splits[1]!.resolve({
            ok: true,
            revision: 3,
            result: { id: "pane-2", paneId: "pane-2" },
          }),
        );
        await setup.publish({
          ...starting,
          revision: 3,
          panes: starting.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
        });
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
        await act(async () => setup.mockInput.typeText("x"));
        expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
        expect(statusText(setup)).not.toContain("Old split refused");
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });

    test(`native split RPC cleanup ${direction} ${outcome} releases its own pre-response observer`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
        await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + 1);
        await act(async () => {
          if (outcome === "failure") {
            setup.splits[0]!.reject(new Error("Split refused"));
          } else {
            setup.mockInput.typeText("x");
            setup.splits[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "pane-2", paneId: "pane-2" },
            });
          }
        });
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  test(`native split entry ${direction} waits for response revision even when a running target is already mounted`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      expect(target.width).toBeGreaterThanOrEqual(20);
      expect(target.height).toBeGreaterThanOrEqual(5);
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 3,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      await setup.publish({ ...next, revision: 3 });
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable).toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });

  test(`native split entry ${direction} preserves undersized creation without later reviving entry`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      expect(setup.commands.at(-1)).toEqual({ type: "pane.split", paneId: "pane-1", direction });
      act(() => setup.resize(80, 10));
      await setup.flush();
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source!);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      expect(target).toBeDefined();
      expect(target.focusable).toBe(false);
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      act(() => setup.resize(120, 40));
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
      expect(setup.renderer.currentFocusedRenderable).not.toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });

  test(`native split entry ${direction} retains source intent while destination native eligibility is delayed`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      // Hold the real native visibility gate across response/React ordering, then release on a frame.
      act(() => {
        target.visible = false;
      });
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      expect(source?.focusable).toBe(true);
      expect(isEligibleFocusTarget(target, setup.renderer.root)).toBe(false);
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      expect(target.focused).toBe(false);
      act(() => {
        target.visible = true;
      });
      await setup.flush();
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable).toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
  for (const order of ["response first", "snapshot first"] as const) {
    for (const readiness of ["starting", "running"] as const) {
      test(`native split entry ${direction} ${order} ${readiness} routes bytes only to the new pane`, async () => {
        const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
        try {
          const source = setup.renderer.currentFocusedRenderable;
          expect(source?.id).toBe("terminal:pane-1");
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const starting = { ...splitSurfaceSnapshot(), revision: 3 };
          if (starting.tabs[0]!.layout?.type === "split") {
            starting.tabs[0]!.layout.direction = direction;
          }
          starting.panes[1]!.processStatus = readiness;
          if (order === "snapshot first") {
            await setup.publish({ ...surfaceSnapshot(), revision: 2 });
            await setup.publish(starting);
          }
          await act(async () =>
            setup.splits[0]!.resolve({
              ok: true,
              revision: 3,
              result: { id: "pane-2", paneId: "pane-2" },
            }),
          );
          await setup.flush();
          if (order === "response first") {
            await setup.publish({ ...surfaceSnapshot(), revision: 2 });
            await setup.publish(starting);
          }
          const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
          expect(target.focusable).toBe(readiness === "running");
          const running = {
            ...starting,
            revision: 4,
            panes: starting.panes.map((pane) => ({
              ...pane,
              processStatus: "running" as const,
            })),
          };
          await setup.publish(running);
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source!);
          expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
          expect(setup.renderer.currentFocusedRenderable).toBe(target);
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  for (const stage of ["before response", "after response"] as const) {
    for (const cancellation of [
      "input",
      "paste",
      "focus round trip",
      "modal",
      "tab",
      "restart",
      "archive",
      "scroll",
      "disconnect",
      "epoch",
    ] as const) {
      test(`native split cancellation ${direction} ${stage} ${cancellation} permanently supersedes entry`, async () => {
        const initial = { ...surfaceSnapshot(), revision: 1 };
        initial.tabs.push(
          ...Array.from({ length: 11 }, (_, index) => ({
            ...initial.tabs[0]!,
            id: `extra-tab-${index}`,
            title: `Other long terminal tab ${index}`,
            position: index + 1,
            layout: null,
          })),
        );
        const setup = await liveInputFixture(initial);
        try {
          const source = setup.renderer.currentFocusedRenderable;
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          const starting = { ...splitSurfaceSnapshot(), revision: 2 };
          if (starting.tabs[0]!.layout?.type === "split") {
            starting.tabs[0]!.layout.direction = direction;
          }
          starting.tabs.push(...initial.tabs.slice(1));
          starting.panes[1]!.processStatus = "starting";
          const respond = async () => {
            await act(async () =>
              setup.splits[0]!.resolve({
                ok: true,
                revision: 2,
                result: { id: "pane-2", paneId: "pane-2" },
              }),
            );
            await setup.flush();
          };
          if (stage === "after response") {
            await respond();
          }
          await setup.publish(starting);
          if (cancellation === "input") {
            await act(async () => setup.mockInput.typeText("z"));
          } else if (cancellation === "paste") {
            await act(async () => setup.mockInput.pasteBracketedText("cancel"));
          } else if (cancellation === "focus round trip") {
            act(() => {
              setup.renderer.root.findDescendantById("region:category")!.focus();
              source!.focus();
            });
          } else if (cancellation === "modal") {
            await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          } else if (cancellation === "scroll") {
            const area = setup.renderer.root.findDescendantById(
              "region:tabs:scroller:viewport",
            ) as ScrollBoxRenderable;
            expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
            await act(async () =>
              setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
            );
            expect(setup.renderer.currentFocusedRenderable).toBe(source);
          } else if (cancellation === "disconnect") {
            act(() => {
              setup.store.stop();
              setup.renderCurrent();
            });
          } else {
            const changed = { ...starting, revision: 3 };
            if (cancellation === "tab") {
              changed.surfaces = starting.surfaces.map((surface) => ({
                ...surface,
                activeTabId: "extra-tab-0",
              }));
            } else if (cancellation === "restart") {
              changed.panes = starting.panes.map((pane) =>
                pane.id === "pane-1" ? { ...pane, processStatus: "exited" as const } : pane,
              );
            } else if (cancellation === "archive") {
              changed.items = starting.items.map((item) =>
                item.id === "item-1" ? { ...item, archived: true } : item,
              );
            } else {
              changed.epoch = "new-epoch";
            }
            await setup.publish(changed);
          }
          if (stage === "before response") {
            await respond();
          }
          const running = {
            ...starting,
            revision: 4,
            panes: starting.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
          };
          // Restore the original context as well: cancellation must not merely postpone entry.
          await setup.publish({ ...running, revision: 3 });
          await setup.publish(running);
          await setup.publish({ ...running, revision: 5 });
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
          setup.sent.length = 0;
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent.some(({ paneId }) => paneId === "pane-2")).toBe(false);
          if (["input", "paste", "focus round trip", "scroll"].includes(cancellation)) {
            expect(setup.renderer.currentFocusedRenderable).toBe(source);
            expect(setup.sent).toEqual([{ paneId: "pane-1", bytes: [120] }]);
          }
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }

  test(`native split entry ${direction} repeated splits retain terminal objects and route to each new pane`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    const setup = await liveInputFixture(initial);
    const terminals = new Map<string, Renderable>();
    let next = initial;
    try {
      terminals.set("pane-1", setup.renderer.currentFocusedRenderable!);
      for (const [index, paneId] of ["pane-2", "pane-3"].entries()) {
        const sourceId = index === 0 ? "pane-1" : "pane-2";
        await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        expect(setup.commands.at(-1)).toEqual({ type: "pane.split", paneId: sourceId, direction });
        next = {
          ...next,
          revision: index + 2,
          tabs: [
            {
              ...next.tabs[0]!,
              layout: {
                type: "split",
                direction,
                ratio: index === 0 ? 0.5 : 2 / 3,
                first: next.tabs[0]!.layout!,
                second: { type: "pane", paneId },
              },
            },
          ],
          panes: [...next.panes, { ...initial.panes[0]!, id: paneId }],
        };
        if (index === 1) {
          await setup.publish(next);
        }
        await act(async () =>
          setup.splits[index]!.resolve({
            ok: true,
            revision: next.revision,
            result: { id: paneId, paneId },
          }),
        );
        if (index === 0) {
          await setup.publish(next);
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(`terminal:${paneId}`);
        for (const [id, terminal] of terminals) {
          expect(setup.renderer.root.findDescendantById(`terminal:${id}`)).toBe(terminal);
        }
        terminals.set(paneId, setup.renderer.currentFocusedRenderable!);
        setup.sent.length = 0;
        await act(async () => setup.mockInput.typeText("x"));
        expect(setup.sent).toEqual([{ paneId, bytes: [120] }]);
      }
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

test("splitting focuses the new pane returned by the server", async () => {
  let workCraft: WorkCraftState;
  workCraft = workCraftStateFixture({
    snapshot: { ...surfaceSnapshot(), revision: 1 },
    command: async (command) => {
      if (command.type === "pane.split") {
        workCraft.snapshot = { ...splitSurfaceSnapshot(), revision: 2 };
        return {
          ok: true,
          revision: 2,
          result: { id: "pane-2", surfaceId: "surface-1", tabId: "tab-1", paneId: "pane-2" },
        };
      }
      return { ok: true, revision: 1, result: { id: "result-1" } };
    },
  });
  const setup = await testRender(<WorkCraftShell workCraft={workCraft} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
});

test("split focus survives a response arriving before the new pane snapshot", async () => {
  let publishSnapshot!: (snapshot: Snapshot) => void;
  function Fixture(): ReactNode {
    const [snapshot, setSnapshot] = useState(() => ({ ...surfaceSnapshot(), revision: 1 }));
    publishSnapshot = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: async () => ({
            ok: true,
            revision: 2,
            result: { id: "pane-2", paneId: "pane-2" },
          }),
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const original = setup.renderer.root.findDescendantById("terminal:pane-1");
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("v"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(original);
    act(() => publishSnapshot({ ...splitSurfaceSnapshot(), revision: 2 }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("split focus survives an intermediate snapshot preceding its completion revision", async () => {
  let publishSnapshot!: (snapshot: Snapshot) => void;
  function Fixture(): ReactNode {
    const [snapshot, setSnapshot] = useState(() => ({ ...surfaceSnapshot(), revision: 1 }));
    publishSnapshot = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: async (command) =>
            command.type === "pane.split"
              ? { ok: true, revision: 3, result: { id: "pane-2", paneId: "pane-2" } }
              : { ok: true, revision: 1, result: { id: "surface-1" } },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("v"));
    act(() => publishSnapshot({ ...surfaceSnapshot(), revision: 2 }));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
    act(() => publishSnapshot({ ...splitSurfaceSnapshot(), revision: 3 }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a rejected pane command stays visible in the workbench region", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          if (command.type === "surface.ensure") {
            return { ok: true, revision: 1, result: { id: "surface-1" } };
          }
          throw new Error("split failed");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("split failed");
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("a rejected tab command reports in status with a persistent tab indicator", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          if (command.type === "surface.ensure") {
            return { ok: true, revision: 1, result: { id: "surface-1" } };
          }
          throw new Error("tab failed");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("tab-error")).toBeDefined();
  expect(statusText(setup)).toContain("tab failed");
  act(() => setup.renderer.destroy());
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

test("header lays out workspace and session controls without manual widths", async () => {
  const setup = await testRender(
    <Header
      workspace={{
        activeId: "b",
        focused: false,
        workspaces: [
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
          { id: "c", name: "Gamma" },
          { id: "d", name: "Delta" },
        ],
        onActivate: () => {},
      }}
      session={{
        focused: false,
        name: "Work",
        status: "connecting",
        onOpen: () => {},
      }}
    />,
    { width: 50, height: 3 },
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Alpha");
  expect(frame).toContain("Beta");
  expect(frame).toContain("Gamma");
  expect(frame).toContain("Delta");
  expect(frame).toContain("Work");
  const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
  const session = setup.renderer.root.findDescendantById("region:session")!;
  const indicator = setup.renderer.root.findDescendantById("connection-status")!;
  expect(session.screenY).toBe(workspace.screenY);
  expect(session.screenX).toBe(workspace.screenX + workspace.width);
  expect(session.height).toBe(3);
  expect(indicator.screenY).toBe(session.screenY + 1);
  expect(indicator.screenX).toBeGreaterThanOrEqual(session.screenX);
  expect(indicator.screenX + indicator.width).toBeLessThanOrEqual(session.screenX + session.width);
  act(() => setup.renderer.destroy());
});

test("header labels remain unabridged when the terminal narrows", async () => {
  const setup = await testRender(
    <Header
      workspace={{
        activeId: "a",
        focused: false,
        workspaces: [{ id: "a", name: "Workspace with a very long name" }],
        onActivate: () => {},
      }}
      session={{
        focused: false,
        name: "Session with a very long name",
        status: "connected",
        onOpen: () => {},
      }}
    />,
    { width: 120, height: 3 },
  );
  await setup.flush();
  const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
  const session = setup.renderer.root.findDescendantById("region:session")!;
  const indicator = setup.renderer.root.findDescendantById("connection-status")!;
  for (const width of [120, 30]) {
    act(() => setup.resize(width, 3));
    await setup.flush();
    expect(
      (workspace.findDescendantById("workspace:a")!.getChildren()[0] as TextRenderable).plainText,
    ).toBe(`${icons.number1CircleOutline} Workspace with a very long name`);
    expect((session.getChildren()[1] as TextRenderable).plainText).toBe(
      "Session with a very long name",
    );
    expect(session.screenY).toBe(workspace.screenY);
    expect(indicator.screenY).toBe(session.screenY + 1);
  }
  act(() => setup.renderer.destroy());
});

test.each([
  ["Work", "Work"],
  [null, "Select session..."],
  ["工作", "工作"],
  ["A long session name", "A long session name"],
] as const)(
  "session switcher shows an account icon before the full session label (%s)",
  async (name, label) => {
    let opened = 0;
    const setup = await testRender(
      <SessionSwitcher name={name} status="connected" focused={false} onOpen={() => opened++} />,
      { width: 40, height: 3 },
    );
    try {
      await setup.flush();
      const session = setup.renderer.root.findDescendantById("region:session")!;
      const account = session.getChildren()[0] as TextRenderable;
      const text = session.getChildren()[1] as TextRenderable;
      const indicator = setup.renderer.root.findDescendantById("connection-status")!;
      expect(account.plainText).toBe(icons.account);
      expect(text.plainText).toBe(label);
      expect(account.screenY).toBe(session.screenY);
      expect(text.screenX).toBe(account.screenX + account.width + 1);
      expect(indicator.screenY).toBe(session.screenY);
      expect(indicator.screenX).toBe(text.screenX + text.width + 1);
      expect(setup.captureCharFrame()).not.toContain("Session:");
      await act(async () => setup.mockMouse.click(account.screenX, account.screenY));
      expect(opened).toBe(1);
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("controlled dialog bodies render without owning global keyboard state", async () => {
  const chooser = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={[{ id: "session-1", name: "Main", position: 0 }]}
        onCreate={() => {}}
        onSelect={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await chooser.flush();
  const chooserFrame = chooser.captureCharFrame();
  expect(chooserFrame).toContain("Sessions");
  expect(chooser.renderer.root.findDescendantById("session:search")).toBeDefined();
  act(() => chooser.renderer.destroy());

  const prompt = await testRender(
    <Dialog open>
      <CreatePrompt
        error="Name already exists"
        kind="workspace"
        value="Alpha"
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await prompt.flush();
  const promptFrame = prompt.captureCharFrame();
  expect(promptFrame).toContain("Name already exists");
  expect(promptFrame).toContain("Name");
  act(() => prompt.renderer.destroy());
});

test("session create action activates on left mouse release", async () => {
  let createCalls = 0;
  const setup = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={[{ id: "session-1", name: "Main", position: 0 }]}
        onCreate={() => {
          createCalls += 1;
        }}
        onSelect={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await setup.flush();
  const create = setup.renderer.root.findDescendantById("session:create");
  expect(create).toBeDefined();

  await act(async () => {
    await setup.mockMouse.pressDown(create!.screenX, create!.screenY);
  });
  expect(createCalls).toBe(0);

  await act(async () => {
    await setup.mockMouse.release(create!.screenX, create!.screenY);
  });
  expect(createCalls).toBe(1);
  act(() => setup.renderer.destroy());
});

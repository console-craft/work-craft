import { expect, test } from "bun:test";

import {
  BoxRenderable,
  EmbeddedTerminalRenderable,
  InputRenderable,
  type MouseEvent,
  parseColor,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { extend } from "@opentui/react";
import { testRender as renderWithoutTheme } from "@opentui/react/test-utils";
import type { Command, CommandResponse, Snapshot } from "@work-craft/server/client";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import type { WorkCraftState } from "@/client/use-work-craft.ts";
import { CreatePrompt } from "@/shell/create-prompt.tsx";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import { SessionSwitcher } from "@/shell/session-switcher.tsx";
import { WorkCraftShell } from "@/shell/shell.tsx";
import { StatusBar } from "@/shell/status-bar.tsx";
import { WorkspaceBar } from "@/shell/workspace-bar.tsx";
import { snapshotFixture } from "@/test-fixtures.ts";
import { getControlHints } from "@/ui/control-hints";
import { icons } from "@/ui/icons/nerd";
import { Box } from "@/ui/primitives/box.tsx";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";
import { TabBar } from "@/workbench/tab-bar.tsx";

extend({ terminal: EmbeddedTerminalRenderable });

async function testRender(node: ReactNode, options: Parameters<typeof renderWithoutTheme>[1]) {
  const setup = await renderWithoutTheme(
    <ThemeProvider theme={defaultTheme}>{node}</ThemeProvider>,
    options,
  );
  return {
    ...setup,
    // Native frames now publish focused action metadata into React.
    flush: async (...args: Parameters<typeof setup.flush>) => {
      await act(async () => setup.flush(...args));
    },
  };
}

function statusText(setup: Awaited<ReturnType<typeof testRender>>): string {
  return setup.renderer.root
    .findDescendantById("status")!
    .getChildren()
    .filter((child): child is TextRenderable => child instanceof TextRenderable)
    .map((child) => child.plainText)
    .join(" ");
}

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
    expect(text.includes("n Create")).toBe(create);
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
    assertHints(`${icons.return} Select`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    expect(statusText(setup)).not.toContain("Select");
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return} Select`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    await act(async () => setup.mockInput.pressKey(" "));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    assertHints(`${icons.return} Submit`, false);
    expect(statusText(setup)).not.toContain("Activate");
    expect(statusText(setup)).not.toContain("Select");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a dialog over compact navigator replaces INFO with dialog HINTS", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 70,
    height: 20,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("INFO");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
    expect(statusText(setup)).toContain(`${icons.return} Select`);
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(statusText(setup)).toContain("INFO");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal button mouse-down updates focus, styling and hints before a cancelled release", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:list") as SelectRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    const label = button.getChildren()[0] as TextRenderable;
    let mouseDown: MouseEvent | undefined;
    label.onMouseDown = (event) => {
      mouseDown = event;
    };
    const selected = list.getSelectedOption()?.value;
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockMouse.pressDown(label.screenX, label.screenY));
    await setup.flush();
    expect(mouseDown?.target).toBe(label);
    expect(mouseDown?.currentTarget?.id).toBe("dialog-overlay");
    expect(mouseDown?.propagationStopped).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    expect(mouseDown?.defaultPrevented).toBe(false);
    expect(button.focused).toBe(true);
    expect(list.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    expect(statusText(setup)).toContain(`${icons.return}/${icons.space} Activate`);
    expect(statusText(setup)).not.toContain(`${icons.return} Select`);
    expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
    await act(async () => {
      await setup.mockMouse.moveTo(0, 0);
      await setup.mockMouse.release(0, 0);
      setup.mockInput.pressKey("j");
    });
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    expect(list.getSelectedOption()?.value).toBe(selected);
    expect(setup.renderer.root.findDescendantById("session:list")).toBe(list);
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
        width={120}
        height={40}
        sessions={snapshotFixture().sessions}
        sessionCursorId="session-work"
        promptValue=""
        error={null}
        onCreateSession={() => {}}
        onFocusSession={() => {}}
        onSelectSession={(id) => selected.push(id)}
        onPromptChange={() => {}}
        onPromptSubmit={() => {}}
      />
    </Box>,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:list") as SelectRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    act(() => button.focus());
    await setup.flush();
    expect(getControlHints(button)).toEqual([{ keys: "Enter/Space", label: "Activate" }]);
    await act(async () => setup.mockMouse.pressDown(list.screenX + 1, list.screenY));
    await setup.flush();
    expect(selected).toEqual(["session-work"]);
    expect(setup.renderer.root.findDescendantById("session:list")).toBe(list);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
    expect(list.focused).toBe(true);
    expect(button.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    expect(getControlHints(list)).toEqual([{ keys: "Enter", label: "Select" }]);
    expect(getControlHints(button)).toEqual([]);
    expect(backgroundPresses).toBe(0);
    await act(async () => setup.mockMouse.release(list.screenX + 1, list.screenY));

    // Disabled controls retain visible labels but must not focus the modal boundary.
    act(() => {
      button.focusable = false;
    });
    await act(async () => setup.mockMouse.click(button.screenX, button.screenY));
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    act(() => {
      button.focusable = true;
      button.visible = false;
    });
    await setup.flush();
    await act(async () => setup.mockMouse.click(button.screenX, button.screenY));
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
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
  return {
    snapshot,
    status: "connected",
    command: async () => ({ ok: true, revision: 1, result: { id: "result-1" } }),
    reload: async () => {},
    stream: null,
    terminals: new Map(),
    ...overrides,
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
      { ...snapshot.items[0]!, id: "item-2", title: "Second item", position: 1 },
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

async function openFixtureItem(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
}

test("buffered spatial movement uses the actual native source", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: splitSurfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
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
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

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
    expect(setup.renderer.root.findDescendantById("navigator-row:item:item-1")).toBeUndefined();
    await act(async () => setup.mockInput.pressKeys(["l", "h", "l", "l"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-row:item:item-1")).toBeDefined();
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
    await act(async () => setup.mockInput.pressKeys(["\x0c", "n"]));
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("New project");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("standalone workspace and tab composites browse and activate their buffered local cursor", async () => {
  const calls: string[] = [];
  const tabs = surfaceSnapshot().tabs;
  tabs.push({ ...tabs[0]!, id: "tab-2", title: "Second", position: 1 });
  const setup = await testRender(
    <Box>
      <WorkspaceBar
        workspaces={[
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ]}
        visibleIds={["first", "second"]}
        activeId="first"
        cursorId="first"
        focused
        hasPrevious={false}
        hasNext={false}
        width={40}
        onFocus={(id) => calls.push(`workspace-focus:${id}`)}
        onActivate={(id) => calls.push(`workspace-activate:${id}`)}
      />
      <TabBar
        tabs={tabs}
        activeId="tab-1"
        cursorId="tab-1"
        focused={false}
        error={null}
        onFocus={(id) => calls.push(`tab-focus:${id}`)}
        onActivate={(id) => calls.push(`tab-activate:${id}`)}
      />
    </Box>,
    { width: 60, height: 5, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["l", "l", "\r"]));
    expect(calls).toEqual(["workspace-focus:second", "workspace-activate:second"]);
    const tab = setup.renderer.root.findDescendantById("tab:tab-2")!;
    await act(async () => {
      await setup.mockMouse.click(tab.screenX + 1, tab.screenY);
      setup.mockInput.pressKeys(["h", "\r", "h"]);
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(calls.slice(2)).toEqual([
      "tab-focus:tab-2",
      "tab-activate:tab-2",
      "tab-focus:tab-1",
      "tab-activate:tab-1",
    ]);
    await act(async () => setup.mockInput.pressKey("l", { shift: true }));
    expect(calls).toHaveLength(6);
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
    act(() => setup.resize(32, 10));
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

test("a blank-area click on projected tabs cancels automatic workbench restoration", async () => {
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
    act(() => setup.resize(32, 10));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tabs = setup.renderer.root.findDescendantById("region:tabs")!;
    const label = setup.renderer.root.findDescendantById("tab:tab-1")!;
    const x = tabs.screenX + tabs.width - 1;
    expect(x).toBeGreaterThanOrEqual(label.screenX + label.width);
    const count = commands.length;
    await act(async () => setup.mockMouse.click(x, tabs.screenY));
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
  expect(initial).toContain("Implementation");

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  const chooser = setup.captureCharFrame();
  expect(chooser).toContain("Sessions");
  expect(chooser).toContain("HINTS");
  const dialog = setup.renderer.root.findDescendantById("dialog") as BoxRenderable;
  expect(dialog.backgroundColor.a).toBe(1);
  expect({ x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height }).toEqual({
    x: 24,
    y: 8,
    width: 72,
    height: 24,
  });
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
  expect(statusText(setup)).not.toContain(`${icons.return} Select`);
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  expect(statusText(setup)).toContain(`${icons.return} Submit`);
  expect(statusText(setup)).toContain(`${icons.escape} Cancel`);

  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("No sessions. Press n to create one.");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressKey("n"));
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
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeUndefined();
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
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("INFO");

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
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("region:navigator")).toBeUndefined();
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("region:navigator")?.width).toBe(32);

  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("ARROW_RIGHT", { ctrl: true }));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("region:navigator")?.width).toBe(33);
  act(() => setup.renderer.destroy());
});

test("narrow shells compact automatically", async () => {
  const compact = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 119,
    height: 20,
    kittyKeyboard: true,
  });
  await compact.flush();
  expect(compact.renderer.root.findDescendantById("region:navigator")?.width).toBe(7);
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

  act(() => setup.resize(32, 10));
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
    await act(async () => setup.mockInput.pressKey("n"));
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
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);

  await act(async () => {
    await setup.mockMouse.click(terminal!.screenX + 1, terminal!.screenY + 1);
  });
  expect(terminal?.focused).toBe(false);
  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();

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

  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");

  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");

  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
  act(() => setup.renderer.destroy());
});

test("session Select browses without activation and confirms its cursor with Enter", async () => {
  const snapshot = snapshotFixture();
  snapshot.sessions.push({ id: "session-third", name: "Third", position: 2 });
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:list") as SelectRenderable;
  expect(list).toBeInstanceOf(SelectRenderable);
  expect(list.focused).toBe(true);

  await act(async () => setup.mockInput.pressKey("j"));
  await setup.flush();
  expect(list.getSelectedOption()?.value).toBe("session-personal");
  expect(setup.captureCharFrame()).toContain("Session: choose");

  await act(async () => setup.mockInput.pressKey("k"));
  expect(list.getSelectedOption()?.value).toBe("session-work");
  await act(async () => setup.mockInput.pressKey("n", { ctrl: true }));
  expect(list.getSelectedOption()?.value).toBe("session-personal");

  // No React commit between keys: the native cursor moves before shell state.
  await act(async () => setup.mockInput.pressKey("g"));
  await act(async () => setup.mockInput.pressKeys(["G", "k"]));
  expect(list.getSelectedOption()?.value).toBe("session-personal");

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Session: Personal");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("session Select preserves create and cancel shortcuts", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
  await act(async () => setup.mockInput.pressKey("n"));
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

test("session Select activates the clicked row after scrolling and resizing", async () => {
  const sessions = Array.from({ length: 30 }, (_, position) => ({
    id: `session-${position}`,
    name: `Session ${position}`,
    position,
  }));
  const calls: string[] = [];
  const setup = await testRender(
    <SessionChooser
      cursorId="session-0"
      sessions={sessions}
      onFocus={(id) => calls.push(`focus:${id}`)}
      onSelect={(id) => calls.push(`select:${id}`)}
      onCreate={() => {}}
    />,
    { width: 40, height: 12, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:list") as SelectRenderable;
  expect(list).toBeInstanceOf(SelectRenderable);
  act(() => list.focus());
  await act(async () => setup.mockInput.pressKey("g", { shift: true }));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Session 29");
  expect(setup.captureCharFrame()).not.toContain("Session 0");
  act(() => setup.resize(40, 10));
  await setup.flush();
  calls.length = 0;
  await act(async () => setup.mockMouse.click(list.screenX + 2, list.screenY + list.height - 2));
  expect(calls).toEqual(["focus:session-28", "select:session-28"]);
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
  expect(setup.captureCharFrame()).toContain("Session: Work");
  act(() => setup.renderer.destroy());
});

test("session button never browses its sibling list", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:list") as SelectRenderable;
    act(() => setup.renderer.root.findDescendantById("session:create")!.focus());
    const selected = list.getSelectedOption()?.value;
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
      expect(list.getSelectedOption()?.value).toBe(selected);
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
    await act(async () => setup.mockInput.pressKey("n"));
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
    await act(async () => setup.mockInput.pressKey("n"));
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
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
      }
      const endpoint = dialog === "sessions" ? "session:list" : "create:name";
      for (const name of ["h", "j", "k", "l", "[", "]", "n", "s"]) {
        await act(async () => setup.mockInput.pressKey(name, { hyper: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(endpoint);
      }
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey("v"));
      await act(async () => setup.mockMouse.pressDown(terminal.screenX + 1, terminal.screenY + 1));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(endpoint);
      expect(terminal.focused).toBe(false);
      await act(async () => setup.mockMouse.release(terminal.screenX + 1, terminal.screenY + 1));
      await setup.flush();
      expect(commands.length).toBe(commandCount);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
      expect(terminal.focused).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(endpoint);
      await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
      expect(reloads).toBe(dialog === "sessions" ? 1 : 2);
    }
    await act(async () => setup.mockInput.pressEscape());
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
    const received: string[] = [];
    session.onKeyDown = (key) => received.push(key.name);
    await act(async () => setup.mockMouse.click(session.screenX + 1, session.screenY));
    await setup.flush();
    expect(statusText(setup).startsWith("LEADER ")).toBe(false);
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
    await act(async () => setup.mockInput.pressKey("b"));
    await setup.flush();
    expect(received).toEqual(["b"]);
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
    const overlay = setup.renderer.root.findDescendantById("dialog-overlay")!;
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:list");
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

test("splitting focuses the new pane returned by the server", async () => {
  let workCraft: WorkCraftState;
  workCraft = workCraftStateFixture({
    snapshot: surfaceSnapshot(),
    command: async (command) => {
      if (command.type === "pane.split") {
        workCraft.snapshot = splitSurfaceSnapshot();
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
    const [snapshot, setSnapshot] = useState(surfaceSnapshot);
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
    act(() => publishSnapshot(splitSurfaceSnapshot()));
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

test("a rejected tab command stays visible in the tab region", async () => {
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
  expect(setup.captureCharFrame()).toContain("tab failed");
  act(() => setup.renderer.destroy());
});

test("minimum workbench size applies to the bordered interior", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  act(() => setup.resize(32, 10));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Workbench too");
  expect(setup.captureCharFrame()).toContain("small.");
  act(() => setup.renderer.destroy());
});

test("compact navigator shows invalid leader feedback", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 70,
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
  expect(setup.captureCharFrame()).toContain("INFO │ Ship navigator");
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
          cursorId="cursor"
          focused
          hasNext={false}
          hasPrevious={false}
          visibleIds={["active", "cursor", "muted"]}
          width={40}
          workspaces={[
            { id: "active", name: "Active" },
            { id: "cursor", name: "Cursor" },
            { id: "muted", name: "Muted" },
          ]}
          onActivate={() => {}}
          onFocus={() => {}}
        />
        <SessionSwitcher
          focused={false}
          name="Work"
          status="connected"
          width={20}
          onOpen={() => {}}
        />
      </Box>
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  await setup.flush();

  expect(
    (setup.renderer.root.findDescendantById("workspace:active") as TextRenderable).fg.toInts(),
  ).toEqual([7, 8, 9, 255]);
  expect(
    (setup.renderer.root.findDescendantById("workspace:cursor") as TextRenderable).fg.toInts(),
  ).toEqual([1, 2, 3, 255]);
  expect(
    (setup.renderer.root.findDescendantById("workspace:muted") as TextRenderable).fg.toInts(),
  ).toEqual([4, 5, 6, 255]);
  expect(
    (setup.renderer.root.findDescendantById("connection-status") as TextRenderable).fg.toInts(),
  ).toEqual([10, 11, 12, 255]);
  act(() => setup.renderer.destroy());
});

test("workspace overflow leaves the session control and connection dot pinned", async () => {
  const setup = await testRender(
    <Box flexDirection="row" width="100%">
      <WorkspaceBar
        activeId="b"
        cursorId="c"
        focused={false}
        hasNext
        hasPrevious
        visibleIds={["b", "c"]}
        width={30}
        workspaces={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
          { id: "c", name: "Gamma" },
          { id: "d", name: "Delta" },
        ]}
        onActivate={() => {}}
        onFocus={() => {}}
      />
      <SessionSwitcher
        focused={false}
        name="Work"
        status="connecting"
        width={20}
        onOpen={() => {}}
      />
    </Box>,
    { width: 50, height: 3 },
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("<");
  expect(frame).toContain(">");
  expect(frame).toContain("Work");
  expect(setup.renderer.root.findDescendantById("connection-status")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("long pinned header labels use trailing ellipses", async () => {
  const setup = await testRender(
    <Box flexDirection="row" width={30}>
      <WorkspaceBar
        activeId="a"
        cursorId="a"
        focused={false}
        hasNext={false}
        hasPrevious={false}
        visibleIds={["a"]}
        width={12}
        workspaces={[{ id: "a", name: "Workspace with a very long name" }]}
        onActivate={() => {}}
        onFocus={() => {}}
      />
      <SessionSwitcher
        focused={false}
        name="Session with a very long name"
        status="connected"
        width={18}
        onOpen={() => {}}
      />
    </Box>,
    { width: 30, height: 3 },
  );
  await setup.flush();
  expect(setup.captureCharFrame().match(/…/g)?.length).toBe(2);
  expect(setup.renderer.root.findDescendantById("connection-status")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("controlled dialog bodies render without owning global keyboard state", async () => {
  const chooser = await testRender(
    <SessionChooser
      cursorId="session-1"
      sessions={[{ id: "session-1", name: "Main", position: 0 }]}
      onCreate={() => {}}
      onFocus={() => {}}
      onSelect={() => {}}
    />,
    { width: 40, height: 8 },
  );
  await chooser.flush();
  const chooserFrame = chooser.captureCharFrame();
  expect(chooserFrame).toContain("Sessions");
  expect(chooserFrame).toMatch(/│─+│/);
  act(() => chooser.renderer.destroy());

  const prompt = await testRender(
    <CreatePrompt
      error="Name already exists"
      kind="workspace"
      value="Alpha"
      onChange={() => {}}
      onSubmit={() => {}}
    />,
    { width: 40, height: 8 },
  );
  await prompt.flush();
  const promptFrame = prompt.captureCharFrame();
  expect(promptFrame).toContain("Name already exists");
  expect(promptFrame).toMatch(/│─+│/);
  act(() => prompt.renderer.destroy());
});

test("session create action activates on left mouse release", async () => {
  let createCalls = 0;
  const setup = await testRender(
    <SessionChooser
      cursorId="session-1"
      sessions={[{ id: "session-1", name: "Main", position: 0 }]}
      onCreate={() => {
        createCalls += 1;
      }}
      onFocus={() => {}}
      onSelect={() => {}}
    />,
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

test("mouse-down focuses and activates a workspace through the same callbacks", async () => {
  const calls: string[] = [];
  const setup = await testRender(
    <WorkspaceBar
      activeId="a"
      cursorId="a"
      focused
      hasNext={false}
      hasPrevious={false}
      visibleIds={["a"]}
      width={30}
      workspaces={[{ id: "a", name: "Alpha" }]}
      onActivate={(id) => calls.push(`activate:${id}`)}
      onFocus={(id) => calls.push(`focus:${id}`)}
    />,
    { width: 30, height: 3 },
  );
  await setup.flush();
  const row = setup.renderer.root.findDescendantById("workspace:a");
  expect(row).toBeDefined();
  await act(async () => {
    await setup.mockMouse.click(row!.screenX, row!.screenY);
  });
  expect(calls).toEqual(["focus:a", "activate:a"]);
  act(() => setup.renderer.destroy());
});

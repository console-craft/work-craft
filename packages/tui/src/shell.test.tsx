import { expect, test } from "bun:test";
import { BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import type { Command, CommandResponse, Snapshot } from "@work-craft/server/client";
import { act } from "react";
import { CreatePrompt } from "./create-prompt.tsx";
import { NavigationPane } from "./navigation-pane.tsx";
import { SessionChooser } from "./session-chooser.tsx";
import { WorkCraftShell } from "./shell.tsx";
import { SessionSwitcher, StatusBar, WorkspaceStrip } from "./shell-regions.tsx";
import type { NavigatorEntry } from "./navigation.ts";
import { snapshotFixture } from "./test-fixtures.ts";
import type { WorkCraftState } from "./use-work-craft.ts";

extend({ terminal: EmbeddedTerminalRenderable });

const entries: NavigatorEntry[] = [
  {
    key: "project:project-1",
    kind: "project",
    id: "project-1",
    projectId: "project-1",
    label: "Work Craft",
    depth: 0,
  },
  {
    key: "item:item-1",
    kind: "item",
    id: "item-1",
    projectId: "project-1",
    label: "Ship navigator",
    depth: 1,
  },
];

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
  expect(
    (setup.renderer.root.findDescendantById("dialog") as BoxRenderable).backgroundColor.a,
  ).toBe(1);
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
  await act(async () => setup.mockInput.pressKey("n"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");

  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("No sessions. Press n to create one.");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
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

test("leader status resolves commands and reports invalid input", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("LEADER");
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

test("workbench warns before its content narrows below 60 columns", async () => {
  const small = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await small.flush();
  await openFixtureItem(small);
  act(() => small.resize(73, 20));
  await small.flush();
  expect(small.captureCharFrame()).toContain("too small.");
  act(() => small.renderer.destroy());
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

test("a late split response cannot focus a pane after changing surfaces", async () => {
  const split = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: twoSurfaceSnapshot(),
        command: async (command) =>
          command.type === "pane.split"
            ? split.promise
            : { ok: true, revision: 1, result: { id: "result-1" } },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s"));
  await act(async () => setup.mockInput.pressKey("j", { hyper: true }));

  await act(async () => {
    split.resolve({
      ok: true,
      revision: 2,
      result: { id: "pane-new", surfaceId: "surface-1", tabId: "tab-1", paneId: "pane-new" },
    });
    await split.promise;
  });
  await act(async () => setup.mockInput.pressKey("k", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
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

test("opening a collapsed project terminal expands and activates its item", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async () => ({
          ok: true,
          revision: 1,
          result: { id: "surface-1", itemId: "item-1" },
        }),
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("o"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("navigator-row:item:item-1")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("a late project-open response cannot activate an item behind a dialog", async () => {
  const open = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) =>
          command.type === "surface.ensureHere"
            ? open.promise
            : { ok: true, revision: 1, result: { id: "result-1" } },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("o"));
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));

  await act(async () => {
    open.resolve({
      ok: true,
      revision: 2,
      result: { id: "surface-1", itemId: "item-1" },
    });
    await open.promise;
  });
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("a late create response cannot activate an item after cancelling its dialog", async () => {
  const create = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: twoSurfaceSnapshot(),
        command: async (command) =>
          command.type === "item.create"
            ? create.promise
            : { ok: true, revision: 1, result: { id: "result-1" } },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("n"));
  await act(async () => setup.mockInput.typeText("Late item"));
  await act(async () => setup.mockInput.pressEnter());
  await act(async () => setup.mockInput.pressEscape());

  await act(async () => {
    create.resolve({ ok: true, revision: 2, result: { id: "item-2" } });
    await create.promise;
  });
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
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

test("navigator renders one stable projection in expanded and compact modes", async () => {
  const expanded = await testRender(
    <NavigationPane
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      height={10}
      mode="expanded"
      width={24}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 30, height: 10 },
  );
  await expanded.flush();
  expect(expanded.captureCharFrame()).toContain("Work Craft");
  expect(expanded.captureCharFrame()).toContain("Ship navigator");
  act(() => expanded.renderer.destroy());

  const compact = await testRender(
    <NavigationPane
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      height={10}
      mode="compact"
      width={7}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 10, height: 10 },
  );
  await compact.flush();
  const frame = compact.captureCharFrame();
  expect(frame).toContain("WC");
  expect(frame).toContain("·");
  expect(frame).not.toContain("Ship navigator");
  act(() => compact.renderer.destroy());
});

test("compact navigator status exposes the full cursor label", async () => {
  const setup = await testRender(<StatusBar mode="INFO" text="Ship navigator" />, {
    width: 40,
    height: 2,
  });
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("INFO  Ship navigator");
  act(() => setup.renderer.destroy());
});

test("workspace overflow leaves the session control and connection dot pinned", async () => {
  const setup = await testRender(
    <box flexDirection="row" width="100%">
      <WorkspaceStrip
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
    </box>,
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
    <box flexDirection="row" width={30}>
      <WorkspaceStrip
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
    </box>,
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
  expect(chooser.captureCharFrame()).toContain("Sessions");
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
  expect(prompt.captureCharFrame()).toContain("Name already exists");
  act(() => prompt.renderer.destroy());
});

test("mouse-down focuses and activates a workspace through the same callbacks", async () => {
  const calls: string[] = [];
  const setup = await testRender(
    <WorkspaceStrip
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

import { expect } from "bun:test";

import { EmbeddedTerminalRenderable, type Renderable, TextRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { type Command, type CommandResponse, type Snapshot } from "@work-craft/server/client";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { createWorkCraftStore, type WorkCraftState } from "@/client/store.ts";
import { WorkCraftShell } from "@/shell/shell.tsx";
import { snapshotFixture } from "@/tests/support/fixtures.ts";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender as renderWithoutTheme } from "@/tests/support/render";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";
import { paneIds } from "@/workbench/layout.ts";

extend({ terminal: EmbeddedTerminalRenderable });

export async function testRender(
  node: ReactNode,
  options: Parameters<typeof renderWithoutTheme>[1],
) {
  const setup = await renderWithoutTheme(
    <ThemeProvider theme={defaultTheme}>{node}</ThemeProvider>,
    { exitOnCtrlC: false, ...options },
  );
  return {
    ...setup,
    flush: (...args: Parameters<typeof setup.flush>) => flushMeasured(setup, ...args),
  };
}

export function statusText(setup: Awaited<ReturnType<typeof testRender>>): string {
  function text(node: Renderable): string {
    return node instanceof TextRenderable
      ? node.plainText
      : node.getChildren().map(text).filter(Boolean).join(" ");
  }
  return text(setup.renderer.root.findDescendantById("status")!);
}

export function deferred<T>(): {
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

export function workCraftStateFixture(overrides: Partial<WorkCraftState> = {}): WorkCraftState {
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

export async function liveInputFixture(initial = splitSurfaceSnapshot()) {
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

export function surfaceSnapshot(): Snapshot {
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

export function splitSurfaceSnapshot(): Snapshot {
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

export function twoSurfaceSnapshot(): Snapshot {
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

export function twoTabSnapshot(activeTabId = "tab-1", revision = 4, count = 2): Snapshot {
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

export async function localTabFixture(rememberDestination = true, count = 2, creating = false) {
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

export async function openFixtureItem(
  setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  await setup.flush();
  // Hyper selection intentionally does not create local terminal-entry intent.
  await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
  await setup.flush();
}

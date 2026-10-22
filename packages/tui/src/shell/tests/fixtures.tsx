import { expect } from "bun:test";

import { type Renderable, TextRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import {
  type Command,
  type CommandResponse,
  type ControlSnapshot,
  type Snapshot,
  type ViewerReport,
  type WorkCraftClient,
} from "@work-craft/server/client";
import { act, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { createWorkCraftStore, type WorkCraftState } from "@/client/store.ts";
import { appendTerminalChunk, snapshotTerminals } from "@/client/terminal-buffer";
import { createTerminalOutputs } from "@/client/terminal-output";
import { WorkCraftShell } from "@/shell/shell.tsx";
import {
  attachmentFixture,
  controlSnapshotFixture,
  snapshotFixture,
  streamFixture,
  terminalSnapshotFixture,
} from "@/tests/support/fixtures.ts";
import { materialStreamFixture } from "@/tests/support/material-stream";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender as renderWithoutTheme } from "@/tests/support/render";
import { ThemeProvider } from "@/ui/theming/theme-provider.tsx";
import { defaultTheme } from "@/ui/theming/themes/default.ts";
import { paneIds } from "@/workbench/layout.ts";
import { TerminalMaterialRenderable } from "@/workbench/terminal-material";

extend({ terminal: TerminalMaterialRenderable });

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
    flush: async (...args: Parameters<typeof setup.flush>) => {
      await flushMeasured(setup, ...args);
      // The canonical viewport commits its native readiness after parent measurement.
      await act(async () => setup.flush(...args));
    },
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

export function workCraftStateFixture(
  overrides: Omit<Partial<WorkCraftState>, "snapshot"> & {
    snapshot?: Snapshot | ControlSnapshot | null;
  } = {},
): WorkCraftState {
  const snapshot = snapshotFixture({
    navigation: [
      {
        sessionId: "session-work",
        generation: 0,
        workspaceId: "workspace-shared",
        category: "implementation",
        itemId: "root-1",
        tabId: null,
        paneId: null,
      },
    ],
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
  const { snapshot: suppliedSnapshot, ...rest } = overrides;
  const source = suppliedSnapshot === undefined ? snapshot : suppliedSnapshot;
  const initial =
    source && ("terminalHistories" in source ? terminalSnapshotFixture(source) : source);
  const fixture: WorkCraftState = {
    getState: () => fixture,
    snapshot: initial && controlSnapshotFixture(initial),
    status: "connected",
    connectionError: null,
    attachment: attachmentFixture(),
    requestedSessionId: "session-work",
    geometry: snapshot.geometry,
    attach: async (sessionId) => {
      if (sessionId !== null && !fixture.snapshot?.sessions.some(({ id }) => id === sessionId)) {
        throw new Error("session not found");
      }
      fixture.attachment = {
        ...attachmentFixture(sessionId),
        generation: (fixture.attachment?.generation ?? 0) + 1,
      };
      fixture.requestedSessionId = sessionId;
    },
    canRespond: () => false,
    canSendInput: (paneId, stamp) => {
      const current = fixture.snapshot;
      const pane = current?.panes.find((pane) => pane.id === paneId);
      const surface = current?.surfaces.find((surface) => surface.id === pane?.surfaceId);
      const navigation = current?.navigation.find(
        ({ sessionId }) => sessionId === fixture.attachment?.sessionId,
      );
      const tab = current?.tabs.find(
        (tab) => tab.id === navigation?.tabId && tab.surfaceId === surface?.id,
      );
      return (
        fixture.status === "connected" &&
        current?.epoch === stamp.epoch &&
        navigation?.paneId === paneId &&
        navigation.generation === stamp.navigationGeneration &&
        pane?.processStatus === "running" &&
        paneIds(tab?.layout ?? null).includes(paneId)
      );
    },
    canReactivate: (paneId, stamp) => {
      const current = fixture.snapshot;
      const pane = current?.panes.find((pane) => pane.id === paneId);
      const surface = current?.surfaces.find((surface) => surface.id === pane?.surfaceId);
      const item = current?.items.find((item) => item.id === surface?.itemId);
      const parent = current?.items.find((parent) => parent.id === item?.parentId);
      const navigation = current?.navigation.find(
        ({ sessionId }) => sessionId === fixture.attachment?.sessionId,
      );
      const tab = current?.tabs.find(
        (tab) => tab.id === navigation?.tabId && tab.surfaceId === surface?.id,
      );
      return (
        fixture.status === "connected" &&
        current?.epoch === stamp.epoch &&
        navigation?.generation === stamp.navigationGeneration &&
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
    resync: async () => {},
    resyncPane: async () => {},
    stream: null,
    outputs: createTerminalOutputs(),
    ...rest,
  };
  if (overrides.attachment === undefined) {
    fixture.attachment =
      fixture.snapshot?.sessions.length === 1
        ? attachmentFixture(fixture.snapshot.sessions[0]!.id)
        : attachmentFixture(null);
  }
  fixture.geometry = fixture.snapshot?.geometry ?? { sequence: 0, tabs: [], panes: [] };
  fixture.requestedSessionId =
    overrides.requestedSessionId === undefined
      ? (fixture.attachment?.sessionId ?? null)
      : overrides.requestedSessionId;
  if (overrides.outputs === undefined && initial && "terminalHistories" in initial) {
    fixture.outputs = createTerminalOutputs(snapshotTerminals(initial, new Map()));
  }
  if (fixture.status === "connected" && overrides.stream !== null) {
    fixture.stream = materialStreamFixture(
      (paneId) => fixture.outputs.pane(paneId).read(),
      (paneId) =>
        fixture.geometry.panes.find((pane) => pane.paneId === paneId)?.size ?? {
          cols: 80,
          rows: 24,
        },
      fixture.stream ?? streamFixture(),
    );
  }
  return fixture;
}

export async function liveInputFixture(
  initial = splitSurfaceSnapshot(),
  initiallyDetached = false,
) {
  initial = terminalSnapshotFixture(initial);
  const sent: { paneId: string; bytes: number[] }[] = [];
  const resized: { paneId: string; cols: number; rows: number }[] = [];
  const viewports: (ViewerReport | null)[] = [];
  const activities: unknown[] = [];
  const commands: Command[] = [];
  const restarts: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const splits: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const tabCreates: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const registrations: ReturnType<typeof deferred<CommandResponse>>[] = [];
  let commit: ((state: WorkCraftState) => void) | undefined;
  const client: WorkCraftClient = {
    ensureDaemon: async () => {},
    health: async () => ({
      epoch: initial.epoch,
      revision: initial.revision,
      pid: 1,
      protocol: "work-craft-projection-preview/1",
    }),
    snapshot: async () => initial,
    controlSnapshot: async () => controlSnapshotFixture(initial),
    paneHistory: async (paneId) => ({
      epoch: initial.epoch,
      paneId,
      runtimeGeneration: 0,
      history: initial.terminalHistories.find((history) => history.paneId === paneId)!,
    }),
    streamOnce: async () => ({ type: "snapshot", snapshot: initial }),
    stream: async () =>
      materialStreamFixture(
        (paneId) => store.getState().outputs.pane(paneId).read(),
        (paneId) =>
          store.getState().geometry.panes.find((pane) => pane.paneId === paneId)?.size ?? {
            cols: 80,
            rows: 24,
          },
        streamFixture({
          close() {},
          sendInput: (paneId, bytes) => sent.push({ paneId, bytes: [...bytes] }),
          reportViewport: (report) => viewports.push(report),
          activity: (...args) => activities.push(args),
          command: (command) => client.command(command),
        }),
      ),
    command: async (command) => {
      commands.push(command);
      if (command.type === "directory.register") {
        const request = deferred<CommandResponse>();
        registrations.push(request);
        return request.promise;
      }
      if (command.type === "session.navigate" && command.target.kind === "pane") {
        const current = store.snapshot()!;
        const old = current.navigation.find(({ sessionId }) => sessionId === command.sessionId)!;
        const paneId = command.target.paneId;
        const navigation = {
          ...old,
          paneId,
          generation: old.generation + Number(old.paneId !== paneId),
        };
        const next = {
          ...current,
          revision: current.revision + Number(old.paneId !== paneId),
          navigation: current.navigation.map((cursor) =>
            cursor.sessionId === command.sessionId ? navigation : cursor,
          ),
        };
        await store.apply({ type: "control.snapshot", snapshot: next });
        commit?.(store.getState());
        return { ok: true, revision: next.revision, result: { id: paneId, paneId, navigation } };
      }
      if (command.type === "session.step" && command.level === "item") {
        const current = store.snapshot()!;
        const old = current.navigation[0]!;
        const items = current.items.filter(
          (item) =>
            !item.archived &&
            item.workspaceId === old.workspaceId &&
            item.category === old.category,
        );
        const index = items.findIndex(({ id }) => id === old.itemId);
        const item = items[Math.max(0, Math.min(items.length - 1, index + command.direction))]!;
        const surface = current.surfaces.find(({ itemId }) => itemId === item.id);
        const tab = current.tabs.find(({ surfaceId }) => surfaceId === surface?.id);
        const navigation = {
          ...old,
          generation: old.generation + Number(item.id !== old.itemId),
          itemId: item.id,
          tabId: tab?.id ?? null,
          paneId: paneIds(tab?.layout ?? null)[0] ?? null,
        };
        const next = {
          ...current,
          revision: current.revision + Number(item.id !== old.itemId),
          navigation: [navigation],
        };
        await store.apply({ type: "control.snapshot", snapshot: next });
        commit?.(store.getState());
        return { ok: true, revision: next.revision, result: { id: item.id, navigation } };
      }
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
  };
  const store = createWorkCraftStore(client);
  await store.start();
  if (initiallyDetached) {
    await store.getState().attach(null);
  }
  function Fixture() {
    const [state, setState] = useState(store.getState());
    commit = setState;
    return <WorkCraftShell workCraft={state} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  await setup.flush();
  if (initiallyDetached) {
    await act(async () => {
      await store.getState().attach("session-work");
      commit?.(store.getState());
    });
    await setup.flush();
  }
  await openFixtureItem(setup);
  act(() => setup.renderer.root.findDescendantById("terminal:pane-1")!.focus());
  await setup.flush();
  sent.length = 0;
  commands.length = 0;
  return {
    ...setup,
    client,
    store,
    sent,
    resized,
    viewports,
    activities,
    commands,
    restarts,
    splits,
    tabCreates,
    registrations,
    async output(text: string, targetPaneId?: string): Promise<void> {
      const current = store.getState();
      const navigation = current.snapshot!.navigation[0]!;
      const paneId = targetPaneId ?? navigation.paneId!;
      const buffer = current.outputs.pane(paneId).read()!;
      const bytes = new TextEncoder().encode(text);
      await store.apply({
        type: "terminal.output",
        runtimeGeneration: buffer.runtimeGeneration,
        epoch: current.snapshot!.epoch,
        paneId,
        cursor: (buffer.chunks.at(-1)?.cursor ?? buffer.historyCursor) + bytes.length,
        data: Buffer.from(bytes).toString("base64"),
        geometrySequence: current.geometry.sequence,
      });
      commit?.(store.getState());
    },
    renderCurrent() {
      act(() => commit!(store.getState()));
    },
    async publish(snapshot: Snapshot | ControlSnapshot, render = true) {
      const next = "terminalHistories" in snapshot ? terminalSnapshotFixture(snapshot) : snapshot;
      const previous = store.snapshot()?.geometry;
      if (
        previous &&
        (JSON.stringify(previous.tabs) !== JSON.stringify(next.geometry.tabs) ||
          JSON.stringify(previous.panes) !== JSON.stringify(next.geometry.panes))
      ) {
        next.geometry.sequence = Math.max(next.geometry.sequence, previous.sequence + 1);
      }
      await store.apply(
        "terminalHistories" in next
          ? { type: "snapshot", snapshot: next }
          : { type: "control.snapshot", snapshot: next },
      );
      if (render) {
        act(() => commit!(store.getState()));
        await setup.flush();
      }
    },
  };
}

export function surfaceSnapshot(): Snapshot {
  return terminalSnapshotFixture(
    snapshotFixture({
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
          sessionId: "session-work",
          generation: 1,
          workspaceId: "workspace-shared",
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
    }),
  );
}

export function splitSurfaceSnapshot(): Snapshot {
  const snapshot = surfaceSnapshot();
  return terminalSnapshotFixture({
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
  });
}

export function selectedPaneSnapshot<T extends Omit<Snapshot, "terminalHistories">>(
  snapshot: T,
  paneId: string,
  generation: number,
): T {
  const tab = snapshot.tabs.find((tab) => paneIds(tab.layout).includes(paneId))!;
  const surface = snapshot.surfaces.find(({ id }) => id === tab.surfaceId)!;
  const item = snapshot.items.find(({ id }) => id === surface.itemId)!;
  return {
    ...snapshot,
    navigation: [
      {
        ...snapshot.navigation[0]!,
        generation,
        workspaceId: item.workspaceId,
        category: item.category,
        itemId: item.id,
        tabId: tab.id,
        paneId,
      },
    ],
  };
}

export function twoSurfaceSnapshot(): Snapshot {
  const snapshot = surfaceSnapshot();
  return terminalSnapshotFixture({
    ...snapshot,
    items: [
      ...snapshot.items,
      { ...snapshot.items[1]!, id: "item-2", title: "Second item", position: 1 },
    ],
    surfaces: [...snapshot.surfaces, { id: "surface-2", itemId: "item-2" }],
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
  });
}

export function twoTabSnapshot(
  activeTabId = "tab-1",
  revision = 4,
  count = 2,
  selectedPane = "b",
): Snapshot {
  const snapshot = surfaceSnapshot();
  return terminalSnapshotFixture({
    ...snapshot,
    revision,
    navigation: [
      {
        ...snapshot.navigation[0]!,
        generation: revision,
        tabId: activeTabId,
        paneId: `pane-${activeTabId.slice(4)}${selectedPane}`,
      },
    ],
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
  });
}

export async function localTabFixture(rememberDestination = true, count = 2, creating = false) {
  let output!: (text: string) => void;
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  let connect!: (value: boolean) => void;
  const requests: ReturnType<typeof deferred<CommandResponse>>[] = [];
  const requestTargets: { tabId: string; paneId: string }[] = [];
  const commands: Command[] = [];
  const received: { paneId: string; bytes: number[] }[] = [];
  function Fixture() {
    const [snapshot, setSnapshot] = useState(() => {
      const initial = twoTabSnapshot("tab-1", 4, count);
      initial.geometry.tabs[0]!.ownerConnectionId = "test-connection";
      return initial;
    });
    const [connected, setConnected] = useState(true);
    const [buffers, setBuffers] = useState<ReturnType<typeof snapshotTerminals> | null>(null);
    output = (text) => {
      const terminals = new Map(buffers ?? snapshotTerminals(snapshot, new Map()));
      const navigation = snapshot.navigation[0]!;
      const paneId = navigation.paneId!;
      const buffer = terminals.get(paneId)!;
      const bytes = new TextEncoder().encode(text);
      terminals.set(
        paneId,
        appendTerminalChunk(
          buffer,
          (buffer.chunks.at(-1)?.cursor ?? buffer.historyCursor) + bytes.length,
          bytes,
          snapshot.geometry.sequence,
          "live",
          {
            epoch: snapshot.epoch,
            attachmentGeneration: 1,
            navigationGeneration: navigation.generation,
            geometrySequence: snapshot.geometry.tabs.find(
              ({ tabId }) => tabId === navigation.tabId,
            )!.generation,
          },
        ),
      );
      setBuffers(terminals);
    };
    connect = setConnected;
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          ...(buffers === null ? {} : { outputs: createTerminalOutputs(buffers) }),
          status: connected ? "connected" : "disconnected",
          stream: streamFixture({
            close() {},
            sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
          }),
          canRespond: (paneId, stamp) =>
            connected &&
            stamp.epoch === snapshot.epoch &&
            snapshot.navigation[0]?.paneId === paneId &&
            stamp.navigationGeneration === snapshot.navigation[0].generation &&
            snapshot.geometry.tabs.find(({ tabId }) => tabId === snapshot.navigation[0]?.tabId)
              ?.ownerConnectionId === "test-connection",
          command: async (command) => {
            commands.push(command);
            if (command.type === "session.navigate" && command.target.kind === "workspace") {
              const navigation = {
                ...snapshot.navigation[0]!,
                generation: snapshot.navigation[0]!.generation + 1,
                workspaceId: command.target.workspaceId,
                category: "inbox" as const,
                itemId: null,
                tabId: null,
                paneId: null,
              };
              setSnapshot({
                ...snapshot,
                revision: snapshot.revision + 1,
                navigation: [navigation],
              });
              return {
                ok: true,
                revision: snapshot.revision + 1,
                result: { id: command.target.workspaceId, navigation },
              };
            }
            if (command.type === "session.navigate" && command.target.kind === "pane") {
              const navigation = {
                ...snapshot.navigation[0]!,
                paneId: command.target.paneId,
                generation: snapshot.navigation[0]!.generation + 1,
              };
              const next = {
                ...snapshot,
                revision: snapshot.revision + 1,
                navigation: [navigation],
              };
              setSnapshot(next);
              return {
                ok: true,
                revision: next.revision,
                result: { id: navigation.paneId, paneId: navigation.paneId, navigation },
              };
            }
            if (
              (command.type === "session.step" && command.level === "tab") ||
              (command.type === "session.navigate" && command.target.kind === "tab") ||
              command.type === "process.restart" ||
              command.type === "tab.create"
            ) {
              const request = deferred<CommandResponse>();
              const cursor = snapshot.navigation[0]!;
              const stepIndex = snapshot.tabs.findIndex(({ id }) => id === cursor.tabId);
              const tabId =
                command.type === "session.navigate" && command.target.kind === "tab"
                  ? command.target.tabId
                  : command.type === "session.step"
                    ? snapshot.tabs[
                        Math.max(
                          0,
                          Math.min(snapshot.tabs.length - 1, stepIndex + command.direction),
                        )
                      ]!.id
                    : command.type === "tab.create"
                      ? "tab-2"
                      : cursor.tabId!;
              const paneId =
                command.type === "process.restart"
                  ? command.paneId
                  : `pane-${tabId.slice(4)}${tabId === "tab-1" || rememberDestination || command.type === "tab.create" ? "b" : "a"}`;
              if (command.type === "session.step" && tabId === cursor.tabId) {
                return {
                  ok: true,
                  revision: snapshot.revision,
                  result: { id: tabId, tabId, paneId: cursor.paneId!, navigation: cursor },
                };
              }
              requests.push(request);
              requestTargets.push({ tabId, paneId });
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
  act(() => setup.renderer.root.findDescendantById("terminal:pane-1b")!.focus());
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
  commands.length = 0;
  return {
    ...setup,
    commands,
    requests,
    output: (text: string) => act(() => output(text)),
    received,
    connect: (value: boolean) => act(() => connect(value)),
    publish: (snapshot: Snapshot) => act(() => publish(snapshot)),
    respond: (index = 0, revision = 5, paneId = requestTargets[index]!.paneId) =>
      act(async () =>
        requests[index]!.resolve({
          ok: true,
          revision,
          result: {
            id: requestTargets[index]!.tabId,
            ...requestTargets[index],
            paneId,
            navigation: {
              ...twoTabSnapshot(requestTargets[index]!.tabId, revision).navigation[0]!,
              paneId,
            },
          },
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
}

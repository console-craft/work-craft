import { expect, test } from "bun:test";

import type { Command, CommandResponse } from "@work-craft/server/client";

import {
  availableCommands,
  type CompletionContext,
  completionContextFor,
  durableCommands,
  executeCommand,
  type ExecuteCommandInput,
  runDurableCommand,
  submitCreate,
} from "@/shell/commands.ts";
import { deriveShellModel } from "@/shell/model.ts";
import {
  createInitialShellState,
  type ShellAction,
  type ShellRegion,
  type ShellState,
} from "@/shell/state.ts";
import { snapshotFixture } from "@/test-fixtures.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function activeItemFixture(): {
  snapshot: ReturnType<typeof snapshotFixture>;
  state: ShellState;
  model: ReturnType<typeof deriveShellModel>;
} {
  const snapshot = snapshotFixture({
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
        processStatus: "failed",
        errorText: "exited",
        startedAt: null,
        exitedAt: null,
      },
    ],
  });
  const state: ShellState = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-shared",
    activeCategory: "implementation",
    activeNavigatorKey: "item:item-1",
    workspaceCursorId: "workspace-shared",
    categoryCursor: "implementation",
    navigatorCursorKey: "item:item-1",
    tabCursorId: "tab-1",
    focus: { region: "workbench", paneId: "pane-1" },
    lastWorkbenchPaneId: "pane-1",
    expandedProjectIds: new Set(["project-1"]),
  };
  return {
    snapshot,
    state,
    model: deriveShellModel({ snapshot, state, sessionCursorId: null }),
  };
}

function executionInput(
  command: ExecuteCommandInput["command"],
  fixture: ReturnType<typeof activeItemFixture>,
  actions: ShellAction[],
  run: ExecuteCommandInput["run"],
  overrides: Partial<ExecuteCommandInput> = {},
): ExecuteCommandInput {
  return {
    command,
    model: fixture.model,
    state: fixture.state,
    snapshot: fixture.snapshot,
    focus: fixture.state.focus,
    focusedPaneId: "pane-1",
    focusNodes: [],
    terminalWidth: 120,
    dispatch(action) {
      actions.push(action);
    },
    setSessionCursorId() {},
    run,
    async reload() {},
    quit() {},
    ...overrides,
  };
}

test("constructs hierarchy commands", () => {
  expect(durableCommands.createSession("Work")).toEqual({
    type: "session.create",
    name: "Work",
  });
  expect(durableCommands.createWorkspace("session-1", "Client")).toEqual({
    type: "workspace.create",
    sessionId: "session-1",
    name: "Client",
  });
  expect(durableCommands.createProject("workspace-1", "implementation", "Shell")).toEqual({
    type: "project.create",
    workspaceId: "workspace-1",
    category: "implementation",
    name: "Shell",
  });
  expect(durableCommands.createItem("project-1", "Extract commands")).toEqual({
    type: "item.create",
    projectId: "project-1",
    kind: "generic",
    title: "Extract commands",
  });
});

test("constructs surface and tab commands", () => {
  expect(durableCommands.openItem("item-1")).toEqual({
    type: "surface.ensure",
    itemId: "item-1",
  });
  expect(durableCommands.openProject("project-1")).toEqual({
    type: "surface.ensureHere",
    projectId: "project-1",
  });
  expect(durableCommands.createTab("surface-1")).toEqual({
    type: "tab.create",
    surfaceId: "surface-1",
    title: "Shell",
  });
  expect(durableCommands.selectTab("surface-1", "tab-1")).toEqual({
    type: "surface.selectTab",
    surfaceId: "surface-1",
    tabId: "tab-1",
  });
});

test("constructs semantic pane commands", () => {
  expect(durableCommands.splitHorizontal("pane-1")).toEqual({
    type: "pane.split",
    paneId: "pane-1",
    direction: "horizontal",
  });
  expect(durableCommands.splitVertical("pane-1")).toEqual({
    type: "pane.split",
    paneId: "pane-1",
    direction: "vertical",
  });
  expect(durableCommands.restartPane("pane-1")).toEqual({
    type: "process.restart",
    paneId: "pane-1",
  });
});

test("builds completion keys from durable navigation and surface context", () => {
  const { model } = activeItemFixture();
  const navigationKey = JSON.stringify([
    "epoch-a",
    "session-work",
    "workspace-shared",
    "implementation",
    "item:item-1",
  ]);

  expect(completionContextFor(model, null)).toEqual({
    key: JSON.stringify([navigationKey, "surface-1", "tab-1"]),
    navigationKey,
    dialog: null,
  });
});

test("reports structural commands without applying connection policy", () => {
  const { model, snapshot, state } = activeItemFixture();

  expect(
    availableCommands({
      model,
      state,
      snapshot,
      focus: { region: "workbench", paneId: "pane-1" },
      focusedPaneId: "pane-1",
    }),
  ).toEqual(
    new Set([
      "focus.left",
      "focus.down",
      "focus.up",
      "focus.right",
      "navigator.toggle",
      "session.open",
      "client.reload",
      "client.quit",
      "category.previous",
      "category.next",
      "navigator.previous",
      "tab.create",
      "pane.splitHorizontal",
      "pane.splitVertical",
      "pane.restart",
      "item.create",
    ]),
  );
});

test("splitting focuses the new pane returned by the server", async () => {
  const fixture = activeItemFixture();
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  const current = completionContextFor(fixture.model, fixture.state.dialog);
  const run: ExecuteCommandInput["run"] = (command, region, expected = current) =>
    runDurableCommand({
      command,
      region,
      expected,
      current: () => current,
      send: async (next) => {
        sent.push(next);
        return {
          ok: true,
          revision: 5,
          result: {
            id: "pane-2",
            surfaceId: "surface-1",
            tabId: "tab-1",
            paneId: "pane-2",
          },
        };
      },
      dispatch(action) {
        actions.push(action);
      },
    });

  await executeCommand(executionInput("pane.splitHorizontal", fixture, actions, run));

  expect(sent).toEqual([{ type: "pane.split", paneId: "pane-1", direction: "horizontal" }]);
  expect(actions).toContainEqual({
    type: "focus.set",
    focus: { region: "workbench", paneId: "pane-2" },
  });
});

test("a late split response cannot focus a pane after changing surfaces", async () => {
  const fixture = activeItemFixture();
  const split = deferred<CommandResponse>();
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  let current = completionContextFor(fixture.model, fixture.state.dialog);
  const run: ExecuteCommandInput["run"] = (command, region, expected = current) =>
    runDurableCommand({
      command,
      region,
      expected,
      current: () => current,
      send: async (next) => {
        sent.push(next);
        return split.promise;
      },
      dispatch(action) {
        actions.push(action);
      },
    });

  const pending = executeCommand(executionInput("pane.splitHorizontal", fixture, actions, run));
  current = { ...current, key: "another-surface" };
  split.resolve({
    ok: true,
    revision: 5,
    result: {
      id: "pane-2",
      surfaceId: "surface-1",
      tabId: "tab-1",
      paneId: "pane-2",
    },
  });
  await pending;

  expect(sent).toEqual([{ type: "pane.split", paneId: "pane-1", direction: "horizontal" }]);
  expect(actions).toEqual([]);
});

test("opening a collapsed project terminal expands and activates its item", async () => {
  const fixture = activeItemFixture();
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "project:project-1",
    navigatorCursorKey: "project:project-1",
    focus: { region: "navigator" },
    expandedProjectIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
    sessionCursorId: null,
  });
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  const run: ExecuteCommandInput["run"] = async (command) => {
    sent.push(command);
    return { id: "surface-1", itemId: "item-1" };
  };

  await executeCommand(
    executionInput("project.openTerminal", fixture, actions, run, {
      focus: { region: "navigator" },
      focusedPaneId: null,
    }),
  );

  expect(sent).toEqual([{ type: "surface.ensureHere", projectId: "project-1" }]);
  expect(actions).toEqual([
    { type: "project.toggle", projectId: "project-1" },
    { type: "navigator.activate", key: "item:item-1" },
  ]);
});

test("a late project-open response cannot activate an item behind a dialog", async () => {
  const fixture = activeItemFixture();
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "project:project-1",
    navigatorCursorKey: "project:project-1",
    focus: { region: "navigator" },
    expandedProjectIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
    sessionCursorId: null,
  });
  const open = deferred<CommandResponse>();
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  let current = completionContextFor(fixture.model, null);
  const run: ExecuteCommandInput["run"] = (command, region, expected = current) =>
    runDurableCommand({
      command,
      region,
      expected,
      current: () => current,
      send: async (next) => {
        sent.push(next);
        return open.promise;
      },
      dispatch(action) {
        actions.push(action);
      },
    });

  const pending = executeCommand(
    executionInput("project.openTerminal", fixture, actions, run, {
      focus: { region: "navigator" },
      focusedPaneId: null,
    }),
  );
  current = {
    ...current,
    dialog: { kind: "sessions", returnFocus: { region: "navigator" } },
  };
  open.resolve({
    ok: true,
    revision: 5,
    result: { id: "surface-1", itemId: "item-1" },
  });
  await pending;

  expect(sent).toEqual([{ type: "surface.ensureHere", projectId: "project-1" }]);
  expect(actions).toEqual([]);
});

test("a late create response cannot activate an item after cancelling its dialog", async () => {
  const fixture = activeItemFixture();
  const dialog = {
    kind: "create" as const,
    createKind: "item" as const,
    returnFocus: { region: "navigator" as const },
  };
  fixture.state = {
    ...fixture.state,
    dialog,
    focus: { region: "navigator" },
    navigatorCursorKey: "item:item-1",
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
    sessionCursorId: null,
  });
  const create = deferred<CommandResponse>();
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  let current: CompletionContext = completionContextFor(fixture.model, dialog);
  let submitting: Exclude<ShellState["dialog"], null> | null = null;
  const run = (command: Command, region: ShellRegion) =>
    runDurableCommand({
      command,
      region,
      expected: current,
      current: () => current,
      send: async (next) => {
        sent.push(next);
        return create.promise;
      },
      dispatch(action) {
        actions.push(action);
      },
    });

  const pending = submitCreate({
    value: "Late item",
    model: fixture.model,
    state: fixture.state,
    snapshot: fixture.snapshot,
    getSubmittingDialog: () => submitting,
    setSubmittingDialog(dialogState) {
      submitting = dialogState;
    },
    dispatch(action) {
      actions.push(action);
    },
    run,
  });
  current = { ...current, dialog: null };
  create.resolve({ ok: true, revision: 5, result: { id: "item-2" } });
  await pending;

  expect(sent).toEqual([
    { type: "item.create", projectId: "project-1", kind: "generic", title: "Late item" },
  ]);
  expect(actions).toEqual([]);
  expect(submitting).toBeNull();
});

test("a create prompt submits only once while its command is pending", async () => {
  const fixture = activeItemFixture();
  const dialog = {
    kind: "create" as const,
    createKind: "item" as const,
    returnFocus: { region: "navigator" as const },
  };
  fixture.state = {
    ...fixture.state,
    dialog,
    focus: { region: "navigator" },
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
    sessionCursorId: null,
  });
  const create = deferred<CommandResponse>();
  const sent: Command[] = [];
  let submitting: Exclude<ShellState["dialog"], null> | null = null;
  const input = {
    value: "One item",
    model: fixture.model,
    state: fixture.state,
    snapshot: fixture.snapshot,
    getSubmittingDialog: () => submitting,
    setSubmittingDialog(dialogState: Exclude<ShellState["dialog"], null> | null) {
      submitting = dialogState;
    },
    dispatch() {},
    run: async (command: Command) => {
      sent.push(command);
      return (await create.promise).result;
    },
  };

  const first = submitCreate(input);
  await submitCreate(input);
  expect(sent).toEqual([
    { type: "item.create", projectId: "project-1", kind: "generic", title: "One item" },
  ]);

  create.resolve({ ok: true, revision: 5, result: { id: "item-2" } });
  await first;
});

test("creating an item expands its collapsed project before activation", async () => {
  const fixture = activeItemFixture();
  const dialog = {
    kind: "create" as const,
    createKind: "item" as const,
    returnFocus: { region: "navigator" as const },
  };
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "project:project-1",
    navigatorCursorKey: "project:project-1",
    dialog,
    focus: { region: "navigator" },
    expandedProjectIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
    sessionCursorId: null,
  });
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  let submitting: Exclude<ShellState["dialog"], null> | null = null;

  await submitCreate({
    value: "Visible item",
    model: fixture.model,
    state: fixture.state,
    snapshot: fixture.snapshot,
    getSubmittingDialog: () => submitting,
    setSubmittingDialog(dialogState) {
      submitting = dialogState;
    },
    dispatch(action) {
      actions.push(action);
    },
    run: async (command) => {
      sent.push(command);
      return { id: "item-2" };
    },
  });

  expect(sent).toEqual([
    { type: "item.create", projectId: "project-1", kind: "generic", title: "Visible item" },
  ]);
  expect(actions).toEqual([
    { type: "dialog.close" },
    { type: "project.toggle", projectId: "project-1" },
    { type: "navigator.activate", key: "item:item-2" },
  ]);
});

import { expect, test } from "bun:test";

import { ApiError, type Command, type CommandResponse } from "@work-craft/server/client";

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
import { snapshotFixture } from "@/tests/support/fixtures.ts";

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

for (const succeeds of [false, true]) {
  test(`workspace creation drills down only after success (${succeeds})`, async () => {
    const fixture = activeItemFixture();
    const actions: ShellAction[] = [];
    await submitCreate({
      value: "New workspace",
      model: fixture.model,
      state: {
        ...fixture.state,
        dialog: {
          kind: "create",
          createKind: "workspace",
          returnFocus: { region: "workspace" },
        },
      },
      snapshot: fixture.snapshot,
      getSubmittingDialog: () => null,
      setSubmittingDialog: () => {},
      dispatch: (action) => actions.push(action),
      onItemCreated: async () => {
        throw new Error("Workspace must not enter a terminal");
      },
      run: async () => (succeeds ? { id: "new-workspace", revision: 5 } : undefined),
    });
    expect(actions).toEqual(
      succeeds
        ? [
            { type: "dialog.close" },
            { type: "workspace.activate", id: "new-workspace" },
            { type: "focus.set", focus: { region: "category" } },
          ]
        : [],
    );
  });
}

function activeItemFixture(generic = false): {
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
  if (generic) {
    snapshot.items = snapshot.items.map((item) => ({
      ...item,
      category: "design",
      kind: "generic",
      data: {},
    }));
  }
  const state: ShellState = {
    ...createInitialShellState(),
    activeSessionId: "session-work",
    activeWorkspaceId: "workspace-shared",
    activeCategory: generic ? "design" : "implementation",
    activeNavigatorKey: "item:item-1",
    navigatorCursorKey: "item:item-1",
    tabCursorId: "tab-1",
    focus: { region: "workbench", paneId: "pane-1" },
    lastPaneByTab: { "tab-1": "pane-1" },
    expandedRootIds: new Set(["root-1"]),
  };
  return {
    snapshot,
    state,
    model: deriveShellModel({ snapshot, state }),
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
    setFocus(target) {
      actions.push({ type: "focus.set", focus: target });
    },
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
  expect(durableCommands.registerDirectory("workspace-1", "/work/Shell")).toEqual({
    type: "directory.register",
    workspaceId: "workspace-1",
    path: "/work/Shell",
  });
  expect(durableCommands.createItem("workspace-1", "design", "Extract commands", "root-1")).toEqual(
    {
      type: "item.create",
      workspaceId: "workspace-1",
      category: "design",
      parentId: "root-1",
      title: "Extract commands",
    },
  );
});

test("Archive pins the unavailable candidate without opening or mutating it", async () => {
  const f = activeItemFixture();
  const candidate = f.snapshot.items.find((item) => item.id === "item-1")!;
  if (candidate.kind !== "generic") {
    candidate.data.availability = "unavailable";
  }
  const actions: ShellAction[] = [];
  let sent = false;
  await executeCommand(
    executionInput(
      "item.archive",
      f,
      actions,
      async () => {
        sent = true;
        return undefined;
      },
      { focus: { region: "navigator" } },
    ),
  );
  expect(actions).toEqual([
    expect.objectContaining({
      type: "dialog.open",
      dialog: expect.objectContaining({
        kind: "archive",
        itemId: "item-1",
        title: f.snapshot.items.find((item) => item.id === "item-1")!.title,
      }),
    }),
  ]);
  expect(sent).toBe(false);
});

test("server field validation is inline while operational failures keep source identity and epoch", async () => {
  const expected: CompletionContext = {
    navigationKey: "current",
    dialog: { kind: "create", createKind: "directory", returnFocus: { region: "navigator" } },
  };
  for (const cause of [new ApiError("Bad path", "path"), new Error("Permission denied")]) {
    const actions: ShellAction[] = [];
    await runDurableCommand({
      command: { type: "directory.register", workspaceId: "w", path: "/path" },
      region: "navigator",
      expected,
      current: () => expected,
      send: async () => {
        throw cause;
      },
      dispatch: (action) => actions.push(action),
      source: {
        key: "form:register",
        label: "Register",
        epoch: "epoch",
        requestId: 1,
        isCurrent: () => true,
      },
    });
    expect(actions).toEqual([
      cause instanceof ApiError
        ? { type: "field.error", message: "Bad path" }
        : expect.objectContaining({
            type: "source.report",
            error: expect.objectContaining({
              epoch: "epoch",
              sourceKey: "form:register",
              message: "Permission denied",
              origin: "direct",
            }),
          }),
    ]);
  }
});

test("constructs surface and tab commands", () => {
  expect(durableCommands.openItem("item-1")).toEqual({
    type: "surface.ensure",
    itemId: "item-1",
  });
  expect(durableCommands.openItem("root-1")).toEqual({
    type: "surface.ensure",
    itemId: "root-1",
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

for (const focus of [
  { region: "workbench", paneId: "pane-1" },
  { region: "tabs" },
  { region: "navigator" },
] as const) {
  for (const succeeds of [true, false]) {
    test(`local tab intent starts before selection only from ${focus.region} (success=${succeeds})`, async () => {
      const f = activeItemFixture();
      f.snapshot.tabs.push({ ...f.snapshot.tabs[0]!, id: "tab-2", position: 1 });
      f.model = deriveShellModel(f);
      const events: unknown[] = [];
      await executeCommand(
        executionInput(
          "tab.next",
          f,
          [],
          async (command) => {
            events.push(command);
            return succeeds ? { id: "tab-2", revision: 7 } : undefined;
          },
          {
            focus,
            onTabSelectionStarted: (tabId: string) => {
              events.push(["start", tabId]);
              return (revision: number) => {
                events.push(["complete", revision]);
              };
            },
          },
        ),
      );
      expect(events).toEqual([
        ...(focus.region === "workbench" ? [["start", "tab-2"]] : []),
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        ...(focus.region === "workbench" && succeeds ? [["complete", 7]] : []),
      ]);
    });
  }
}

for (const result of [
  undefined,
  { id: "created", revision: 7, tabId: "created" },
  { id: "created", revision: 7, tabId: "created", paneId: "created-pane" },
]) {
  test(`tab creation captures before one RPC and completes only exact returned IDs (pane=${result?.paneId})`, async () => {
    const f = activeItemFixture();
    const events: unknown[] = [];
    await executeCommand(
      executionInput(
        "tab.create",
        f,
        [],
        async (command, region, expected) => {
          events.push(command);
          expect(region).toBe("tabs");
          expect(expected).toEqual({ navigationKey: f.model.navigationKey, dialog: null });
          return result;
        },
        {
          onTabCreateStarted: () => {
            events.push("start");
            return (tabId, paneId, revision) => events.push([tabId, paneId, revision]);
          },
          setFocus: () => {
            throw new Error("Creation must wait for native readiness");
          },
        },
      ),
    );
    expect(events).toEqual([
      "start",
      { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
      ...(result?.paneId ? [["created", "created-pane", 7]] : []),
    ]);
  });
}

test("tab boundary does not start an entry or send a command", async () => {
  const f = activeItemFixture();
  const events: unknown[] = [];
  await executeCommand(
    executionInput(
      "tab.previous",
      f,
      [],
      async (command) => {
        events.push(command);
        return undefined;
      },
      {
        onTabSelectionStarted: () => {
          events.push("start");
          return () => {};
        },
      },
    ),
  );
  expect(events).toEqual([]);
});

for (const succeeds of [true, false]) {
  test(`explicit restart reports exact pane and revision only on success (${succeeds})`, async () => {
    const f = activeItemFixture();
    const events: unknown[] = [];
    await executeCommand(
      executionInput(
        "pane.restart",
        f,
        [],
        async (command) => {
          events.push(command);
          return succeeds ? { id: "pane-1", revision: 7 } : undefined;
        },
        { onPaneRestarted: (paneId: string, revision: number) => events.push([paneId, revision]) },
      ),
    );
    expect(events).toEqual([
      { type: "process.restart", paneId: "pane-1" },
      ...(succeeds ? [["pane-1", 7]] : []),
    ]);
  });
}

test("work-item submission delegates exact identity, parent and revision without owning entry", async () => {
  for (const createKind of ["directory", "generic-root", "generic-child"] as const) {
    const fixture = activeItemFixture(createKind !== "directory");
    fixture.state = {
      ...fixture.state,
      dialog: { kind: "create", createKind, returnFocus: { region: "navigator" } },
    };
    const sent: Command[] = [];
    const actions: ShellAction[] = [];
    const created: unknown[] = [];
    await submitCreate({
      ...fixture,
      value: createKind === "directory" ? "." : "New root",
      getSubmittingDialog: () => null,
      setSubmittingDialog() {},
      onItemCreated: async (...args) => {
        created.push(args);
      },
      dispatch: (action) => {
        actions.push(action);
      },
      run: async (command) => {
        sent.push(command);
        return { id: "requested", itemId: "requested", rootItemId: "root-1", revision: 7 };
      },
    });
    expect(sent).toEqual([
      createKind === "directory"
        ? { type: "directory.register", workspaceId: "workspace-shared", path: process.cwd() }
        : {
            type: "item.create",
            workspaceId: "workspace-shared",
            category: "design",
            title: "New root",
            ...(createKind === "generic-child" ? { parentId: "root-1" } : {}),
          },
    ]);
    expect(actions).toEqual([]);
    expect(created).toEqual([["requested", createKind === "generic-root" ? null : "root-1", 7]]);
  }
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
      "navigator.dismiss",
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
    ]),
  );
});

test("splitting completes its captured entry intent with the returned pane and revision", async () => {
  const fixture = activeItemFixture();
  let captured = false;
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
        expect(captured).toBe(true);
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

  const entries: { paneId: string; revision: number }[] = [];
  await executeCommand(
    executionInput("pane.splitHorizontal", fixture, actions, run, {
      onPaneSplitStarted: () => {
        captured = true;
        return (paneId, revision) => entries.push({ paneId, revision });
      },
      setFocus: () => {
        throw new Error("Split must wait for native readiness");
      },
    }),
  );

  expect(sent).toEqual([{ type: "pane.split", paneId: "pane-1", direction: "horizontal" }]);
  expect(entries).toEqual([{ paneId: "pane-2", revision: 5 }]);
});

test("spatial movement synchronously requests the next native target", async () => {
  const fixture = activeItemFixture();
  const actions: ShellAction[] = [];
  const focusRequests: ExecuteCommandInput["focus"][] = [];
  await executeCommand(
    executionInput("focus.right", fixture, actions, async () => undefined, {
      focus: { region: "navigator" },
      focusNodes: [
        { target: { region: "navigator" }, rect: { x: 0, y: 0, width: 20, height: 20 } },
        {
          target: { region: "workbench", paneId: "pane-1" },
          rect: { x: 20, y: 0, width: 40, height: 20 },
        },
      ],
      setFocus(target) {
        focusRequests.push(target);
      },
    }),
  );
  expect(focusRequests).toEqual([{ region: "workbench", paneId: "pane-1" }]);
  expect(actions).toEqual([]);
});

for (const entry of ["origin", "remembered", "destination"] as const) {
  test(`spatial ${entry} navigation excludes unusable destinations without losing the origin`, async () => {
    const fixture = activeItemFixture();
    fixture.snapshot.panes[0]!.processStatus = "running";
    fixture.snapshot.panes.push({ ...fixture.snapshot.panes[0]!, id: "pane-2" });
    fixture.snapshot.tabs[0]!.layout = {
      type: "split",
      direction: "vertical",
      ratio: 0.25,
      first: { type: "pane", paneId: "pane-1" },
      second: { type: "pane", paneId: "pane-2" },
    };
    fixture.model = deriveShellModel(fixture);
    const actions: ShellAction[] = [];
    await executeCommand(
      executionInput(
        entry === "origin" ? "focus.right" : entry === "remembered" ? "focus.down" : "focus.left",
        fixture,
        actions,
        async () => undefined,
        {
          focus:
            entry === "remembered"
              ? { region: "tabs" }
              : { region: "workbench", paneId: entry === "origin" ? "pane-1" : "pane-2" },
          focusNodes: [
            { target: { region: "category" }, rect: { x: 0, y: 1, width: 5, height: 38 } },
            { target: { region: "tabs" }, rect: { x: 5, y: 1, width: 75, height: 1 } },
            {
              target: { region: "workbench", paneId: "pane-1" },
              rect: { x: 6, y: 3, width: 18, height: 35 },
            },
            {
              target: { region: "workbench", paneId: "pane-2" },
              rect: { x: 25, y: 3, width: 54, height: 35 },
            },
          ],
        },
      ),
    );
    expect(actions).toEqual([
      {
        type: "focus.set",
        focus:
          entry === "destination"
            ? { region: "category" }
            : { region: "workbench", paneId: "pane-2" },
      },
    ]);
  });
}

test("item creation availability uses the supplied native focus instead of stale state focus", () => {
  const fixture = activeItemFixture(true);
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "root:root-1",
    navigatorCursorKey: "root:root-1",
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
  });
  expect(
    availableCommands({ ...fixture, focus: { region: "navigator" }, focusedPaneId: null }).has(
      "item.create",
    ),
  ).toBe(true);
});

test("item submission uses the captured native launch context when semantic focus was stale", async () => {
  const fixture = activeItemFixture(true);
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "root:root-1",
    navigatorCursorKey: "root:root-1",
    dialog: { kind: "create", createKind: "generic-child", returnFocus: { region: "navigator" } },
  };
  const sent: Command[] = [];
  await submitCreate({
    ...fixture,
    value: "Native context item",
    getSubmittingDialog: () => null,
    setSubmittingDialog() {},
    dispatch() {},
    onItemCreated: async () => {},
    run: async (command) => {
      sent.push(command);
      return { id: "item-2", revision: 5 };
    },
  });
  expect(sent).toEqual([
    {
      type: "item.create",
      workspaceId: "workspace-shared",
      category: "design",
      parentId: "root-1",
      title: "Native context item",
    },
  ]);
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
    activeNavigatorKey: "root:root-1",
    navigatorCursorKey: "root:root-1",
    focus: { region: "navigator" },
    expandedRootIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
  });
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  const run: ExecuteCommandInput["run"] = async (command) => {
    sent.push(command);
    return { id: "surface-1", itemId: "item-1", revision: 1 };
  };

  await executeCommand(
    executionInput("cursor.activate", fixture, actions, run, {
      focus: { region: "navigator" },
      focusedPaneId: null,
    }),
  );

  expect(sent).toEqual([{ type: "surface.ensure", itemId: "root-1" }]);
  expect(actions).toEqual([{ type: "navigator.activate", key: "root:root-1" }]);
});

test("a late root-open response cannot activate an item behind a dialog", async () => {
  const fixture = activeItemFixture();
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "root:root-1",
    navigatorCursorKey: "root:root-1",
    focus: { region: "navigator" },
    expandedRootIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
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
    executionInput("cursor.activate", fixture, actions, run, {
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

  expect(sent).toEqual([{ type: "surface.ensure", itemId: "root-1" }]);
  expect(actions).toEqual([{ type: "navigator.activate", key: "root:root-1" }]);
});

test("a late create response cannot activate an item after cancelling its dialog", async () => {
  const fixture = activeItemFixture(true);
  const dialog = {
    kind: "create" as const,
    createKind: "generic-child" as const,
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
    onItemCreated: async () => {
      throw new Error("Cancelled creation must not enter");
    },
  });
  current = { ...current, dialog: null };
  create.resolve({ ok: true, revision: 5, result: { id: "item-2" } });
  await pending;

  expect(sent).toEqual([
    {
      type: "item.create",
      workspaceId: "workspace-shared",
      category: "design",
      parentId: "root-1",
      title: "Late item",
    },
  ]);
  expect(actions).toEqual([]);
  expect(submitting).toBeNull();
});

test("a create prompt submits only once while its command is pending", async () => {
  const fixture = activeItemFixture(true);
  const dialog = {
    kind: "create" as const,
    createKind: "generic-child" as const,
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
    onItemCreated: async () => {},
    run: async (command: Command) => {
      sent.push(command);
      const response = await create.promise;
      return { ...response.result, revision: response.revision };
    },
  };

  const first = submitCreate(input);
  await submitCreate(input);
  expect(sent).toEqual([
    {
      type: "item.create",
      workspaceId: "workspace-shared",
      category: "design",
      parentId: "root-1",
      title: "One item",
    },
  ]);

  create.resolve({ ok: true, revision: 5, result: { id: "item-2" } });
  await first;
});

test("creating a child delegates its parent to the shell without closing or expanding the form", async () => {
  const fixture = activeItemFixture(true);
  const dialog = {
    kind: "create" as const,
    createKind: "generic-child" as const,
    returnFocus: { region: "navigator" as const },
  };
  fixture.state = {
    ...fixture.state,
    activeNavigatorKey: "root:root-1",
    navigatorCursorKey: "root:root-1",
    dialog,
    focus: { region: "navigator" },
    expandedRootIds: new Set(),
  };
  fixture.model = deriveShellModel({
    snapshot: fixture.snapshot,
    state: fixture.state,
  });
  const actions: ShellAction[] = [];
  const sent: Command[] = [];
  const created: unknown[] = [];
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
    onItemCreated: async (...args) => {
      created.push(args);
    },
    run: async (command) => {
      sent.push(command);
      return { id: "item-2", revision: 5 };
    },
  });

  expect(sent).toEqual([
    {
      type: "item.create",
      workspaceId: "workspace-shared",
      category: "design",
      parentId: "root-1",
      title: "Visible item",
    },
  ]);
  expect(actions).toEqual([]);
  expect(created).toEqual([["item-2", "root-1", 5]]);
});

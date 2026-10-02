import type { CategoryKind, Command, CommandResponse, Snapshot } from "@work-craft/server/client";

import type { CommandId } from "@/input/command-router.ts";
import { type FocusNode, type FocusTarget, moveFocus } from "@/input/focus.ts";
import { type CreateKind, projectIdForShellContext, type ShellModel } from "@/shell/model.ts";
import type { DialogState, ShellAction, ShellRegion, ShellState } from "@/shell/state.ts";

export const durableCommands = {
  createSession: (name: string): Command => ({ type: "session.create", name }),
  createWorkspace: (sessionId: string, name: string): Command => ({
    type: "workspace.create",
    sessionId,
    name,
  }),
  createProject: (workspaceId: string, category: CategoryKind, name: string): Command => ({
    type: "project.create",
    workspaceId,
    category,
    name,
  }),
  createItem: (projectId: string, title: string): Command => ({
    type: "item.create",
    projectId,
    kind: "generic",
    title,
  }),
  openItem: (itemId: string): Command => ({ type: "surface.ensure", itemId }),
  openProject: (projectId: string): Command => ({ type: "surface.ensureHere", projectId }),
  createTab: (surfaceId: string): Command => ({ type: "tab.create", surfaceId, title: "Shell" }),
  selectTab: (surfaceId: string, tabId: string): Command => ({
    type: "surface.selectTab",
    surfaceId,
    tabId,
  }),
  splitHorizontal: (paneId: string): Command => ({
    type: "pane.split",
    paneId,
    direction: "horizontal",
  }),
  splitVertical: (paneId: string): Command => ({
    type: "pane.split",
    paneId,
    direction: "vertical",
  }),
  restartPane: (paneId: string): Command => ({ type: "process.restart", paneId }),
};

export type CompletionContext = {
  key?: string;
  navigationKey: string;
  dialog: DialogState;
};

/** Retains the response revision so split focus can wait for a lagging snapshot. */
export type DurableCommandResult = CommandResponse["result"] & Pick<CommandResponse, "revision">;

export type CommandAvailabilityInput = {
  model: ShellModel;
  state: ShellState;
  snapshot: Snapshot | null;
  focus: FocusTarget;
  focusedPaneId: string | null;
};

export type RunDurableCommandInput = {
  command: Command;
  region: ShellRegion;
  expected: CompletionContext;
  current(): CompletionContext;
  send(command: Command): Promise<CommandResponse>;
  dispatch(action: ShellAction): void;
};

export type ExecuteCommandInput = {
  command: CommandId;
  model: ShellModel;
  state: ShellState;
  snapshot: Snapshot | null;
  focus: FocusTarget;
  focusedPaneId: string | null;
  focusNodes: readonly FocusNode[];
  terminalWidth: number;
  dispatch(action: ShellAction): void;
  setFocus(target: FocusTarget, pending?: NonNullable<ShellState["pendingWorkbenchFocus"]>): void;
  setSessionCursorId(id: string | null): void;
  run(
    command: Command,
    region: ShellRegion,
    expected?: CompletionContext,
  ): Promise<DurableCommandResult | undefined>;
  reload(): Promise<void>;
  quit(): void;
};

export type SubmitCreateInput = {
  value: string;
  model: ShellModel;
  state: ShellState;
  snapshot: Snapshot | null;
  getSubmittingDialog(): Exclude<DialogState, null> | null;
  setSubmittingDialog(dialog: Exclude<DialogState, null> | null): void;
  dispatch(action: ShellAction): void;
  run(command: Command, region: ShellRegion): Promise<CommandResponse["result"] | undefined>;
};

export function completionContextFor(model: ShellModel, dialog: DialogState): CompletionContext {
  return { key: model.completionKey, navigationKey: model.navigationKey, dialog };
}

export function availableCommands({
  model,
  state,
  snapshot,
  focus,
  focusedPaneId,
}: CommandAvailabilityInput): ReadonlySet<CommandId> {
  const commands = new Set<CommandId>([
    "focus.left",
    "focus.down",
    "focus.up",
    "focus.right",
    "navigator.toggle",
    "session.open",
    "client.reload",
    "client.quit",
  ]);
  if (model.categoryIndex > 0) {
    commands.add("category.previous");
  }
  if (model.categoryIndex >= 0 && model.categoryIndex < model.categories.length - 1) {
    commands.add("category.next");
  }
  if (model.navigatorActiveIndex > 0) {
    commands.add("navigator.previous");
  }
  if (model.navigatorActiveIndex >= 0 && model.navigatorActiveIndex < model.entries.length - 1) {
    commands.add("navigator.next");
  }
  if (model.tabActiveIndex > 0) {
    commands.add("tab.previous");
  }
  if (model.tabActiveIndex >= 0 && model.tabActiveIndex < model.tabs.length - 1) {
    commands.add("tab.next");
  }
  if (model.surface !== undefined) {
    commands.add("tab.create");
  }
  if (focusedPaneId !== null) {
    commands.add("pane.splitHorizontal");
    commands.add("pane.splitVertical");
    const pane = snapshot?.panes.find(({ id }) => id === focusedPaneId);
    if (
      pane?.processStatus === "failed" ||
      pane?.processStatus === "exited" ||
      pane?.processStatus === "interrupted"
    ) {
      commands.add("pane.restart");
    }
  }
  if (snapshot !== null && projectIdForShellContext({ ...state, focus }, snapshot) !== undefined) {
    commands.add("item.create");
  }

  if (state.dialog?.kind === "sessions") {
    commands.add("context.create");
    if (state.activeSessionId !== null) {
      commands.add("dialog.cancel");
    }
  } else if (state.dialog?.kind === "create") {
    commands.add("dialog.cancel");
  } else if (focus.region === "workspace") {
    if (state.activeSessionId !== null) {
      commands.add("context.create");
    }
  } else if (focus.region === "session") {
    commands.add("context.create");
  } else if (focus.region === "navigator") {
    if (model.entries[model.navigatorCursorIndex]?.kind === "project") {
      commands.add("project.openTerminal");
    }
    if (state.activeWorkspaceId !== null) {
      commands.add("context.create");
    }
    commands.add("navigator.shrink");
    commands.add("navigator.grow");
  }

  return commands;
}

export async function runDurableCommand({
  command,
  region,
  expected,
  current,
  send,
  dispatch,
}: RunDurableCommandInput): Promise<DurableCommandResult | undefined> {
  const contextIsCurrent = () => {
    const latest = current();
    return (
      latest.navigationKey === expected.navigationKey &&
      (expected.key === undefined || latest.key === expected.key) &&
      latest.dialog === expected.dialog
    );
  };

  try {
    const response = await send(command);
    if (!contextIsCurrent()) {
      return undefined;
    }
    dispatch({ type: "error.set", region, error: null });
    return { ...response.result, revision: response.revision };
  } catch (cause) {
    if (!contextIsCurrent()) {
      return undefined;
    }
    dispatch({
      type: "error.set",
      region,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return undefined;
  }
}

function adjacent<T>(values: readonly T[], index: number, offset: -1 | 1): T | undefined {
  return index < 0 ? undefined : values[index + offset];
}

function navigationContextKey(
  snapshot: Snapshot | null,
  state: ShellState,
  navigatorKey: string | null,
): string {
  return JSON.stringify([
    snapshot?.epoch ?? null,
    state.activeSessionId,
    state.activeWorkspaceId,
    state.activeCategory,
    navigatorKey,
  ]);
}

function commandRegion(focus: FocusTarget): ShellRegion {
  return focus.region;
}

export async function executeCommand({
  command,
  model,
  state,
  snapshot,
  focus,
  focusedPaneId,
  focusNodes,
  terminalWidth,
  dispatch,
  setFocus,
  setSessionCursorId,
  run,
  reload,
  quit,
}: ExecuteCommandInput): Promise<void> {
  const reconcile = () => {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  };
  const activateNavigator = (entry: ShellModel["entries"][number] | undefined) => {
    if (entry === undefined) {
      return;
    }
    dispatch({ type: "navigator.activate", key: entry.key });
    if (entry.kind === "item") {
      void run(durableCommands.openItem(entry.id), "navigator", {
        navigationKey: navigationContextKey(snapshot, state, entry.key),
        dialog: state.dialog,
      });
    }
  };
  const openCreate = (createKind: CreateKind) => {
    dispatch({
      type: "dialog.open",
      dialog: { kind: "create", createKind, returnFocus: focus },
    });
  };
  const activateCursor = () => {
    if (focus.region === "workspace" && state.workspaceCursorId !== null) {
      dispatch({ type: "workspace.activate", id: state.workspaceCursorId });
      reconcile();
    } else if (focus.region === "category") {
      dispatch({ type: "category.activate", category: state.categoryCursor });
      reconcile();
    } else if (focus.region === "navigator") {
      activateNavigator(model.entries[model.navigatorCursorIndex]);
    } else if (focus.region === "tabs") {
      const tab = model.tabs[model.tabCursorIndex];
      if (model.surface !== undefined && tab !== undefined) {
        void run(durableCommands.selectTab(model.surface.id, tab.id), "tabs");
      }
    }
  };

  if (command.startsWith("focus.")) {
    const direction = command.slice(6) as "left" | "right" | "up" | "down";
    const next = moveFocus(focus, direction, focusNodes);
    const restored =
      focus.region !== "workbench" &&
      next.region === "workbench" &&
      state.lastWorkbenchPaneId !== null &&
      model.paneIds.includes(state.lastWorkbenchPaneId)
        ? { region: "workbench" as const, paneId: state.lastWorkbenchPaneId }
        : next;
    setFocus(restored);
    return;
  }

  switch (command) {
    case "category.previous":
    case "category.next": {
      const category = adjacent(
        model.categories,
        model.categoryIndex,
        command === "category.previous" ? -1 : 1,
      );
      if (category !== undefined) {
        dispatch({ type: "category.activate", category: category.kind });
        reconcile();
      }
      return;
    }
    case "navigator.previous":
    case "navigator.next":
      activateNavigator(
        adjacent(
          model.entries,
          model.navigatorActiveIndex,
          command === "navigator.previous" ? -1 : 1,
        ),
      );
      return;
    case "navigator.toggle":
      dispatch({ type: "navigator.toggle", hasWorkbench: model.paneIds.length > 0 });
      return;
    case "tab.previous":
    case "tab.next": {
      const tab = adjacent(model.tabs, model.tabActiveIndex, command === "tab.previous" ? -1 : 1);
      if (model.surface !== undefined && tab !== undefined) {
        dispatch({ type: "tab.cursor", id: tab.id });
        await run(durableCommands.selectTab(model.surface.id, tab.id), "tabs");
      }
      return;
    }
    case "tab.create":
      if (model.surface !== undefined) {
        await run(durableCommands.createTab(model.surface.id), "tabs");
      }
      return;
    case "session.open":
      setSessionCursorId(state.activeSessionId ?? model.sessions[0]?.id ?? null);
      dispatch({ type: "dialog.open", dialog: { kind: "sessions", returnFocus: focus } });
      return;
    case "client.reload":
      await reload();
      return;
    case "client.quit":
      quit();
      return;
    case "item.create":
      openCreate("item");
      return;
    case "pane.splitHorizontal":
    case "pane.splitVertical":
      if (focusedPaneId !== null) {
        const result = await run(
          command === "pane.splitHorizontal"
            ? durableCommands.splitHorizontal(focusedPaneId)
            : durableCommands.splitVertical(focusedPaneId),
          "workbench",
        );
        if (result?.paneId !== undefined) {
          setFocus(
            { region: "workbench", paneId: result.paneId },
            snapshot === null
              ? undefined
              : {
                  epoch: snapshot.epoch,
                  revision: result.revision,
                },
          );
        }
      }
      return;
    case "pane.restart":
      if (focusedPaneId !== null) {
        await run(durableCommands.restartPane(focusedPaneId), "workbench");
      }
      return;
    case "cursor.activate":
      activateCursor();
      return;
    case "context.create":
      openCreate(
        state.dialog?.kind === "sessions" || focus.region === "session"
          ? "session"
          : focus.region === "workspace"
            ? "workspace"
            : "project",
      );
      return;
    case "project.openTerminal": {
      const entry = model.entries[model.navigatorCursorIndex];
      if (entry?.kind === "project") {
        const result = await run(durableCommands.openProject(entry.id), "navigator");
        const itemId = result?.itemId ?? result?.id;
        if (itemId !== undefined) {
          if (!state.expandedProjectIds.has(entry.id)) {
            dispatch({ type: "project.toggle", projectId: entry.id });
          }
          dispatch({ type: "navigator.activate", key: `item:${itemId}` });
        }
      }
      return;
    }
    case "navigator.shrink":
    case "navigator.grow":
      dispatch({
        type: "navigator.resize",
        direction: command === "navigator.shrink" ? -1 : 1,
        terminalWidth,
      });
      return;
    case "dialog.cancel":
      dispatch({ type: "dialog.close" });
      return;
  }
}

export async function submitCreate({
  value,
  state,
  snapshot,
  getSubmittingDialog,
  setSubmittingDialog,
  dispatch,
  run,
}: SubmitCreateInput): Promise<void> {
  if (
    snapshot === null ||
    state.dialog?.kind !== "create" ||
    getSubmittingDialog() === state.dialog
  ) {
    return;
  }
  const dialog = state.dialog;
  const { createKind, returnFocus } = dialog;
  let command: Command | undefined;
  let projectId: string | undefined;
  if (createKind === "session") {
    command = durableCommands.createSession(value);
  } else if (createKind === "workspace" && state.activeSessionId !== null) {
    command = durableCommands.createWorkspace(state.activeSessionId, value);
  } else if (createKind === "project" && state.activeWorkspaceId !== null) {
    command = durableCommands.createProject(state.activeWorkspaceId, state.activeCategory, value);
  } else {
    projectId = projectIdForShellContext({ ...state, focus: returnFocus }, snapshot);
    if (projectId !== undefined) {
      command = durableCommands.createItem(projectId, value);
    }
  }
  if (command === undefined) {
    return;
  }
  setSubmittingDialog(dialog);
  const result = await run(command, commandRegion(returnFocus));
  if (getSubmittingDialog() === dialog) {
    setSubmittingDialog(null);
  }
  const id = result?.itemId ?? result?.id;
  if (id === undefined) {
    return;
  }
  dispatch({ type: "dialog.close" });
  if (createKind === "session") {
    dispatch({ type: "session.activate", id });
  } else if (createKind === "workspace") {
    dispatch({ type: "workspace.activate", id });
  } else if (createKind === "project") {
    dispatch({ type: "navigator.activate", key: `project:${id}` });
  } else {
    if (projectId !== undefined && !state.expandedProjectIds.has(projectId)) {
      dispatch({ type: "project.toggle", projectId });
    }
    dispatch({ type: "navigator.activate", key: `item:${id}` });
  }
}

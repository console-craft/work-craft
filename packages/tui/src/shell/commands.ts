import {
  ApiError,
  type CategoryKind,
  type Command,
  type CommandResponse,
  resolveClientPath,
  type Snapshot,
} from "@work-craft/server/client";

import type { CommandId } from "@/input/command-router.ts";
import { focusKey, type FocusNode, type FocusTarget, moveFocus } from "@/input/focus.ts";
import { navigationContextKey } from "@/shell/context";
import { OPERATIONAL_ERROR_DURATION } from "@/shell/errors";
import { type CreateKind, genericRootIdForShellContext, type ShellModel } from "@/shell/model.ts";
import type { DialogState, ShellAction, ShellRegion, ShellState } from "@/shell/state.ts";
import { hasTerminalViewport } from "@/workbench/layout";

export const durableCommands = {
  createSession: (name: string): Command => ({ type: "session.create", name }),
  createWorkspace: (sessionId: string, name: string): Command => ({
    type: "workspace.create",
    sessionId,
    name,
  }),
  registerDirectory: (workspaceId: string, path: string): Command => ({
    type: "directory.register",
    workspaceId,
    path: resolveClientPath(path),
  }),
  createItem: (
    workspaceId: string,
    category: CategoryKind,
    title: string,
    parentId?: string,
  ): Command => ({
    type: "item.create",
    workspaceId,
    category,
    ...(parentId === undefined ? {} : { parentId }),
    title,
  }),
  openItem: (itemId: string): Command => ({ type: "surface.ensure", itemId }),
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

/** Retains the response revision for guarded native terminal entry. */
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
  source?: { key: string; label: string; requestId: number; epoch?: string; isCurrent(): boolean };
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
  setFocus(target: FocusTarget): void;
  /** Local activation may enter the opened item after its response revision is rendered. */
  onItemOpened?(itemId: string, revision: number): void;
  /** Capture terminal-source intent before tab selection can project focus onto tabs. */
  onTabSelectionStarted?(tabId: string): (revision: number) => void;
  /** Creation enters its exact returned terminal, including from control origins. */
  onTabCreateStarted?(): (tabId: string, paneId: string, revision: number) => void;
  /** Explicit recovery can enter only the pane and response revision it restarted. */
  onPaneRestarted?(paneId: string, revision: number): void;
  /** Capture split intent before its response or destination can arrive. */
  onPaneSplitStarted?(): (paneId: string, revision: number) => void;
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
  run: ExecuteCommandInput["run"];
  onItemCreated(itemId: string, parentId: string | null, revision: number): Promise<void>;
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
    "navigator.dismiss",
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
  if (
    snapshot !== null &&
    genericRootIdForShellContext({ ...state, focus }, snapshot) !== undefined
  ) {
    commands.add("item.create");
  }

  if (state.dialog?.kind === "sessions") {
    commands.add("context.create");
    if (state.activeSessionId !== null) {
      commands.add("dialog.cancel");
    }
  } else if (state.dialog !== null) {
    commands.add("dialog.cancel");
  } else if (focus.region === "workspace") {
    if (state.activeSessionId !== null) {
      commands.add("context.create");
    }
  } else if (focus.region === "session") {
    commands.add("context.create");
  } else if (focus.region === "navigator") {
    const candidate = snapshot?.items.find((item) => item.id === model.cursorEntry?.id);
    if (
      candidate &&
      candidate.kind !== "generic" &&
      !candidate.archived &&
      candidate.data.availability === "unavailable"
    ) {
      commands.add("item.archive");
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
  source,
}: RunDurableCommandInput): Promise<DurableCommandResult | undefined> {
  const contextIsCurrent = () => {
    const latest = current();
    return (
      (source?.isCurrent() ?? true) &&
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
    if (source) {
      dispatch({ type: "source.clear", sourceKey: source.key, requestId: source.requestId });
    }
    return { ...response.result, revision: response.revision };
  } catch (cause) {
    if (!contextIsCurrent()) {
      return undefined;
    }
    const field =
      expected.dialog?.kind === "create"
        ? expected.dialog.createKind === "directory"
          ? "path"
          : expected.dialog.createKind.startsWith("generic-")
            ? "title"
            : "name"
        : null;
    if (cause instanceof ApiError && cause.field === field) {
      dispatch({ type: "field.error", message: cause.message });
    } else {
      const now = Date.now();
      dispatch({
        type: "source.report",
        now,
        error: {
          sourceKey: source?.key ?? region,
          sourceLabel: source?.label ?? region,
          requestId: source?.requestId ?? 0,
          epoch: source?.epoch ?? "",
          contextKey: expected.navigationKey,
          operation: command.type,
          message: cause instanceof Error ? cause.message : String(cause),
          expiresAt: now + OPERATIONAL_ERROR_DURATION,
          origin: "direct",
        },
      });
    }
    return undefined;
  }
}

function adjacent<T>(values: readonly T[], index: number, offset: -1 | 1): T | undefined {
  return index < 0 ? undefined : values[index + offset];
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
  onItemOpened,
  onTabSelectionStarted,
  onTabCreateStarted,
  onPaneRestarted,
  onPaneSplitStarted,
  run,
  reload,
  quit,
}: ExecuteCommandInput): Promise<void> {
  const reconcile = () => {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  };
  const activateNavigator = async (
    entry: ShellModel["entries"][number] | undefined,
    onOpened?: ExecuteCommandInput["onItemOpened"],
  ) => {
    if (entry === undefined) {
      return;
    }
    dispatch({ type: "navigator.activate", key: entry.key });
    {
      const result = await run(durableCommands.openItem(entry.id), "navigator", {
        navigationKey: navigationContextKey(snapshot?.epoch ?? null, state, entry.key),
        dialog: state.dialog,
      });
      if (result !== undefined) {
        onOpened?.(entry.id, result.revision);
      }
    }
  };
  const openCreate = (createKind: CreateKind) => {
    dispatch({
      type: "dialog.open",
      dialog: { kind: "create", createKind, returnFocus: focus },
    });
  };
  const activateCursor = async () => {
    if (focus.region === "navigator") {
      await activateNavigator(model.entries[model.navigatorCursorIndex], onItemOpened);
    } else if (focus.region === "tabs") {
      const tab = model.tabs[model.tabCursorIndex];
      if (model.surface !== undefined && tab !== undefined) {
        void run(durableCommands.selectTab(model.surface.id, tab.id), "tabs");
      }
    }
  };

  if (command.startsWith("focus.")) {
    const direction = command.slice(6) as "left" | "right" | "up" | "down";
    const stoppedSelection =
      focus.region === "tabs" &&
      focusedPaneId !== null &&
      snapshot?.panes.some(
        (pane) =>
          pane.id === focusedPaneId &&
          ["exited", "failed", "interrupted"].includes(pane.processStatus),
      );
    const origin = stoppedSelection
      ? (focusNodes.find(
          ({ target }) =>
            target.region === "workbench" &&
            target.paneId === focusedPaneId &&
            target.control === "reactivate",
        )?.target ?? { region: "workbench" as const, paneId: focusedPaneId! })
      : focus;
    const eligibleNodes = focusNodes.filter(
      ({ target, rect }) =>
        target.region !== "workbench" ||
        target.control === "reactivate" ||
        (hasTerminalViewport(rect) &&
          !focusNodes.some(
            (node) =>
              node.target.region === "workbench" &&
              node.target.paneId === target.paneId &&
              node.target.control === "reactivate",
          )),
    );
    const originNode = focusNodes.find(({ target }) => focusKey(target) === focusKey(origin));
    // A shrunken leaf remains a movement origin, never an eligible destination.
    const movementNodes =
      originNode && !eligibleNodes.includes(originNode)
        ? [...eligibleNodes, originNode]
        : eligibleNodes;
    let next = moveFocus(
      origin.region === "navigator" ? { region: "navigator" } : origin,
      direction,
      movementNodes,
    );
    if (stoppedSelection && next.region !== "workbench") {
      next = moveFocus(focus, direction, eligibleNodes);
    }
    const rememberedPaneId = state.lastPaneByTab[model.activeTab?.id ?? ""];
    const rememberedTarget = eligibleNodes.find(
      ({ target }) => target.region === "workbench" && target.paneId === rememberedPaneId,
    )?.target;
    const restored =
      origin.region !== "workbench" &&
      next.region === "workbench" &&
      rememberedPaneId !== undefined &&
      model.paneIds.includes(rememberedPaneId) &&
      rememberedTarget
        ? rememberedTarget
        : next;
    setFocus(restored);
    return;
  }

  switch (command) {
    case "item.archive": {
      const item = snapshot?.items.find((item) => item.id === model.cursorEntry?.id);
      if (
        item &&
        item.kind !== "generic" &&
        !item.archived &&
        item.data.availability === "unavailable"
      ) {
        dispatch({
          type: "dialog.open",
          dialog: {
            kind: "archive",
            itemId: item.id,
            title: item.title,
            path: item.data.path,
            returnFocus: focus,
          },
        });
      }
      return;
    }
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
      await activateNavigator(
        adjacent(
          model.entries,
          model.navigatorActiveIndex,
          command === "navigator.previous" ? -1 : 1,
        ),
      );
      return;
    case "navigator.toggle":
    case "navigator.dismiss":
      dispatch({ type: "navigator.toggle", hasWorkbench: model.paneIds.length > 0 });
      return;
    case "tab.previous":
    case "tab.next": {
      const tab = adjacent(model.tabs, model.tabActiveIndex, command === "tab.previous" ? -1 : 1);
      if (model.surface !== undefined && tab !== undefined) {
        const complete =
          focus.region === "workbench" && !focus.control
            ? onTabSelectionStarted?.(tab.id)
            : undefined;
        dispatch({ type: "tab.cursor", id: tab.id });
        const result = await run(durableCommands.selectTab(model.surface.id, tab.id), "tabs", {
          navigationKey: model.navigationKey,
          dialog: state.dialog,
        });
        if (result !== undefined) {
          complete?.(result.revision);
        }
      }
      return;
    }
    case "tab.create":
      if (model.surface !== undefined) {
        const complete = onTabCreateStarted?.();
        const result = await run(durableCommands.createTab(model.surface.id), "tabs", {
          navigationKey: model.navigationKey,
          dialog: state.dialog,
        });
        if (result?.tabId !== undefined && result.paneId !== undefined) {
          complete?.(result.tabId, result.paneId, result.revision);
        }
      }
      return;
    case "session.open":
      dispatch({ type: "dialog.open", dialog: { kind: "sessions", returnFocus: focus } });
      return;
    case "client.reload":
      await reload();
      return;
    case "client.quit":
      quit();
      return;
    case "item.create":
      openCreate("generic-child");
      return;
    case "pane.splitHorizontal":
    case "pane.splitVertical":
      if (focusedPaneId !== null) {
        const complete = onPaneSplitStarted?.();
        const result = await run(
          command === "pane.splitHorizontal"
            ? durableCommands.splitHorizontal(focusedPaneId)
            : durableCommands.splitVertical(focusedPaneId),
          "workbench",
        );
        if (result?.paneId !== undefined) {
          complete?.(result.paneId, result.revision);
        }
      }
      return;
    case "pane.restart":
      if (focusedPaneId !== null) {
        const result = await run(durableCommands.restartPane(focusedPaneId), "workbench");
        if (result !== undefined) {
          onPaneRestarted?.(focusedPaneId, result.revision);
        }
      }
      return;
    case "cursor.activate":
      await activateCursor();
      return;
    case "context.create":
      openCreate(
        state.dialog?.kind === "sessions" || focus.region === "session"
          ? "session"
          : focus.region === "workspace"
            ? "workspace"
            : state.activeCategory === "implementation"
              ? "directory"
              : "generic-root",
      );
      return;
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
  onItemCreated,
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
  let rootId: string | undefined;
  if (createKind === "session") {
    command = durableCommands.createSession(value);
  } else if (createKind === "workspace" && state.activeSessionId !== null) {
    command = durableCommands.createWorkspace(state.activeSessionId, value);
  } else if (createKind === "directory" && state.activeWorkspaceId !== null) {
    try {
      command = durableCommands.registerDirectory(state.activeWorkspaceId, value);
    } catch (error) {
      dispatch({
        type: "field.error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  } else if (
    createKind === "generic-root" &&
    state.activeWorkspaceId !== null &&
    state.activeCategory !== "implementation"
  ) {
    command = durableCommands.createItem(state.activeWorkspaceId, state.activeCategory, value);
  } else if (createKind === "generic-child" && state.activeWorkspaceId !== null) {
    rootId = genericRootIdForShellContext({ ...state, focus: returnFocus }, snapshot);
    if (rootId !== undefined) {
      command = durableCommands.createItem(
        state.activeWorkspaceId,
        state.activeCategory,
        value,
        rootId,
      );
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
  if (id === undefined || result === undefined) {
    return;
  }
  if (createKind === "session") {
    dispatch({ type: "dialog.close" });
    dispatch({ type: "session.activate", id });
  } else if (createKind === "workspace") {
    dispatch({ type: "dialog.close" });
    dispatch({ type: "workspace.activate", id });
    dispatch({ type: "focus.set", focus: { region: "category" } });
  } else {
    const parentId =
      createKind === "directory"
        ? result.rootItemId === id
          ? null
          : (result.rootItemId ?? null)
        : (rootId ?? null);
    await onItemCreated(id, parentId, result.revision);
  }
}

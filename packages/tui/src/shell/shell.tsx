import type { EmbeddedTerminalRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { CategoryKind, Command, CommandResponse } from "@work-craft/server/client";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Box } from "@/components/ui/box";
import {
  commandHints,
  initialRouterState,
  routeKey,
  type CommandContext,
  type CommandId,
  type KeyLike,
} from "../input/command-router.ts";
import { moveFocus, type FocusTarget } from "../input/focus.ts";
import type { NavigatorEntry } from "../navigation/model.ts";
import { CategoryRail } from "../navigation/category-rail.tsx";
import { Navigator } from "../navigation/navigator.tsx";
import { calculateShellLayout } from "./layout.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { DialogOverlay } from "./dialog-overlay.tsx";
import { Header } from "./header.tsx";
import { StatusBar, statusModeFor, type StatusBarProps } from "./status-bar.tsx";
import {
  createInitialShellState,
  reduceShellState,
  type DialogState,
  type ShellRegion,
} from "./state.ts";
import type { WorkCraftState } from "../client/use-work-craft.ts";
import {
  deriveShellModel,
  projectIdForShellContext,
  resolveShellFocus,
  type CreateKind,
} from "./model.ts";

const durableCommands = {
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

export type WorkCraftShellProps = { workCraft: WorkCraftState };

type CompletionContext = {
  key?: string;
  navigationKey: string;
  dialog: DialogState;
};

function adjacent<T>(values: readonly T[], index: number, offset: -1 | 1): T | undefined {
  return index < 0 ? undefined : values[index + offset];
}

function commandRegion(focus: FocusTarget): ShellRegion {
  return focus.region;
}

export function WorkCraftShell({ workCraft }: WorkCraftShellProps): ReactNode {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(reduceShellState, undefined, createInitialShellState);
  const [routerState, setRouterState] = useState(initialRouterState);
  const [sessionCursorId, setSessionCursorId] = useState<string | null>(null);
  const terminalRefs = useRef(new Map<string, EmbeddedTerminalRenderable>());
  const completionContextRef = useRef<CompletionContext>({
    key: "",
    navigationKey: "",
    dialog: null,
  });
  const submittingDialogRef = useRef<Exclude<DialogState, null> | null>(null);
  const snapshot = workCraft.snapshot;

  useEffect(() => {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  }, [snapshot]);

  useEffect(() => {
    if (routerState.invalidMessageUntil === null) {
      return;
    }
    const delay = Math.max(0, routerState.invalidMessageUntil - Date.now());
    const timeout = setTimeout(() => {
      setRouterState((current) =>
        current.invalidMessageUntil === routerState.invalidMessageUntil
          ? { ...current, invalidMessage: null, invalidMessageUntil: null }
          : current,
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, [routerState.invalidMessageUntil]);

  const model = deriveShellModel({ snapshot, state, sessionCursorId });
  const {
    activeCategoryTitle,
    activeSession,
    activeTab,
    categories: renderedCategories,
    categoryCursorIndex,
    categoryIndex,
    cursorEntry,
    entries,
    navigatorActiveIndex,
    navigatorCursorIndex,
    paneIds: currentPaneIds,
    sessionCursor,
    sessionCursorIndex,
    sessions,
    surface,
    tabActiveIndex,
    tabCursorIndex,
    tabs,
    workspaceCursorIndex,
    workspaces,
  } = model;
  const paneLayout = activeTab?.layout ?? null;
  const shellLayout = calculateShellLayout({
    terminalWidth: dimensions.width,
    terminalHeight: dimensions.height,
    navigatorPreference: state.navigatorPreference,
    preferredNavigatorWidth: state.navigatorWidth,
    activeSessionName: activeSession?.name ?? null,
    workspaces: workspaces.map(({ id, name }) => ({ id, label: name })),
    activeWorkspaceId: state.activeWorkspaceId,
    workspaceCursorId: state.workspaceCursorId,
    paneLayout,
  });
  const {
    focusNodes,
    navigatorMode,
    navigatorVisible,
    navigatorWidth,
    sessionWidth,
    undersized,
    workbenchHeight,
    workspaceViewport: viewport,
    workspaceWidth,
  } = shellLayout;

  useEffect(() => {
    if (!navigatorVisible && state.focus.region === "navigator") {
      dispatch({ type: "focus.set", focus: { region: "category" } });
    }
  }, [navigatorVisible, state.focus.region]);

  const { focus, focusedPaneId } = resolveShellFocus({
    focus: state.focus,
    lastWorkbenchPaneId: state.lastWorkbenchPaneId,
    paneIds: currentPaneIds,
    undersized,
  });
  function navigationContextKey(navigatorKey: string | null): string {
    return JSON.stringify([
      snapshot?.epoch ?? null,
      state.activeSessionId,
      state.activeWorkspaceId,
      state.activeCategory,
      navigatorKey,
    ]);
  }

  const completionNavigationKey = navigationContextKey(state.activeNavigatorKey);
  const completionContextKey = JSON.stringify([
    completionNavigationKey,
    surface?.id ?? null,
    activeTab?.id ?? null,
  ]);

  useLayoutEffect(() => {
    completionContextRef.current = {
      key: completionContextKey,
      navigationKey: completionNavigationKey,
      dialog: state.dialog,
    };
  }, [completionContextKey, completionNavigationKey, state.dialog]);
  const availableCommands = new Set<CommandId>([
    "focus.left",
    "focus.down",
    "focus.up",
    "focus.right",
    "navigator.toggle",
    "session.open",
    "client.reload",
    "client.quit",
  ]);
  if (categoryIndex > 0) availableCommands.add("category.previous");
  if (categoryIndex >= 0 && categoryIndex < renderedCategories.length - 1)
    availableCommands.add("category.next");
  if (navigatorActiveIndex > 0) availableCommands.add("navigator.previous");
  if (navigatorActiveIndex >= 0 && navigatorActiveIndex < entries.length - 1)
    availableCommands.add("navigator.next");
  if (tabActiveIndex > 0) availableCommands.add("tab.previous");
  if (tabActiveIndex >= 0 && tabActiveIndex < tabs.length - 1) availableCommands.add("tab.next");
  if (surface !== undefined) availableCommands.add("tab.create");
  if (focusedPaneId !== null) {
    availableCommands.add("pane.splitHorizontal");
    availableCommands.add("pane.splitVertical");
    const pane = snapshot?.panes.find(({ id }) => id === focusedPaneId);
    if (
      pane?.processStatus === "failed" ||
      pane?.processStatus === "exited" ||
      pane?.processStatus === "interrupted"
    ) {
      availableCommands.add("pane.restart");
    }
  }
  if (snapshot !== null && projectIdForShellContext(state, snapshot) !== undefined)
    availableCommands.add("item.create");

  if (state.dialog?.kind === "sessions") {
    if (sessionCursorIndex > 0) availableCommands.add("cursor.previous");
    if (sessionCursorIndex >= 0 && sessionCursorIndex < sessions.length - 1)
      availableCommands.add("cursor.next");
    if (sessionCursor !== null) availableCommands.add("cursor.activate");
    availableCommands.add("context.create");
    if (state.activeSessionId !== null) availableCommands.add("dialog.cancel");
  } else if (state.dialog?.kind === "create") {
    availableCommands.add("dialog.cancel");
  } else if (focus.region === "workspace") {
    if (workspaceCursorIndex > 0) availableCommands.add("cursor.left");
    if (workspaceCursorIndex >= 0 && workspaceCursorIndex < workspaces.length - 1)
      availableCommands.add("cursor.right");
    if (state.workspaceCursorId !== null) availableCommands.add("cursor.activate");
    if (state.activeSessionId !== null) availableCommands.add("context.create");
  } else if (focus.region === "session") {
    availableCommands.add("context.create");
  } else if (focus.region === "category") {
    if (categoryCursorIndex > 0) availableCommands.add("cursor.previous");
    if (categoryCursorIndex >= 0 && categoryCursorIndex < renderedCategories.length - 1)
      availableCommands.add("cursor.next");
    availableCommands.add("cursor.activate");
  } else if (focus.region === "navigator") {
    if (navigatorCursorIndex > 0) availableCommands.add("cursor.previous");
    if (navigatorCursorIndex >= 0 && navigatorCursorIndex < entries.length - 1)
      availableCommands.add("cursor.next");
    if (state.navigatorCursorKey !== null) availableCommands.add("cursor.activate");
    const cursorEntry = entries[navigatorCursorIndex];
    if (cursorEntry?.kind === "project") {
      availableCommands.add("cursor.left");
      availableCommands.add("cursor.right");
      availableCommands.add("project.openTerminal");
    }
    if (state.activeWorkspaceId !== null) availableCommands.add("context.create");
    availableCommands.add("navigator.shrink");
    availableCommands.add("navigator.grow");
  } else if (focus.region === "tabs") {
    if (tabCursorIndex > 0) availableCommands.add("cursor.left");
    if (tabCursorIndex >= 0 && tabCursorIndex < tabs.length - 1)
      availableCommands.add("cursor.right");
    if (state.tabCursorId !== null) availableCommands.add("cursor.activate");
  }

  const commandContext: CommandContext = {
    focus,
    dialog: state.dialog?.kind,
    connected: workCraft.status === "connected",
    availableCommands,
  };

  async function runCommand(
    command: Command,
    region: ShellRegion,
    context: CompletionContext = completionContextRef.current,
  ): Promise<CommandResponse["result"] | undefined> {
    const contextIsCurrent = () =>
      completionContextRef.current.navigationKey === context.navigationKey &&
      (context.key === undefined || completionContextRef.current.key === context.key) &&
      completionContextRef.current.dialog === context.dialog;
    try {
      const response = await workCraft.command(command);
      if (!contextIsCurrent()) return undefined;
      dispatch({ type: "error.set", region, error: null });
      return response.result;
    } catch (cause) {
      if (!contextIsCurrent()) return undefined;
      dispatch({
        type: "error.set",
        region,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return undefined;
    }
  }

  function reconcile(): void {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  }

  function activateNavigator(entry: NavigatorEntry | undefined): void {
    if (entry === undefined) return;
    dispatch({ type: "navigator.activate", key: entry.key });
    if (entry.kind === "item") {
      void runCommand(durableCommands.openItem(entry.id), "navigator", {
        navigationKey: navigationContextKey(entry.key),
        dialog: state.dialog,
      });
    }
  }

  function openCreate(createKind: CreateKind): void {
    dispatch({
      type: "dialog.open",
      dialog: { kind: "create", createKind, returnFocus: focus },
    });
  }

  function moveCursor(offset: -1 | 1): void {
    if (state.dialog?.kind === "sessions") {
      setSessionCursorId(adjacent(sessions, sessionCursorIndex, offset)?.id ?? sessionCursor);
    } else if (focus.region === "category") {
      const category = adjacent(renderedCategories, categoryCursorIndex, offset);
      if (category !== undefined) dispatch({ type: "category.cursor", category: category.kind });
    } else if (focus.region === "navigator") {
      const entry = adjacent(entries, navigatorCursorIndex, offset);
      if (entry !== undefined) dispatch({ type: "navigator.cursor", key: entry.key });
    }
  }

  function moveHorizontalCursor(offset: -1 | 1): void {
    if (focus.region === "workspace") {
      const workspace = adjacent(workspaces, workspaceCursorIndex, offset);
      if (workspace !== undefined) dispatch({ type: "workspace.cursor", id: workspace.id });
    } else if (focus.region === "tabs") {
      const tab = adjacent(tabs, tabCursorIndex, offset);
      if (tab !== undefined) dispatch({ type: "tab.cursor", id: tab.id });
    } else if (focus.region === "navigator") {
      const entry = entries[navigatorCursorIndex];
      if (
        entry?.kind === "project" &&
        ((offset < 0 && state.expandedProjectIds.has(entry.id)) ||
          (offset > 0 && !state.expandedProjectIds.has(entry.id)))
      ) {
        dispatch({ type: "project.toggle", projectId: entry.id });
        reconcile();
      }
    }
  }

  function activateCursor(): void {
    if (state.dialog?.kind === "sessions") {
      if (sessionCursor !== null) {
        dispatch({ type: "session.activate", id: sessionCursor });
        reconcile();
      }
    } else if (focus.region === "workspace" && state.workspaceCursorId !== null) {
      dispatch({ type: "workspace.activate", id: state.workspaceCursorId });
      reconcile();
    } else if (focus.region === "category") {
      dispatch({ type: "category.activate", category: state.categoryCursor });
      reconcile();
    } else if (focus.region === "navigator") {
      activateNavigator(entries[navigatorCursorIndex]);
    } else if (focus.region === "tabs") {
      const tab = tabs[tabCursorIndex];
      if (surface !== undefined && tab !== undefined) {
        void runCommand(durableCommands.selectTab(surface.id, tab.id), "tabs");
      }
    }
  }

  async function executeCommand(command: CommandId): Promise<void> {
    if (command.startsWith("focus.")) {
      const direction = command.slice(6) as "left" | "right" | "up" | "down";
      const next = moveFocus(focus, direction, focusNodes);
      const restored =
        focus.region !== "workbench" &&
        next.region === "workbench" &&
        state.lastWorkbenchPaneId !== null &&
        currentPaneIds.includes(state.lastWorkbenchPaneId)
          ? { region: "workbench" as const, paneId: state.lastWorkbenchPaneId }
          : next;
      dispatch({ type: "focus.set", focus: restored });
      return;
    }
    switch (command) {
      case "category.previous":
      case "category.next": {
        const category = adjacent(
          renderedCategories,
          categoryIndex,
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
          adjacent(entries, navigatorActiveIndex, command === "navigator.previous" ? -1 : 1),
        );
        return;
      case "navigator.toggle":
        dispatch({ type: "navigator.toggle", hasWorkbench: currentPaneIds.length > 0 });
        return;
      case "tab.previous":
      case "tab.next": {
        const tab = adjacent(tabs, tabActiveIndex, command === "tab.previous" ? -1 : 1);
        if (surface !== undefined && tab !== undefined) {
          dispatch({ type: "tab.cursor", id: tab.id });
          await runCommand(durableCommands.selectTab(surface.id, tab.id), "tabs");
        }
        return;
      }
      case "tab.create":
        if (surface !== undefined) await runCommand(durableCommands.createTab(surface.id), "tabs");
        return;
      case "session.open":
        setSessionCursorId(state.activeSessionId ?? sessions[0]?.id ?? null);
        dispatch({
          type: "dialog.open",
          dialog: { kind: "sessions", returnFocus: focus },
        });
        return;
      case "client.reload":
        await workCraft.reload();
        return;
      case "client.quit":
        renderer.destroy();
        return;
      case "item.create":
        openCreate("item");
        return;
      case "pane.splitHorizontal":
        if (focusedPaneId !== null) {
          const result = await runCommand(
            durableCommands.splitHorizontal(focusedPaneId),
            "workbench",
          );
          if (result?.paneId !== undefined) {
            dispatch({ type: "focus.set", focus: { region: "workbench", paneId: result.paneId } });
          }
        }
        return;
      case "pane.splitVertical":
        if (focusedPaneId !== null) {
          const result = await runCommand(
            durableCommands.splitVertical(focusedPaneId),
            "workbench",
          );
          if (result?.paneId !== undefined) {
            dispatch({ type: "focus.set", focus: { region: "workbench", paneId: result.paneId } });
          }
        }
        return;
      case "pane.restart":
        if (focusedPaneId !== null)
          await runCommand(durableCommands.restartPane(focusedPaneId), "workbench");
        return;
      case "cursor.previous":
        moveCursor(-1);
        return;
      case "cursor.next":
        moveCursor(1);
        return;
      case "cursor.left":
        moveHorizontalCursor(-1);
        return;
      case "cursor.right":
        moveHorizontalCursor(1);
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
        const entry = entries[navigatorCursorIndex];
        if (entry?.kind === "project") {
          const result = await runCommand(durableCommands.openProject(entry.id), "navigator");
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
          terminalWidth: dimensions.width,
        });
        return;
      case "dialog.cancel":
        dispatch({ type: "dialog.close" });
        return;
    }
  }

  useKeyboard((key) => {
    const keyLike: KeyLike = {
      name: key.name,
      raw: key.raw,
      ctrl: key.ctrl,
      meta: key.meta,
      option: key.option,
      shift: key.shift,
      super: key.super,
      hyper: key.hyper,
    };
    const routed = routeKey(routerState, keyLike, commandContext, Date.now());
    setRouterState(routed.state);
    if (!routed.handled) return;
    key.preventDefault();
    key.stopPropagation();
    if (routed.passthroughLeader) {
      if (focus.region === "workbench") terminalRefs.current.get(focus.paneId)?.handleKeyPress(key);
    } else if (routed.command !== undefined) {
      void executeCommand(routed.command);
    }
  });

  async function submitCreate(value: string): Promise<void> {
    if (
      snapshot === null ||
      state.dialog?.kind !== "create" ||
      submittingDialogRef.current === state.dialog
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
      projectId = projectIdForShellContext(state, snapshot);
      if (projectId !== undefined) {
        command = durableCommands.createItem(projectId, value);
      }
    }
    if (command === undefined) {
      return;
    }
    submittingDialogRef.current = dialog;
    const result = await runCommand(command, commandRegion(returnFocus));
    if (submittingDialogRef.current === dialog) {
      submittingDialogRef.current = null;
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

  const mode =
    routerState.invalidMessage !== null
      ? "ERROR"
      : statusModeFor(
          routerState.leaderStartedAt !== null,
          navigatorMode === "compact" && focus.region === "navigator",
        );
  const hints = commandHints(routerState, commandContext);
  const statusProps: StatusBarProps =
    mode === "INFO"
      ? { mode: "INFO", text: routerState.invalidMessage ?? cursorEntry?.label ?? "" }
      : { mode, hints, text: routerState.invalidMessage ?? undefined };
  const workspaceProps = {
    activeId: state.activeWorkspaceId,
    cursorId: state.workspaceCursorId,
    focused: focus.region === "workspace",
    hasNext: viewport.hasNext,
    hasPrevious: viewport.hasPrevious,
    visibleIds: viewport.ids,
    width: workspaceWidth,
    workspaces,
    onActivate: (id: string) => {
      dispatch({ type: "focus.set", focus: { region: "workspace" } });
      dispatch({ type: "workspace.activate", id });
      reconcile();
    },
    onFocus: (id: string) => {
      dispatch({ type: "focus.set", focus: { region: "workspace" } });
      dispatch({ type: "workspace.cursor", id });
    },
  };
  const sessionProps = {
    focused: focus.region === "session",
    name: activeSession?.name ?? null,
    status: workCraft.status,
    width: sessionWidth,
    onOpen: () => void executeCommand("session.open"),
  };
  const categoryProps = {
    active: state.activeCategory,
    categories: renderedCategories,
    cursor: state.categoryCursor,
    focused: focus.region === "category",
    onActivate: (category: CategoryKind) => {
      dispatch({ type: "focus.set", focus: { region: "category" } });
      dispatch({ type: "category.activate", category });
      reconcile();
    },
    onFocus: (category: CategoryKind) => {
      dispatch({ type: "focus.set", focus: { region: "category" } });
      dispatch({ type: "category.cursor", category });
    },
  };
  const navigatorProps = !navigatorVisible
    ? null
    : {
        activeKey: state.activeNavigatorKey,
        cursorKey: state.navigatorCursorKey,
        entries,
        error: state.errors.navigator ?? null,
        focused: focus.region === "navigator",
        height: workbenchHeight,
        mode: navigatorMode === "hidden" ? "compact" : navigatorMode,
        title: activeCategoryTitle,
        width: navigatorWidth,
        onActivate: (key: string) => {
          dispatch({ type: "focus.set", focus: { region: "navigator" } });
          activateNavigator(entries.find((entry) => entry.key === key));
        },
        onFocus: (key: string) => {
          dispatch({ type: "focus.set", focus: { region: "navigator" } });
          dispatch({ type: "navigator.cursor", key });
        },
      };
  const workbenchProps = {
    activeTabId: activeTab?.id ?? null,
    focusedPaneId,
    snapshot,
    stream: workCraft.stream,
    surface,
    tabCursorId: state.tabCursorId,
    tabError: state.errors.tabs ?? null,
    tabs,
    tabsFocused: focus.region === "tabs",
    terminals: workCraft.terminals,
    undersized,
    workbenchError: state.errors.workbench ?? null,
    workbenchFocused: state.dialog === null && focus.region === "workbench",
    onActivateTab: (id: string) => {
      dispatch({ type: "focus.set", focus: { region: "tabs" } });
      dispatch({ type: "tab.cursor", id });
      if (surface !== undefined) {
        void runCommand(durableCommands.selectTab(surface.id, id), "tabs");
      }
    },
    onFocusTab: (id: string) => {
      dispatch({ type: "focus.set", focus: { region: "tabs" } });
      dispatch({ type: "tab.cursor", id });
    },
    onFocusPane: (paneId: string) =>
      dispatch({ type: "focus.set", focus: { region: "workbench", paneId } }),
    onTerminalReady: (paneId: string, terminal: EmbeddedTerminalRenderable | null) => {
      if (terminal === null) {
        terminalRefs.current.delete(paneId);
      } else {
        terminalRefs.current.set(paneId, terminal);
      }
    },
  };
  const dialogProps =
    state.dialog === null
      ? null
      : {
          dialog: state.dialog,
          width: dimensions.width,
          height: dimensions.height,
          sessions,
          sessionCursorId: sessionCursor,
          promptValue: state.promptValue,
          error: state.errors[commandRegion(state.dialog.returnFocus)] ?? null,
          onCreateSession: () => openCreate("session"),
          onFocusSession: setSessionCursorId,
          onSelectSession: (id: string) => {
            dispatch({ type: "session.activate", id });
            reconcile();
          },
          onPromptChange: (value: string) => dispatch({ type: "prompt.set", value }),
          onPromptSubmit: (value: string) => void submitCreate(value),
        };

  return (
    <Box id="work-craft-shell" flexDirection="column" width="100%" height="100%">
      <Header workspace={workspaceProps} session={sessionProps} />
      <Box flexDirection="row" flexGrow={1}>
        <CategoryRail {...categoryProps} />
        {navigatorProps === null ? null : <Navigator {...navigatorProps} />}
        <Workbench {...workbenchProps} />
      </Box>
      <StatusBar {...statusProps} />
      {dialogProps === null ? null : <DialogOverlay {...dialogProps} />}
    </Box>
  );
}

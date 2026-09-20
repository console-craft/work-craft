import type { EmbeddedTerminalRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { CategoryKind, Command, Snapshot } from "@work-craft/server/client";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  commandHints,
  initialRouterState,
  routeKey,
  type CommandContext,
  type CommandId,
  type KeyLike,
} from "./command-router.ts";
import { CreatePrompt, type CreateKind } from "./create-prompt.tsx";
import { moveFocus, projectPaneFocusNodes, type FocusNode, type FocusTarget } from "./focus.ts";
import {
  categoriesForWorkspace,
  navigatorEntries,
  workspacesForSession,
  type NavigatorEntry,
} from "./navigation.ts";
import { NavigationPane } from "./navigation-pane.tsx";
import { SessionChooser } from "./session-chooser.tsx";
import {
  CATEGORY_RAIL_WIDTH,
  COMPACT_NAVIGATOR_WIDTH,
  MIN_WORKBENCH_HEIGHT,
  MIN_WORKBENCH_WIDTH,
  resolveNavigatorMode,
  workspaceViewport,
} from "./shell-layout.ts";
import {
  CategoryRail,
  SessionSwitcher,
  StatusBar,
  TabStrip,
  WorkspaceStrip,
  statusModeFor,
} from "./shell-regions.tsx";
import {
  createInitialShellState,
  projectIdForShellContext,
  reduceShellState,
  type ShellRegion,
} from "./shell-state.ts";
import { paneIds, projectLayout, SurfaceView } from "./surface-view.tsx";
import type { WorkCraftState } from "./use-work-craft.ts";

const FIXED_CATEGORIES: readonly { kind: CategoryKind; title: string }[] = [
  { kind: "inbox", title: "Inbox" },
  { kind: "today", title: "Today" },
  { kind: "design", title: "Design" },
  { kind: "implementation", title: "Implementation" },
  { kind: "collaboration", title: "Collaboration" },
  { kind: "operations", title: "Operations" },
];

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

function orderedSessions(snapshot: Snapshot | null): Snapshot["sessions"] {
  return [...(snapshot?.sessions ?? [])].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
}

function entryIndex(entries: readonly NavigatorEntry[], key: string | null): number {
  return entries.findIndex((entry) => entry.key === key);
}

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

  const sessions = orderedSessions(snapshot);
  const activeSession = sessions.find(({ id }) => id === state.activeSessionId);
  const workspaces =
    snapshot === null || state.activeSessionId === null
      ? []
      : workspacesForSession(snapshot, state.activeSessionId);
  const categories =
    snapshot === null || state.activeWorkspaceId === null
      ? []
      : categoriesForWorkspace(snapshot, state.activeWorkspaceId);
  const renderedCategories: Snapshot["categories"] =
    categories.length > 0
      ? categories
      : FIXED_CATEGORIES.map((category, position) => ({
          ...category,
          workspaceId: state.activeWorkspaceId ?? "",
          position,
        }));
  const entries =
    snapshot === null || state.activeWorkspaceId === null
      ? []
      : navigatorEntries(
          snapshot,
          state.activeWorkspaceId,
          state.activeCategory,
          state.expandedProjectIds,
        );
  const activeEntry = entries.find(({ key }) => key === state.activeNavigatorKey);
  const surface =
    snapshot === null || activeEntry?.kind !== "item"
      ? undefined
      : snapshot.surfaces.find(({ itemId }) => itemId === activeEntry.id);
  const tabs = [...(snapshot?.tabs ?? [])]
    .filter(({ surfaceId }) => surfaceId === surface?.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const activeTab = tabs.find(({ id }) => id === surface?.activeTabId) ?? tabs[0];
  const layout = activeTab?.layout ?? null;
  const currentPaneIds = layout === null ? [] : paneIds(projectLayout(layout));
  const focusedPaneId =
    state.focus.region === "workbench" && currentPaneIds.includes(state.focus.paneId)
      ? state.focus.paneId
      : currentPaneIds.includes(state.lastWorkbenchPaneId ?? "")
        ? state.lastWorkbenchPaneId
        : (currentPaneIds[0] ?? null);
  const navigatorMode = resolveNavigatorMode({
    terminalWidth: dimensions.width,
    expandedWidth: state.navigatorWidth,
    preference: state.navigatorPreference,
  });
  const navigatorWidth =
    navigatorMode === "expanded"
      ? state.navigatorWidth
      : navigatorMode === "compact"
        ? COMPACT_NAVIGATOR_WIDTH
        : 0;
  const workbenchWidth = dimensions.width - CATEGORY_RAIL_WIDTH - navigatorWidth;
  const workbenchHeight = dimensions.height - 3;
  const undersized = workbenchWidth < MIN_WORKBENCH_WIDTH || workbenchHeight < MIN_WORKBENCH_HEIGHT;
  const sessionWidth = Math.min(
    Math.max(18, (activeSession?.name.length ?? 6) + 14),
    Math.max(18, dimensions.width - 1),
  );
  const viewport = workspaceViewport(
    workspaces.map(({ id, name }) => ({ id, label: name })),
    state.activeWorkspaceId,
    state.workspaceCursorId,
    Math.max(0, dimensions.width - sessionWidth),
  );
  const sessionCursor = sessions.some(({ id }) => id === sessionCursorId)
    ? sessionCursorId
    : sessions.some(({ id }) => id === state.activeSessionId)
      ? state.activeSessionId
      : (sessions[0]?.id ?? null);
  const categoryIndex = renderedCategories.findIndex(({ kind }) => kind === state.activeCategory);
  const navigatorActiveIndex = entryIndex(entries, state.activeNavigatorKey);
  const navigatorCursorIndex = entryIndex(entries, state.navigatorCursorKey);
  const tabActiveIndex = tabs.findIndex(({ id }) => id === activeTab?.id);
  const tabCursorIndex = tabs.findIndex(({ id }) => id === state.tabCursorId);
  const workspaceCursorIndex = workspaces.findIndex(({ id }) => id === state.workspaceCursorId);
  const categoryCursorIndex = renderedCategories.findIndex(
    ({ kind }) => kind === state.categoryCursor,
  );
  const sessionCursorIndex = sessions.findIndex(({ id }) => id === sessionCursor);

  function focusNodes(): FocusNode[] {
    const bodyHeight = Math.max(0, dimensions.height - 2);
    const workbenchX = CATEGORY_RAIL_WIDTH + navigatorWidth;
    const nodes: FocusNode[] = [
      {
        target: { region: "workspace" },
        rect: { x: 0, y: 0, width: Math.max(1, dimensions.width - sessionWidth), height: 1 },
      },
      {
        target: { region: "session" },
        rect: {
          x: Math.max(0, dimensions.width - sessionWidth),
          y: 0,
          width: sessionWidth,
          height: 1,
        },
      },
      {
        target: { region: "category" },
        rect: { x: 0, y: 1, width: CATEGORY_RAIL_WIDTH, height: bodyHeight },
      },
      {
        target: { region: "tabs" },
        rect: { x: workbenchX, y: 1, width: Math.max(0, workbenchWidth), height: 1 },
      },
    ];
    if (navigatorMode !== "hidden") {
      nodes.push({
        target: { region: "navigator" },
        rect: { x: CATEGORY_RAIL_WIDTH, y: 1, width: navigatorWidth, height: bodyHeight },
      });
    }
    if (layout !== null && !undersized) {
      nodes.push(
        ...projectPaneFocusNodes(layout, {
          x: workbenchX,
          y: 2,
          width: Math.max(0, workbenchWidth),
          height: Math.max(0, dimensions.height - 3),
        }),
      );
    }
    return nodes;
  }

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
  } else if (state.focus.region === "workspace") {
    if (workspaceCursorIndex > 0) availableCommands.add("cursor.left");
    if (workspaceCursorIndex >= 0 && workspaceCursorIndex < workspaces.length - 1)
      availableCommands.add("cursor.right");
    if (state.workspaceCursorId !== null) availableCommands.add("cursor.activate");
    if (state.activeSessionId !== null) availableCommands.add("context.create");
  } else if (state.focus.region === "session") {
    availableCommands.add("context.create");
  } else if (state.focus.region === "category") {
    if (categoryCursorIndex > 0) availableCommands.add("cursor.previous");
    if (categoryCursorIndex >= 0 && categoryCursorIndex < renderedCategories.length - 1)
      availableCommands.add("cursor.next");
    availableCommands.add("cursor.activate");
  } else if (state.focus.region === "navigator") {
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
  } else if (state.focus.region === "tabs") {
    if (tabCursorIndex > 0) availableCommands.add("cursor.left");
    if (tabCursorIndex >= 0 && tabCursorIndex < tabs.length - 1)
      availableCommands.add("cursor.right");
    if (state.tabCursorId !== null) availableCommands.add("cursor.activate");
  }

  const commandContext: CommandContext = {
    focus: state.focus,
    dialog: state.dialog?.kind,
    connected: workCraft.status === "connected",
    availableCommands,
  };

  async function runCommand(command: Command, region: ShellRegion): Promise<string | undefined> {
    try {
      const response = await workCraft.command(command);
      dispatch({ type: "error.set", region, error: null });
      return response.result.itemId ?? response.result.id;
    } catch (cause) {
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
      void runCommand(durableCommands.openItem(entry.id), "navigator");
    }
  }

  function openCreate(createKind: CreateKind): void {
    dispatch({
      type: "dialog.open",
      dialog: { kind: "create", createKind, returnFocus: state.focus },
    });
  }

  function moveCursor(offset: -1 | 1): void {
    if (state.dialog?.kind === "sessions") {
      setSessionCursorId(adjacent(sessions, sessionCursorIndex, offset)?.id ?? sessionCursor);
    } else if (state.focus.region === "category") {
      const category = adjacent(renderedCategories, categoryCursorIndex, offset);
      if (category !== undefined) dispatch({ type: "category.cursor", category: category.kind });
    } else if (state.focus.region === "navigator") {
      const entry = adjacent(entries, navigatorCursorIndex, offset);
      if (entry !== undefined) dispatch({ type: "navigator.cursor", key: entry.key });
    }
  }

  function moveHorizontalCursor(offset: -1 | 1): void {
    if (state.focus.region === "workspace") {
      const workspace = adjacent(workspaces, workspaceCursorIndex, offset);
      if (workspace !== undefined) dispatch({ type: "workspace.cursor", id: workspace.id });
    } else if (state.focus.region === "tabs") {
      const tab = adjacent(tabs, tabCursorIndex, offset);
      if (tab !== undefined) dispatch({ type: "tab.cursor", id: tab.id });
    } else if (state.focus.region === "navigator") {
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
    } else if (state.focus.region === "workspace" && state.workspaceCursorId !== null) {
      dispatch({ type: "workspace.activate", id: state.workspaceCursorId });
      reconcile();
    } else if (state.focus.region === "category") {
      dispatch({ type: "category.activate", category: state.categoryCursor });
      reconcile();
    } else if (state.focus.region === "navigator") {
      activateNavigator(entries[navigatorCursorIndex]);
    } else if (state.focus.region === "tabs") {
      const tab = tabs[tabCursorIndex];
      if (surface !== undefined && tab !== undefined) {
        void runCommand(durableCommands.selectTab(surface.id, tab.id), "tabs");
      }
    }
  }

  async function executeCommand(command: CommandId): Promise<void> {
    if (command.startsWith("focus.")) {
      const direction = command.slice(6) as "left" | "right" | "up" | "down";
      const next = moveFocus(state.focus, direction, focusNodes());
      const restored =
        next.region === "workbench" && state.lastWorkbenchPaneId !== null
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
          dialog: { kind: "sessions", returnFocus: state.focus },
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
        if (focusedPaneId !== null)
          await runCommand(durableCommands.splitHorizontal(focusedPaneId), "workbench");
        return;
      case "pane.splitVertical":
        if (focusedPaneId !== null)
          await runCommand(durableCommands.splitVertical(focusedPaneId), "workbench");
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
          state.dialog?.kind === "sessions" || state.focus.region === "session"
            ? "session"
            : state.focus.region === "workspace"
              ? "workspace"
              : "project",
        );
        return;
      case "project.openTerminal": {
        const entry = entries[navigatorCursorIndex];
        if (entry?.kind === "project") {
          const itemId = await runCommand(durableCommands.openProject(entry.id), "navigator");
          if (itemId !== undefined) dispatch({ type: "navigator.activate", key: `item:${itemId}` });
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
      if (state.focus.region === "workbench")
        terminalRefs.current.get(state.focus.paneId)?.handleKeyPress(key);
    } else if (routed.command !== undefined) {
      void executeCommand(routed.command);
    }
  });

  async function submitCreate(value: string): Promise<void> {
    if (snapshot === null || state.dialog?.kind !== "create") return;
    const { createKind, returnFocus } = state.dialog;
    let command: Command | undefined;
    if (createKind === "session") {
      command = durableCommands.createSession(value);
    } else if (createKind === "workspace" && state.activeSessionId !== null) {
      command = durableCommands.createWorkspace(state.activeSessionId, value);
    } else if (createKind === "project" && state.activeWorkspaceId !== null) {
      command = durableCommands.createProject(state.activeWorkspaceId, state.activeCategory, value);
    } else {
      const projectId = projectIdForShellContext(state, snapshot);
      if (projectId !== undefined) command = durableCommands.createItem(projectId, value);
    }
    if (command === undefined) return;
    const id = await runCommand(command, commandRegion(returnFocus));
    if (id === undefined) return;
    dispatch({ type: "dialog.close" });
    if (createKind === "session") dispatch({ type: "session.activate", id });
    else if (createKind === "workspace") dispatch({ type: "workspace.activate", id });
    else if (createKind === "project")
      dispatch({ type: "navigator.activate", key: `project:${id}` });
    else dispatch({ type: "navigator.activate", key: `item:${id}` });
  }

  const mode = statusModeFor(
    routerState.leaderStartedAt !== null,
    navigatorMode === "compact" && state.focus.region === "navigator",
  );
  const cursorEntry = entries.find(({ key }) => key === state.navigatorCursorKey);
  const hints = commandHints(routerState, commandContext);
  const status =
    mode === "INFO" ? (
      <StatusBar mode="INFO" text={cursorEntry?.label ?? ""} />
    ) : (
      <StatusBar mode={mode} hints={hints} text={routerState.invalidMessage ?? undefined} />
    );
  const activeCategoryTitle =
    renderedCategories.find(({ kind }) => kind === state.activeCategory)?.title ?? "Work";

  return (
    <box id="work-craft-shell" flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" height={1}>
        <WorkspaceStrip
          activeId={state.activeWorkspaceId}
          cursorId={state.workspaceCursorId}
          focused={state.focus.region === "workspace"}
          hasNext={viewport.hasNext}
          hasPrevious={viewport.hasPrevious}
          visibleIds={viewport.ids}
          workspaces={workspaces}
          onActivate={(id) => {
            dispatch({ type: "focus.set", focus: { region: "workspace" } });
            dispatch({ type: "workspace.activate", id });
            reconcile();
          }}
          onFocus={(id) => {
            dispatch({ type: "focus.set", focus: { region: "workspace" } });
            dispatch({ type: "workspace.cursor", id });
          }}
        />
        <SessionSwitcher
          focused={state.focus.region === "session"}
          name={activeSession?.name ?? null}
          status={workCraft.status}
          onOpen={() => void executeCommand("session.open")}
        />
      </box>
      <box flexDirection="row" flexGrow={1}>
        <CategoryRail
          active={state.activeCategory}
          categories={renderedCategories}
          cursor={state.categoryCursor}
          focused={state.focus.region === "category"}
          onActivate={(category) => {
            dispatch({ type: "focus.set", focus: { region: "category" } });
            dispatch({ type: "category.activate", category });
            reconcile();
          }}
          onFocus={(category) => {
            dispatch({ type: "focus.set", focus: { region: "category" } });
            dispatch({ type: "category.cursor", category });
          }}
        />
        {navigatorMode === "hidden" ? null : (
          <box flexDirection="column" width={navigatorWidth} height="100%">
            <text height={1}>{activeCategoryTitle}</text>
            <NavigationPane
              activeKey={state.activeNavigatorKey}
              cursorKey={state.navigatorCursorKey}
              entries={entries}
              error={state.errors.navigator ?? null}
              focused={state.focus.region === "navigator"}
              mode={navigatorMode}
              width={navigatorWidth}
              onActivate={(key) => {
                dispatch({ type: "focus.set", focus: { region: "navigator" } });
                activateNavigator(entries.find((entry) => entry.key === key));
              }}
              onFocus={(key) => {
                dispatch({ type: "focus.set", focus: { region: "navigator" } });
                dispatch({ type: "navigator.cursor", key });
              }}
            />
          </box>
        )}
        <box flexDirection="column" flexGrow={1} minWidth={0}>
          <TabStrip
            activeId={activeTab?.id ?? null}
            cursorId={state.tabCursorId}
            focused={state.focus.region === "tabs"}
            tabs={tabs}
            onActivate={(id) => {
              dispatch({ type: "focus.set", focus: { region: "tabs" } });
              dispatch({ type: "tab.cursor", id });
              if (surface !== undefined)
                void runCommand(durableCommands.selectTab(surface.id, id), "tabs");
            }}
            onFocus={(id) => {
              dispatch({ type: "focus.set", focus: { region: "tabs" } });
              dispatch({ type: "tab.cursor", id });
            }}
          />
          <box id="region:workbench" flexGrow={1} minHeight={0} borderStyle="single">
            {surface === undefined || snapshot === null ? (
              <text fg="#9CA3AF">Select an item with an execution surface</text>
            ) : (
              <SurfaceView
                focusedPaneId={focusedPaneId}
                snapshot={snapshot}
                stream={workCraft.stream}
                surface={surface}
                terminals={workCraft.terminals}
                undersized={undersized}
                workbenchFocused={state.focus.region === "workbench"}
                onFocusPane={(paneId) =>
                  dispatch({ type: "focus.set", focus: { region: "workbench", paneId } })
                }
                onTerminalReady={(paneId, terminal) => {
                  if (terminal === null) terminalRefs.current.delete(paneId);
                  else terminalRefs.current.set(paneId, terminal);
                }}
              />
            )}
          </box>
        </box>
      </box>
      {status}
      {state.dialog === null ? null : (
        <box id="dialog" position="absolute" left="20%" top="20%" width="60%" height="60%">
          {state.dialog.kind === "sessions" ? (
            <SessionChooser
              cursorId={sessionCursor}
              sessions={sessions}
              onCreate={() => openCreate("session")}
              onFocus={setSessionCursorId}
              onSelect={(id) => {
                dispatch({ type: "session.activate", id });
                reconcile();
              }}
            />
          ) : (
            <CreatePrompt
              error={state.errors[commandRegion(state.dialog.returnFocus)] ?? null}
              kind={state.dialog.createKind}
              value={state.promptValue}
              onChange={(value) => dispatch({ type: "prompt.set", value })}
              onSubmit={(value) => void submitCreate(value)}
            />
          )}
        </box>
      )}
    </box>
  );
}

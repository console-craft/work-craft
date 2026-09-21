import { BoxRenderable, type EmbeddedTerminalRenderable, SelectRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { CategoryKind } from "@work-craft/server/client";
import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import type { WorkCraftState } from "@/client/use-work-craft.ts";
import {
  type CommandContext,
  commandHints,
  type CommandId,
  initialRouterState,
  type KeyLike,
  routeKey,
} from "@/input/command-router.ts";
import { CategoryRail } from "@/navigation/category-rail.tsx";
import { Navigator } from "@/navigation/navigator.tsx";
import {
  availableCommands,
  type CompletionContext,
  completionContextFor,
  executeCommand,
  type ExecuteCommandInput,
  runDurableCommand,
  submitCreate,
} from "@/shell/commands.ts";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { Header } from "@/shell/header.tsx";
import { calculateShellLayout } from "@/shell/layout.ts";
import { deriveShellModel, resolveShellFocus } from "@/shell/model.ts";
import { createInitialShellState, type DialogState, reduceShellState } from "@/shell/state.ts";
import { StatusBar, type StatusBarProps, statusModeFor } from "@/shell/status-bar.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import { Workbench } from "@/workbench/workbench.tsx";

export type WorkCraftShellProps = { workCraft: WorkCraftState };

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
    cursorEntry,
    entries,
    paneIds: currentPaneIds,
    sessionCursor,
    sessions,
    surface,
    tabs,
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
  const completionContext = completionContextFor(model, state.dialog);

  useLayoutEffect(() => {
    completionContextRef.current = completionContext;
  }, [completionContext.key, completionContext.navigationKey, completionContext.dialog]);
  const structuralCommands = availableCommands({ model, state, snapshot, focus, focusedPaneId });

  const commandContext: CommandContext = {
    focus,
    dialog: state.dialog?.kind,
    connected: workCraft.status === "connected",
    availableCommands: structuralCommands,
  };

  const runCommand: ExecuteCommandInput["run"] = (
    command,
    region,
    expected = completionContextRef.current,
  ) => {
    return runDurableCommand({
      command,
      region,
      expected,
      current: () => completionContextRef.current,
      send: workCraft.command,
      dispatch,
    });
  };

  function reconcile(): void {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  }

  function execute(
    command: CommandId,
    overrides: Partial<
      Pick<ExecuteCommandInput, "model" | "state" | "focus" | "focusedPaneId">
    > = {},
  ): Promise<void> {
    return executeCommand({
      command,
      model,
      state,
      snapshot,
      focus,
      focusedPaneId,
      focusNodes,
      terminalWidth: dimensions.width,
      dispatch,
      setSessionCursorId,
      run: runCommand,
      reload: workCraft.reload,
      quit: () => renderer.destroy(),
      ...overrides,
    });
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
    const sessionListFocused =
      state.dialog?.kind === "sessions" &&
      renderer.currentFocusedRenderable instanceof SelectRenderable;
    // Native navigation applies bounds synchronously; a buffered key can arrive
    // before React commits its cursor, so don't gate it on stale shell indices.
    const keyContext = sessionListFocused
      ? {
          ...commandContext,
          availableCommands: new Set<CommandId>([
            ...structuralCommands,
            "cursor.previous",
            "cursor.next",
            "cursor.activate",
          ]),
        }
      : commandContext;
    const routed = routeKey(routerState, keyLike, keyContext, Date.now());
    setRouterState(routed.state);
    // Global listeners run before renderable handlers; the focused list owns
    // browsing and activation, while n, Escape, and Hyper commands stay here.
    if (
      sessionListFocused &&
      (routed.command === "cursor.previous" ||
        routed.command === "cursor.next" ||
        routed.command === "cursor.activate")
    ) {
      return;
    }
    if (
      routed.command === "cursor.activate" &&
      renderer.currentFocusedRenderable instanceof BoxRenderable
    ) {
      return;
    }
    if (!routed.handled) return;
    key.preventDefault();
    key.stopPropagation();
    if (routed.passthroughLeader) {
      if (focus.region === "workbench") terminalRefs.current.get(focus.paneId)?.handleKeyPress(key);
    } else if (routed.command !== undefined) {
      void execute(routed.command);
    }
  });

  function handleCreate(value: string): Promise<void> {
    return submitCreate({
      value,
      model,
      state,
      snapshot,
      getSubmittingDialog: () => submittingDialogRef.current,
      setSubmittingDialog: (dialog) => {
        submittingDialogRef.current = dialog;
      },
      dispatch,
      run: runCommand,
    });
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
    onOpen: () => void execute("session.open"),
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
          void execute("cursor.activate", {
            model: {
              ...model,
              navigatorCursorIndex: entries.findIndex((entry) => entry.key === key),
            },
            focus: { region: "navigator" },
            focusedPaneId: null,
          });
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
      void execute("cursor.activate", {
        model: { ...model, tabCursorIndex: tabs.findIndex((tab) => tab.id === id) },
        focus: { region: "tabs" },
      });
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
          error: state.errors[state.dialog.returnFocus.region] ?? null,
          onCreateSession: () => void execute("context.create"),
          onFocusSession: setSessionCursorId,
          onSelectSession: (id: string) => {
            dispatch({ type: "session.activate", id });
            reconcile();
          },
          onPromptChange: (value: string) => dispatch({ type: "prompt.set", value }),
          onPromptSubmit: (value: string) => void handleCreate(value),
        };

  return (
    <Box id="work-craft-shell" width="100%" height="100%">
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

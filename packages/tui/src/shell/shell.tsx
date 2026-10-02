import type { EmbeddedTerminalRenderable } from "@opentui/core";
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
import { focusKey, type FocusTarget } from "@/input/focus.ts";
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
import { focusShellTarget, focusTargetFor } from "@/shell/focus.ts";
import { Header } from "@/shell/header.tsx";
import { calculateShellLayout } from "@/shell/layout.ts";
import { deriveShellModel, resolveShellFocus } from "@/shell/model.ts";
import { createInitialShellState, type DialogState, reduceShellState } from "@/shell/state.ts";
import { StatusBar, type StatusBarProps, statusModeFor } from "@/shell/status-bar.tsx";
import { useFocusedControlHints } from "@/ui/control-hints";
import { useFocusScope, useNativeFocus } from "@/ui/focus-manager.tsx";
import { isEligibleFocusTarget } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box.tsx";
import { Workbench } from "@/workbench/workbench.tsx";

export type WorkCraftShellProps = { workCraft: WorkCraftState };

export function WorkCraftShell({ workCraft }: WorkCraftShellProps): ReactNode {
  const renderer = useRenderer();
  const nativeFocus = useNativeFocus();
  const controlHints = useFocusedControlHints();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(reduceShellState, undefined, createInitialShellState);
  // Pane memory must advance before a buffered key leaves and re-enters the workbench.
  const lastWorkbenchPaneIdRef = useRef(state.lastWorkbenchPaneId);
  useLayoutEffect(() => {
    lastWorkbenchPaneIdRef.current = state.lastWorkbenchPaneId;
  }, [state.lastWorkbenchPaneId]);
  const expandedProjectIdsRef = useRef(state.expandedProjectIds);
  useLayoutEffect(() => {
    expandedProjectIdsRef.current = state.expandedProjectIds;
  }, [state.expandedProjectIds]);
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
  const dialogKey =
    state.dialog === null
      ? null
      : state.dialog.kind === "sessions"
        ? "sessions"
        : `create:${state.dialog.createKind}`;
  const scope = useFocusScope(
    dialogKey === null
      ? null
      : {
          scopeId: "dialog-overlay",
          scopeKey: dialogKey,
          initialFocusId:
            state.dialog?.kind === "sessions"
              ? sessions.length === 0
                ? "session:create"
                : "session:list"
              : "create:name",
        },
  );
  useLayoutEffect(() => {
    setRouterState((current) =>
      current.leaderStartedAt === null ? current : { ...current, leaderStartedAt: null },
    );
  }, [dialogKey]);

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

  const { focus: resolvedFocus, focusedPaneId } = resolveShellFocus({
    focus: state.focus,
    lastWorkbenchPaneId: state.lastWorkbenchPaneId,
    paneIds: currentPaneIds,
    undersized,
  });
  const nativeTarget = focusTargetFor(nativeFocus);
  const focus = state.dialog === null ? (nativeTarget ?? resolvedFocus) : resolvedFocus;
  const resolvedFocusKey = focusKey(resolvedFocus);

  useLayoutEffect(() => {
    if (dialogKey === null) {
      focusShellTarget(renderer, resolvedFocus);
    }
  }, [renderer, resolvedFocusKey, dialogKey]);

  useLayoutEffect(() => {
    // Projection must retain both resize restoration and a split awaiting its snapshot.
    const transientWorkbenchProjection =
      state.focus.region === "workbench" &&
      (undersized || state.pendingWorkbenchFocus !== null) &&
      nativeTarget?.region === "tabs";
    if (
      state.dialog === null &&
      nativeTarget !== null &&
      nativeFocus === renderer.currentFocusedRenderable &&
      !transientWorkbenchProjection
    ) {
      dispatch({ type: "focus.set", focus: nativeTarget });
    }
  }, [nativeFocus, dialogKey, undersized, state.focus, state.pendingWorkbenchFocus]);
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

  function setFocus(
    target: FocusTarget,
    pendingWorkbenchFocus?: NonNullable<typeof state.pendingWorkbenchFocus>,
  ): void {
    if (target.region === "workbench") {
      lastWorkbenchPaneIdRef.current = target.paneId;
    }
    if (state.dialog === null) {
      focusShellTarget(renderer, target);
    }
    dispatch({ type: "focus.set", focus: target, pendingWorkbenchFocus });
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
      setFocus,
      setSessionCursorId,
      run: runCommand,
      reload: workCraft.reload,
      quit: () => renderer.destroy(),
      ...overrides,
    });
  }

  useKeyboard((key) => {
    const keyFocus = focusTargetFor(renderer.currentFocusedRenderable) ?? focus;
    if (keyFocus.region === "workbench") {
      lastWorkbenchPaneIdRef.current = keyFocus.paneId;
    }
    const keyPaneId = keyFocus.region === "workbench" ? keyFocus.paneId : focusedPaneId;
    const keyState = {
      ...state,
      focus: keyFocus,
      lastWorkbenchPaneId: lastWorkbenchPaneIdRef.current,
    };
    const keyContext: CommandContext = {
      ...commandContext,
      focus: keyFocus,
      availableCommands: availableCommands({
        model,
        state: keyState,
        snapshot,
        focus: keyFocus,
        focusedPaneId: keyPaneId,
      }),
    };
    const modalEndpoint = dialogKey === null ? null : scope.repair();
    if (
      dialogKey !== null &&
      key.name === "tab" &&
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      !key.super &&
      !key.hyper
    ) {
      key.preventDefault();
      key.stopPropagation();
      scope.move(key.shift ? -1 : 1);
      return;
    }
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
    const routed = routeKey(routerState, keyLike, keyContext, Date.now());
    setRouterState(routed.state);
    // During modal replacement, unhandled input must not reach a retained terminal.
    if (!routed.handled && (dialogKey === null || modalEndpoint !== null)) {
      return;
    }
    key.preventDefault();
    key.stopPropagation();
    if (routed.passthroughLeader) {
      if (keyFocus.region === "workbench") {
        terminalRefs.current.get(keyFocus.paneId)?.handleKeyPress(key);
      }
    } else if (routed.command !== undefined) {
      void execute(routed.command, { state: keyState, focus: keyFocus, focusedPaneId: keyPaneId });
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
          state.dialog === null && navigatorMode === "compact" && focus.region === "navigator",
        );
  const modalRoot =
    state.dialog === null ? null : renderer.root.findDescendantById("dialog-overlay");
  const currentTarget = renderer.currentFocusedRenderable;
  const eligibleControlHints =
    mode === "HINTS" &&
    (state.dialog === null ||
      (modalRoot && currentTarget && isEligibleFocusTarget(currentTarget, modalRoot)))
      ? controlHints
      : [];
  const hints = [
    ...new Map(
      [...commandHints(routerState, commandContext), ...eligibleControlHints].map(
        (hint) => [`${hint.keys}\u0000${hint.label}`, hint] as const,
      ),
    ).values(),
  ];
  const statusProps: StatusBarProps =
    mode === "INFO"
      ? { mode: "INFO", text: routerState.invalidMessage ?? cursorEntry?.label ?? "" }
      : { mode, hints, text: routerState.invalidMessage ?? undefined };
  const workspaceProps = {
    activeId: state.activeWorkspaceId,
    cursorId: state.workspaceCursorId,
    focused: state.dialog === null && focus.region === "workspace",
    hasNext: viewport.hasNext,
    hasPrevious: viewport.hasPrevious,
    visibleIds: viewport.ids,
    width: workspaceWidth,
    workspaces,
    onActivate: (id: string) => {
      setFocus({ region: "workspace" });
      dispatch({ type: "workspace.activate", id });
      reconcile();
    },
    onFocus: (id: string) => {
      setFocus({ region: "workspace" });
      dispatch({ type: "workspace.cursor", id });
    },
  };
  const sessionProps = {
    focused: state.dialog === null && focus.region === "session",
    name: activeSession?.name ?? null,
    status: workCraft.status,
    width: sessionWidth,
    onOpen: () =>
      void execute("session.open", {
        focus: focusTargetFor(renderer.currentFocusedRenderable) ?? focus,
      }),
  };
  const categoryProps = {
    active: state.activeCategory,
    categories: renderedCategories,
    cursor: state.categoryCursor,
    focused: state.dialog === null && focus.region === "category",
    onActivate: (category: CategoryKind) => {
      setFocus({ region: "category" });
      dispatch({ type: "category.activate", category });
      reconcile();
    },
    onFocus: (category: CategoryKind) => {
      setFocus({ region: "category" });
      dispatch({ type: "category.cursor", category });
    },
  };
  const navigatorProps = !navigatorVisible
    ? null
    : {
        activeKey: state.activeNavigatorKey,
        cursorKey: state.navigatorCursorKey,
        entries,
        expandedProjectIds: state.expandedProjectIds,
        onExpand: (projectId: string, expanded: boolean) => {
          if (expandedProjectIdsRef.current.has(projectId) !== expanded) {
            const next = new Set(expandedProjectIdsRef.current);
            if (expanded) {
              next.add(projectId);
            } else {
              next.delete(projectId);
            }
            expandedProjectIdsRef.current = next;
            dispatch({ type: "project.toggle", projectId });
            reconcile();
          }
        },
        error: state.errors.navigator ?? null,
        focused: state.dialog === null && focus.region === "navigator",
        height: workbenchHeight,
        mode: navigatorMode === "hidden" ? "compact" : navigatorMode,
        title: activeCategoryTitle,
        width: navigatorWidth,
        onActivate: (key: string) => {
          setFocus({ region: "navigator" });
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
          setFocus({ region: "navigator" });
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
    tabsFocused: state.dialog === null && focus.region === "tabs",
    terminals: workCraft.terminals,
    undersized,
    workbenchError: state.errors.workbench ?? null,
    workbenchFocused: state.dialog === null && focus.region === "workbench",
    onActivateTab: (id: string) => {
      setFocus({ region: "tabs" });
      dispatch({ type: "tab.cursor", id });
      void execute("cursor.activate", {
        model: { ...model, tabCursorIndex: tabs.findIndex((tab) => tab.id === id) },
        focus: { region: "tabs" },
      });
    },
    onFocusTab: (id: string) => {
      setFocus({ region: "tabs" });
      dispatch({ type: "tab.cursor", id });
    },
    onFocusPane: (paneId: string) => setFocus({ region: "workbench", paneId }),
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

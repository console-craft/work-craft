import { homedir } from "node:os";

import { CliRenderEvents, type EmbeddedTerminalRenderable, type Renderable } from "@opentui/core";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
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
  type RouterState,
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
import type { ShellEnvironment } from "@/shell/context";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { commandSourceKey, statusPresentation } from "@/shell/errors.ts";
import { focusShellTarget, focusTargetFor, nativeFocusId } from "@/shell/focus.ts";
import { Header } from "@/shell/header.tsx";
import { calculateShellLayout } from "@/shell/layout.ts";
import { deriveShellModel, resolveShellFocus } from "@/shell/model.ts";
import { ResizeGuard } from "@/shell/resize-guard.tsx";
import {
  createInitialShellState,
  type DialogState,
  reduceShellState,
  type ShellAction,
} from "@/shell/state.ts";
import { StatusBar, type StatusBarProps } from "@/shell/status-bar.tsx";
import { useShellErrors } from "@/shell/use-shell-errors";
import {
  type PaneEntryHandle,
  type TabEntryHandle,
  useTerminalEntry,
  useTerminalEntryCompletion,
} from "@/shell/use-terminal-entry";
import { useFocusedControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager.tsx";
import { focusRenderable, isEligibleFocusTarget, moveFocus } from "@/ui/focus-utils";
import { getActiveModalFocusScope } from "@/ui/modal-focus";
import { Box } from "@/ui/primitives/box.tsx";
import { HStack } from "@/ui/primitives/hstack.tsx";
import { Stack } from "@/ui/primitives/stack.tsx";
import {
  hasRecoveryViewport,
  hasTerminalViewport,
  projectPaneLayout,
  terminalRect,
} from "@/workbench/layout.ts";
import { paneNotice } from "@/workbench/pane-state.ts";
import { Workbench } from "@/workbench/workbench.tsx";

export type WorkCraftShellProps = { workCraft: WorkCraftState };

export function WorkCraftShell({ workCraft }: WorkCraftShellProps): ReactNode {
  const renderer = useRenderer();
  const nativeFocus = useNativeFocus();
  const controlHints = useFocusedControlHints();
  const dimensions = useTerminalDimensions();
  const homePath = useRef(homedir()).current;
  const [state, renderDispatch] = useReducer(reduceShellState, undefined, () =>
    createInitialShellState(renderer.width),
  );
  const liveState = useRef(state);
  useLayoutEffect(() => {
    liveState.current = state;
  }, [state]);
  const presentationGeneration = useRef(0);
  const drawerReturn = useRef<Renderable | null>(null);
  const guardReturn = useRef<Renderable | null>(null);
  const lastNavigatorControl = useRef<"filter" | "results">("results");
  function dispatch(action: ShellAction): void {
    const previous = liveState.current;
    const next = reduceShellState(previous, action);
    if (!previous.navigatorOpen && next.navigatorOpen && renderer.width < 120) {
      drawerReturn.current = renderer.currentFocusedRenderable;
    }
    if (
      action.type === "dialog.open" ||
      action.type === "navigator.toggle" ||
      action.type === "navigator.hide" ||
      action.type === "navigator.reveal" ||
      action.type === "presentation.resize"
    ) {
      presentationGeneration.current += 1;
    }
    liveState.current = next;
    renderDispatch(action);
  }
  // Pane memory must advance before a buffered key leaves and re-enters the workbench.
  const lastPaneByTabRef = useRef(state.lastPaneByTab);
  useLayoutEffect(() => {
    lastPaneByTabRef.current = state.lastPaneByTab;
  }, [state.lastPaneByTab]);
  const expandedRootIdsRef = useRef(state.expandedRootIds);
  useLayoutEffect(() => {
    expandedRootIdsRef.current = state.expandedRootIds;
  }, [state.expandedRootIds]);
  const [routerState, setRouterState] = useState(initialRouterState);
  const routerStateRef = useRef(routerState);
  function updateRouterState(next: RouterState): void {
    // Native input can contain several keys before React commits.
    routerStateRef.current = next;
    setRouterState(next);
  }
  const [reactivatingPaneIds, setReactivatingPaneIds] = useState<ReadonlySet<string>>(new Set());
  const reactivatingPaneIdsRef = useRef(
    new Map<string, { epoch: string; revision: number | null }>(),
  );
  const entry = useTerminalEntry({
    read: readEnvironment,
    rendered: () => environment,
    dispatch,
    nextRequestId: () => ++operationSequence.current,
    run: (...args) => runCommand(...args),
    setFocus,
    canReceiveInput: canReceiveWorkbenchInput,
    canReactivate,
    onNativeFocus(target) {
      const focus = focusTargetFor(target);
      if (focus?.region === "navigator") {
        lastNavigatorControl.current = focus.control ?? "results";
      }
    },
  });
  const completionContextRef = useRef<CompletionContext>({
    key: "",
    navigationKey: "",
    dialog: null,
  });
  const submittingDialogRef = useRef<Exclude<DialogState, null> | null>(null);
  const snapshot = workCraft.snapshot;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const operationSequence = useRef(0);
  const sourceOperations = useRef(new Map<string, number>());
  const errors = useShellErrors({
    snapshot,
    connectionError: workCraft.connectionError,
    error: state.operationalError,
    dispatch,
    nextRequestId: () => ++operationSequence.current,
  });

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
      const current = routerStateRef.current;
      if (current.invalidMessageUntil === routerState.invalidMessageUntil) {
        updateRouterState({ ...current, invalidMessage: null, invalidMessageUntil: null });
      }
    }, delay);
    return () => clearTimeout(timeout);
  }, [routerState.invalidMessageUntil]);

  const model = deriveShellModel({ snapshot, state });
  const {
    activeCategoryTitle,
    activeSession,
    activeTab,
    categories: renderedCategories,
    entries,
    paneIds: currentPaneIds,
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
        : state.dialog.kind === "archive"
          ? `archive:${state.dialog.itemId}`
          : `create:${state.dialog.createKind}`;
  useLayoutEffect(() => {
    const current = routerStateRef.current;
    if (current.leaderStartedAt !== null) {
      updateRouterState({ ...current, leaderStartedAt: null });
    }
  }, [dialogKey]);

  const paneLayout = activeTab?.layout ?? null;
  const workbenchFailed = Object.keys(state.sourceFailures).some(
    (key) =>
      key.startsWith(`${surface?.id}:`) || currentPaneIds.some((id) => key.startsWith(`${id}:`)),
  );
  const shellLayout = calculateShellLayout({
    terminalWidth: dimensions.width,
    terminalHeight: dimensions.height,
    navigatorOpen: state.navigatorOpen,
    preferredNavigatorWidth: state.navigatorWidth,
    paneLayout,
    panes: snapshot?.panes,
    connected: workCraft.status === "connected",
  });
  const { focusNodes, navigatorMode, navigatorVisible, navigatorWidth, resizeBlocked, undersized } =
    shellLayout;
  const environment: ShellEnvironment = {
    snapshot,
    state,
    model,
    layout: shellLayout,
    connected: workCraft.status === "connected",
  };
  function readEnvironment(): ShellEnvironment {
    const snapshot = snapshotRef.current;
    const state = liveState.current;
    const model = deriveShellModel({ snapshot, state });
    return {
      snapshot,
      state,
      model,
      connected: workCraft.status === "connected",
      layout: calculateShellLayout({
        terminalWidth: renderer.width,
        terminalHeight: renderer.height,
        navigatorOpen: state.navigatorOpen,
        preferredNavigatorWidth: state.navigatorWidth,
        paneLayout: model.activeTab?.layout ?? null,
        panes: snapshot?.panes,
        connected: workCraft.status === "connected",
      }),
    };
  }
  function canReceiveWorkbenchInput(paneId?: string): boolean {
    const local = liveState.current;
    if (
      renderer.width < 80 ||
      local.dialog !== null ||
      (renderer.width < 120 && local.navigatorOpen) ||
      entry.isClosingDrawer()
    ) {
      return false;
    }
    if (paneId === undefined) {
      return true;
    }
    const currentModel = deriveShellModel({ snapshot: snapshotRef.current, state: local });
    if (!currentModel.activeTab?.layout) {
      return false;
    }
    const layout = calculateShellLayout({
      terminalWidth: renderer.width,
      terminalHeight: renderer.height,
      navigatorOpen: local.navigatorOpen,
      preferredNavigatorWidth: local.navigatorWidth,
      paneLayout: currentModel.activeTab?.layout ?? null,
    });
    const node = projectPaneLayout(
      currentModel.activeTab.layout,
      layout.workbenchContent,
    ).panes.find((node) => node.paneId === paneId);
    const pane = snapshotRef.current?.panes.find((pane) => pane.id === paneId);
    const viewport =
      node &&
      terminalRect(
        node.rect,
        pane !== undefined &&
          paneNotice(pane.processStatus, workCraft.status === "connected") !== null,
      );
    return (
      !currentModel.activeItem?.archived &&
      !snapshotRef.current?.items.some(
        (item) => item.id === currentModel.activeItem?.parentId && item.archived,
      ) &&
      currentModel.paneIds.includes(paneId) &&
      !layout.undersized &&
      viewport !== undefined &&
      hasTerminalViewport(viewport) &&
      workCraft.canSendInput(paneId, snapshot?.epoch ?? "")
    );
  }
  function canReactivate(paneId: string): boolean {
    if (
      !canReceiveWorkbenchInput() ||
      reactivatingPaneIdsRef.current.has(paneId) ||
      !workCraft.canReactivate(paneId, snapshotRef.current?.epoch ?? "")
    ) {
      return false;
    }
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: liveState.current,
    });
    if (!currentModel.activeTab?.layout || !currentModel.paneIds.includes(paneId)) {
      return false;
    }
    const layout = calculateShellLayout({
      terminalWidth: renderer.width,
      terminalHeight: renderer.height,
      navigatorOpen: liveState.current.navigatorOpen,
      preferredNavigatorWidth: liveState.current.navigatorWidth,
      paneLayout: currentModel.activeTab.layout,
    });
    const node = projectPaneLayout(
      currentModel.activeTab.layout,
      layout.workbenchContent,
    ).panes.find((node) => node.paneId === paneId);
    return !layout.undersized && node !== undefined && hasRecoveryViewport(node.rect);
  }
  useLayoutEffect(() => {
    const onResize = () => {
      if (renderer.width < 80) {
        guardReturn.current ??= renderer.currentFocusedRenderable;
        entry.cancelInput();
        updateRouterState({ ...routerStateRef.current, leaderStartedAt: null });
        renderer.currentFocusedRenderable?.blur();
      }
      dispatch({ type: "presentation.resize", width: renderer.width });
    };
    renderer.on(CliRenderEvents.RESIZE, onResize);
    return () => {
      renderer.off(CliRenderEvents.RESIZE, onResize);
    };
  }, [renderer]);
  const previousMode = useRef(shellLayout.navigatorMode);
  useLayoutEffect(() => {
    const previous = previousMode.current;
    previousMode.current = navigatorMode;
    if (resizeBlocked) {
      return;
    }
    if (guardReturn.current) {
      const target = guardReturn.current;
      guardReturn.current = null;
      if (isEligibleFocusTarget(target, renderer.root)) {
        focusRenderable(renderer, target);
      }
    } else if (navigatorMode === "drawer" && previous !== "drawer" && state.dialog === null) {
      focusShellTarget(renderer, { region: "navigator" });
    } else if (previous === "drawer" && navigatorMode === "hidden" && !entry.isClosingDrawer()) {
      const target = drawerReturn.current;
      const generation = presentationGeneration.current;
      queueMicrotask(() => {
        if (
          generation !== presentationGeneration.current ||
          liveState.current.dialog ||
          renderer.width < 80 ||
          liveState.current.navigatorOpen
        ) {
          return;
        }
        if (target && isEligibleFocusTarget(target, renderer.root)) {
          focusRenderable(renderer, target);
        } else {
          focusShellTarget(renderer, { region: "category" });
        }
      });
    }
  }, [navigatorMode, resizeBlocked, state.dialog]);

  useEffect(() => {
    if (
      !navigatorVisible &&
      state.focus.region === "navigator" &&
      liveState.current.focus.region === "navigator" &&
      !entry.isClosingDrawer()
    ) {
      dispatch({ type: "focus.set", focus: { region: "category" } });
    }
  }, [navigatorVisible, state.focus.region]);

  const { focus: resolvedFocus, focusedPaneId } = resolveShellFocus({
    focus: entry.focusFor(model, state.focus),
    rememberedPaneId: state.lastPaneByTab[activeTab?.id ?? ""] ?? null,
    paneIds: currentPaneIds,
    runningPaneIds: currentPaneIds.filter((id) =>
      snapshot?.panes.some((pane) => pane.id === id && pane.processStatus === "running"),
    ),
    reactivatePaneIds: currentPaneIds.filter(canReactivate),
    undersized,
  });
  const nativeTarget = focusTargetFor(nativeFocus);
  // A measured host needs another frame before a resize-restored terminal is focusable.
  const transientWorkbenchProjection =
    state.focus.region === "workbench" &&
    nativeTarget?.region === "tabs" &&
    (undersized ||
      (resolvedFocus.region === "workbench" &&
        !(
          resolvedFocus.control === "reactivate"
            ? renderer.root.findDescendantById(nativeFocusId(resolvedFocus))
            : entry.terminal(resolvedFocus.paneId)
        )?.focusable));
  const focus =
    state.dialog === null && !transientWorkbenchProjection
      ? (nativeTarget ?? resolvedFocus)
      : resolvedFocus;
  const resolvedFocusKey = focusKey(resolvedFocus);

  useLayoutEffect(() => {
    if (
      dialogKey === null &&
      !resizeBlocked &&
      !(
        navigatorMode === "drawer" &&
        (resolvedFocus.region === "workbench" || resolvedFocus.region === "tabs")
      )
    ) {
      entry.projectFocus(resolvedFocus, () => focusShellTarget(renderer, resolvedFocus));
    }
  }, [renderer, resolvedFocusKey, dialogKey, resizeBlocked]);

  useLayoutEffect(() => {
    if (
      state.dialog === null &&
      nativeTarget !== null &&
      (nativeTarget.region !== "workbench" || currentPaneIds.includes(nativeTarget.paneId)) &&
      nativeFocus === renderer.currentFocusedRenderable &&
      !transientWorkbenchProjection
    ) {
      dispatch({ type: "focus.set", focus: nativeTarget, tabId: activeTab?.id });
    }
  }, [nativeFocus, dialogKey, undersized, state.focus]);
  const completionContext = completionContextFor(model, state.dialog);

  function reconcileRestartProtection(): void {
    const currentSnapshot = snapshotRef.current;
    let changed = false;
    for (const [paneId, restart] of reactivatingPaneIdsRef.current) {
      if (
        workCraft.status !== "connected" ||
        currentSnapshot?.epoch !== restart.epoch ||
        (restart.revision !== null && currentSnapshot.revision >= restart.revision)
      ) {
        reactivatingPaneIdsRef.current.delete(paneId);
        changed = true;
      }
    }
    if (changed) {
      setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
    }
  }

  useLayoutEffect(() => {
    reconcileRestartProtection();
  }, [snapshot, workCraft.status]);

  useLayoutEffect(() => {
    entry.contextChanged(workCraft.status === "connected");
  }, [completionContext.navigationKey, dialogKey, workCraft.status]);

  useLayoutEffect(() => {
    completionContextRef.current = completionContext;
  }, [completionContext.key, completionContext.navigationKey, completionContext.dialog]);
  const structuralCommands = availableCommands({ model, state, snapshot, focus, focusedPaneId });

  const commandContext: CommandContext = {
    focus,
    dialog: state.dialog?.kind,
    connected: workCraft.status === "connected",
    availableCommands: structuralCommands,
    drawerOpen: navigatorMode === "drawer",
    resizeBlocked,
  };

  const runCommand: ExecuteCommandInput["run"] = (
    command,
    region,
    expected = completionContextRef.current,
  ) => {
    if (command.type === "surface.ensure" && expected.key === undefined) {
      // Activation owns this navigation change before React commits its reducer action.
      completionContextRef.current = expected;
    }
    const id =
      "itemId" in command
        ? command.itemId
        : "paneId" in command
          ? command.paneId
          : "surfaceId" in command
            ? command.surfaceId
            : region;
    const sourceKey = commandSourceKey(command, region);
    const requestId = ++operationSequence.current;
    const entryIsCurrent = entry.commandStarted(command);
    sourceOperations.current.set(sourceKey, requestId);
    const label =
      snapshot?.items.find((item) => item.id === id)?.title ??
      snapshot?.panes.find((pane) => pane.id === id)?.title ??
      (state.dialog?.kind === "create" ? "Create" : (model.activeItem?.title ?? region));
    return runDurableCommand({
      command,
      region,
      expected,
      current: () =>
        completionContextFor(
          deriveShellModel({ snapshot: snapshotRef.current, state: liveState.current }),
          liveState.current.dialog,
        ),
      send: async (command) => {
        const restart =
          command.type === "process.restart"
            ? reactivatingPaneIdsRef.current.get(command.paneId)
            : undefined;
        const response = await workCraft.command(command);
        // RPC success owns protection even when newer input cancelled its focus handoff.
        if (restart) {
          restart.revision = response.revision;
        }
        return response;
      },
      dispatch,
      source: {
        key: sourceKey,
        label,
        requestId,
        epoch: snapshot?.epoch ?? "",
        isCurrent: () => sourceOperations.current.get(sourceKey) === requestId && entryIsCurrent(),
      },
    });
  };

  function reconcile(): void {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot });
    }
  }

  function setFocus(target: FocusTarget): void {
    if (target.region === "navigator" && target.control === undefined) {
      target = { ...target, control: lastNavigatorControl.current };
    }
    if (
      renderer.width < 80 ||
      ((target.region === "workbench" || target.region === "tabs") && !canReceiveWorkbenchInput())
    ) {
      return;
    }
    if (target.region === "workbench") {
      const currentModel = deriveShellModel({
        snapshot: snapshotRef.current,
        state: liveState.current,
      });
      if (
        currentModel.activeItem?.archived ||
        snapshotRef.current?.items.some(
          (item) => item.id === currentModel.activeItem?.parentId && item.archived,
        )
      ) {
        return;
      }
      if (activeTab) {
        lastPaneByTabRef.current = { ...lastPaneByTabRef.current, [activeTab.id]: target.paneId };
      }
      if (
        !(target.control === "reactivate"
          ? canReactivate(target.paneId)
          : canReceiveWorkbenchInput(target.paneId))
      ) {
        if (activeTab && currentModel.paneIds.includes(target.paneId)) {
          // Logical selection remains available even when native terminal input is prohibited.
          dispatch({ type: "focus.set", focus: target, tabId: activeTab.id });
        }
        target = { region: "tabs" };
      }
    }
    if (state.dialog === null) {
      focusShellTarget(renderer, target);
    }
    dispatch({ type: "focus.set", focus: target, tabId: activeTab?.id });
  }

  function execute(
    command: CommandId,
    overrides: Partial<
      Pick<ExecuteCommandInput, "model" | "state" | "focus" | "focusedPaneId" | "onItemOpened">
    > = {},
  ): Promise<void> {
    const currentState = liveState.current;
    const currentModel = deriveShellModel({ snapshot, state: currentState });
    const enteringPanes =
      command === "focus.right" &&
      (overrides.focus ?? focus).region === "navigator" &&
      focusNodes.some(
        ({ target, rect }) => target.region === "workbench" && hasTerminalViewport(rect),
      );
    // Navigator entry targets usable content; the strip remains reachable vertically.
    const nodes = focusNodes.filter(
      ({ target }) =>
        (!enteringPanes || target.region !== "tabs") &&
        (target.region !== "workbench" ||
          target.control !== "reactivate" ||
          canReactivate(target.paneId)),
    );
    for (const region of ["workspace", "session"] as const) {
      const node = renderer.root.findDescendantById(`region:${region}`);
      if (node && isEligibleFocusTarget(node, renderer.root)) {
        nodes.push({
          target: { region },
          rect: { x: node.screenX, y: node.screenY, width: node.width, height: node.height },
        });
      }
    }
    const restartPaneId =
      command === "pane.restart" ? (overrides.focusedPaneId ?? focusedPaneId) : null;
    if (restartPaneId && reactivatingPaneIdsRef.current.has(restartPaneId)) {
      return Promise.resolve();
    }
    if (
      restartPaneId &&
      focusTargetFor(renderer.currentFocusedRenderable)?.region === "workbench"
    ) {
      // Transfer our own origin before pending state disables the initiating action.
      setFocus({ region: "tabs" });
    }
    const restartEntry = restartPaneId
      ? entry.startPaneCommand("restart", restartPaneId)
      : undefined;
    let commandEntry: PaneEntryHandle | TabEntryHandle | undefined = restartEntry;
    const restart = restartPaneId
      ? {
          epoch: snapshotRef.current?.epoch ?? "",
          revision: null as number | null,
        }
      : null;
    if (restartPaneId && restart) {
      reactivatingPaneIdsRef.current.set(restartPaneId, restart);
      setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
    }
    return executeCommand({
      command,
      model: currentModel,
      state: currentState,
      snapshot,
      focus,
      focusedPaneId,
      focusNodes: nodes,
      terminalWidth: dimensions.width,
      dispatch,
      setFocus,
      onItemOpened: undefined,
      onTabSelectionStarted: (id) => entry.startTabSelection(id).complete,
      onTabCreateStarted: () => {
        const handle = entry.startTabSelection(undefined, false, true);
        commandEntry = handle;
        return (tabId, paneId, revision) => handle.complete(revision, tabId, paneId);
      },
      onPaneRestarted: restartEntry?.complete,
      onPaneSplitStarted: () => {
        const handle = entry.startPaneCommand("split");
        commandEntry = handle;
        return handle.complete;
      },
      run: runCommand,
      reload: workCraft.reload,
      quit: () => renderer.destroy(),
      ...overrides,
    }).finally(() => {
      if (restartPaneId) {
        if (reactivatingPaneIdsRef.current.get(restartPaneId) === restart) {
          if (restart?.revision === null) {
            reactivatingPaneIdsRef.current.delete(restartPaneId);
            setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
          } else {
            reconcileRestartProtection();
          }
        }
      }
      commandEntry?.finish();
    });
  }

  function reactivatePane(paneId: string): void {
    if (!canReactivate(paneId)) {
      return;
    }
    const target: FocusTarget = { region: "workbench", paneId, control: "reactivate" };
    setFocus(target);
    void execute("pane.restart", { focus: target, focusedPaneId: paneId });
  }

  useTerminalEntryCompletion(entry, environment, focusedPaneId, nativeFocus);

  usePaste(() => entry.cancelInput());

  useKeyboard((key) => {
    // Further input supersedes a deferred handoff; local activation can start a new one.
    const duplicateSubmit =
      submittingDialogRef.current !== null &&
      liveState.current.dialog === submittingDialogRef.current &&
      ["return", "enter", "linefeed"].includes(key.name) &&
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      !key.super &&
      !key.hyper &&
      !key.shift;
    if (!duplicateSubmit) {
      entry.cancelInput();
    }
    const keyFocus = focusTargetFor(renderer.currentFocusedRenderable) ?? focus;
    if (keyFocus.region === "workbench") {
      if (activeTab) {
        lastPaneByTabRef.current = { ...lastPaneByTabRef.current, [activeTab.id]: keyFocus.paneId };
      }
    }
    const keyPaneId = keyFocus.region === "workbench" ? keyFocus.paneId : focusedPaneId;
    const keyState = {
      ...liveState.current,
      focus: keyFocus,
      lastPaneByTab: lastPaneByTabRef.current,
    };
    const keyModel = deriveShellModel({ snapshot, state: keyState });
    const keyContext: CommandContext = {
      ...commandContext,
      focus: keyFocus,
      navigatorControl:
        keyFocus.region === "navigator" ? (keyFocus.control ?? "results") : undefined,
      resizeBlocked: renderer.width < 80,
      drawerOpen: renderer.width >= 80 && renderer.width < 120 && liveState.current.navigatorOpen,
      availableCommands: availableCommands({
        model: keyModel,
        state: keyState,
        snapshot,
        focus: keyFocus,
        focusedPaneId: keyPaneId,
      }),
    };
    const modal = dialogKey === null ? null : getActiveModalFocusScope();
    const modalEndpoint = modal?.controller.repair() ?? null;
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
    const routed = routeKey(routerStateRef.current, keyLike, keyContext, Date.now());
    updateRouterState(routed.state);
    if (
      !routed.handled &&
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
      modal?.controller.move(key.shift ? -1 : 1);
      return;
    }
    if (
      !routed.handled &&
      dialogKey === null &&
      (keyFocus.region === "workspace" || keyFocus.region === "session") &&
      key.name === "tab" &&
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      !key.super &&
      !key.hyper
    ) {
      key.preventDefault();
      key.stopPropagation();
      const header = renderer.root.findDescendantById("shell-header");
      if (header) {
        moveFocus(renderer, key.shift ? -1 : 1, header);
      }
      return;
    }
    // During modal replacement, unhandled input must not reach a retained terminal.
    if (!routed.handled && (dialogKey === null || modalEndpoint !== null)) {
      return;
    }
    key.preventDefault();
    key.stopPropagation();
    if (routed.passthroughLeader) {
      if (
        keyFocus.region === "workbench" &&
        !keyFocus.control &&
        canReceiveWorkbenchInput(keyFocus.paneId)
      ) {
        entry.terminal(keyFocus.paneId)?.handleKeyPress(key);
      }
    } else if (routed.command !== undefined) {
      void execute(routed.command, {
        model: keyModel,
        state: keyState,
        focus: keyFocus,
        focusedPaneId: keyPaneId,
      });
    }
  });

  function handleCreate(value: string): Promise<void> {
    const currentState = liveState.current;
    if (
      currentState.dialog?.kind !== "create" ||
      submittingDialogRef.current === currentState.dialog
    ) {
      return Promise.resolve();
    }
    return submitCreate({
      value,
      model,
      state: currentState,
      snapshot,
      getSubmittingDialog: () => submittingDialogRef.current,
      setSubmittingDialog: (dialog) => {
        submittingDialogRef.current = dialog;
      },
      dispatch,
      run: runCommand,
      onItemCreated: entry.createdItemHandler(currentState.dialog),
    });
  }

  const presentation = statusPresentation({
    leaderActive: routerState.leaderStartedAt !== null,
    invalidMessage: routerState.invalidMessage,
    invalidMessageUntil: routerState.invalidMessageUntil,
    operationalError: state.operationalError,
    now: errors.now,
  });
  const mode = presentation.mode;
  const modalRoot = state.dialog === null ? null : getActiveModalFocusScope()?.root;
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
  const statusProps: StatusBarProps = { mode, hints, text: presentation.text };
  const workspaceProps = {
    activeId: state.activeWorkspaceId,
    focused: state.dialog === null && focus.region === "workspace",
    workspaces,
    onActivate: (id: string) => {
      if (renderer.width < 80) {
        return;
      }
      dispatch({ type: "workspace.activate", id });
      reconcile();
      setFocus({ region: "category" });
    },
  };
  const sessionProps = {
    focused: state.dialog === null && focus.region === "session",
    name: activeSession?.name ?? null,
    status: workCraft.status,
    onOpen: () =>
      renderer.width >= 80 &&
      void execute("session.open", {
        focus: focusTargetFor(renderer.currentFocusedRenderable) ?? focus,
      }),
  };
  const categoryProps = {
    active: state.activeCategory,
    categories: renderedCategories,
    focused: state.dialog === null && focus.region === "category",
    onActivate: (category: CategoryKind) => {
      if (renderer.width < 80) {
        return;
      }
      dispatch({ type: "category.activate", category });
      reconcile();
      dispatch({ type: "navigator.reveal" });
      const destination = calculateShellLayout({
        terminalWidth: dimensions.width,
        terminalHeight: dimensions.height,
        navigatorOpen: true,
        preferredNavigatorWidth: state.navigatorWidth,
        paneLayout,
      });
      setFocus({ region: destination.navigatorVisible ? "navigator" : "category" });
    },
  };
  const navigatorProps = {
    activeItemId: model.activeItem?.id ?? null,
    initialCursorId: entries.find((entry) => entry.key === state.navigatorCursorKey)?.id ?? null,
    entries: entries.map((entry) => ({
      ...entry,
      failed: Object.keys(state.sourceFailures).some((key) => key.startsWith(`${entry.id}:`)),
    })),
    query: state.navigatorQuery,
    homePath,
    onQueryChange: (query: string) => {
      entry.cancel();
      dispatch({ type: "navigator.query", query });
    },
    onInteraction: () => {
      entry.cancel();
    },
    onExpand: (rootId: string, expanded: boolean) => {
      if (renderer.width < 80 || !liveState.current.navigatorOpen || liveState.current.dialog) {
        return;
      }
      entry.cancel();
      if (expandedRootIdsRef.current.has(rootId) !== expanded) {
        const next = new Set(expandedRootIdsRef.current);
        if (expanded) {
          next.add(rootId);
        } else {
          next.delete(rootId);
        }
        expandedRootIdsRef.current = next;
        dispatch({ type: "root.toggle", rootId });
        reconcile();
      }
    },
    interactive: navigatorVisible && !resizeBlocked && state.dialog === null,
    focusedControl:
      state.dialog === null && focus.region === "navigator" ? (focus.control ?? "results") : null,
    height: shellLayout.body.height,
    title: activeCategoryTitle,
    width: navigatorWidth,
    onActivate: (id: string) => {
      if (renderer.width < 80 || !liveState.current.navigatorOpen || liveState.current.dialog) {
        return;
      }
      setFocus({ region: "navigator" });
      entry.cancel();
      void execute("cursor.activate", {
        model: {
          ...model,
          navigatorCursorIndex: entries.findIndex((entry) => entry.id === id),
        },
        focus: { region: "navigator" },
        focusedPaneId: null,
        onItemOpened: entry.startItemOpen(),
      });
    },
    onCursorChange: (id: string | null) => {
      // List reconciliation during our close is projection, not a new browsing gesture.
      if (entry.isClosingForm()) {
        return;
      }
      const key = entries.find((entry) => entry.id === id)?.key ?? null;
      dispatch({
        type: "navigator.cursor",
        key,
      });
    },
  };
  const workbenchProps = {
    connected: workCraft.status === "connected",
    reactivatingPaneIds,
    canReactivate,
    onReactivatePane: reactivatePane,
    inputEnabled: !resizeBlocked && navigatorMode !== "drawer" && state.dialog === null,
    canReceiveInput: canReceiveWorkbenchInput,
    canResize: () => renderer.width >= 80,
    activeTabId: activeTab?.id ?? null,
    focusedPaneId,
    snapshot,
    stream: workCraft.stream,
    surface,
    tabCursorId: state.tabCursorId,
    failed: workbenchFailed,
    onSourceFailure: ({ paneId, message }: { paneId: string; message: string }) => {
      errors.reportMissingPane(paneId, message, model.navigationKey);
    },
    tabs,
    tabsFocused: state.dialog === null && focus.region === "tabs",
    terminals: workCraft.terminals,
    undersized,
    workbenchFocused:
      state.dialog === null &&
      focus.region === "workbench" &&
      !focus.control &&
      currentPaneIds.includes(focus.paneId),
    onActivateTab: (id: string) => {
      if (!canReceiveWorkbenchInput()) {
        return;
      }
      void entry.requestTabSelection(id);
    },
    onEnterTab: (id: string) => {
      void entry.enterTab(id);
    },
    entryEnabled: entry.canEnterTab(),
    onTabScrollInteraction: () => {
      entry.cancel();
    },
    onFocusTab: (id: string) => {
      if (!canReceiveWorkbenchInput()) {
        return;
      }
      if (entry.isProjectingTabFocus()) {
        dispatch({ type: "tab.cursor", id });
        return;
      }
      entry.cancel();
      setFocus({ region: "tabs" });
      dispatch({ type: "tab.cursor", id });
    },
    onFocusPane: (paneId: string) => {
      entry.cancel();
      setFocus({ region: "workbench", paneId });
    },
    onTerminalReady: (paneId: string, terminal: EmbeddedTerminalRenderable | null) => {
      entry.registerTerminal(paneId, terminal);
    },
  };
  const dialogProps =
    state.dialog === null
      ? null
      : {
          dialog: state.dialog,
          canRestoreFocus: () => entry.canRestoreFocus(state.dialog!),
          visible: !resizeBlocked,
          canCancel: state.dialog.kind === "create" || state.activeSessionId !== null,
          sessions,
          promptValue: state.promptValue,
          error: state.fieldError,
          onArchive: async () => {
            if (renderer.width < 80) {
              return;
            }
            const dialog = state.dialog;
            if (dialog?.kind !== "archive" || submittingDialogRef.current === dialog) {
              return;
            }
            const item = snapshot?.items.find((item) => item.id === dialog.itemId);
            if (
              !item ||
              item.kind === "generic" ||
              item.archived ||
              item.data.availability !== "unavailable"
            ) {
              return;
            }
            submittingDialogRef.current = dialog;
            const result = await runCommand(
              { type: "item.setArchived", itemId: item.id, archived: true },
              "navigator",
            );
            if (submittingDialogRef.current === dialog) {
              submittingDialogRef.current = null;
            }
            if (result) {
              dispatch({ type: "dialog.close" });
            }
          },
          onCreateSession: () => {
            if (renderer.width >= 80) {
              void execute("context.create");
            }
          },
          onCancel: () => {
            if (renderer.width >= 80) {
              void execute("dialog.cancel");
            }
          },
          onSelectSession: (id: string) => {
            if (renderer.width < 80) {
              return;
            }
            dispatch({ type: "session.activate", id });
            reconcile();
          },
          onPromptChange: (value: string) => {
            if (renderer.width >= 80) {
              dispatch({ type: "prompt.set", value });
            }
          },
          onPromptSubmit: (value: string) => {
            if (renderer.width >= 80) {
              void handleCreate(value);
            }
          },
        };

  return (
    <Stack
      id="work-craft-shell"
      width="100%"
      height="100%"
      gap={0}
      minHeight={0}
      overflow="hidden"
      visible={dimensions.width > 0 && dimensions.height > 0}
    >
      <Header workspace={workspaceProps} session={sessionProps} height={shellLayout.body.y} />
      <HStack
        height={shellLayout.body.height}
        visible={shellLayout.body.height > 0}
        flexShrink={0}
        minHeight={0}
        overflow="hidden"
        gap={0}
        alignItems="stretch"
      >
        <CategoryRail {...categoryProps} />
        <Box flexGrow={1} minWidth={0} height="100%">
          <Box
            position="absolute"
            top={0}
            left={navigatorMode === "docked" ? navigatorWidth : 0}
            width={shellLayout.workbenchWidth}
            height="100%"
          >
            <Workbench {...workbenchProps} />
          </Box>
          <Box
            position="absolute"
            top={0}
            left={0}
            visible={navigatorVisible}
            width={navigatorWidth}
            height="100%"
            minWidth={0}
            bg="background"
            zIndex={10}
          >
            <Navigator
              key={`${state.activeWorkspaceId}:${state.activeCategory}`}
              {...navigatorProps}
            />
          </Box>
        </Box>
      </HStack>
      <StatusBar {...statusProps} />
      {dialogProps === null ? null : <DialogOverlay {...dialogProps} />}
      {resizeBlocked ? <ResizeGuard width={dimensions.width} height={dimensions.height} /> : null}
    </Stack>
  );
}

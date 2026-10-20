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
import { navigatorItemKey } from "@/navigation/model";
import { Navigator } from "@/navigation/navigator.tsx";
import {
  availableCommands,
  type CompletionContext,
  completionContextFor,
  type DurableCommandResult,
  executeCommand,
  type ExecuteCommandInput,
  runDurableCommand,
  submitCreate,
} from "@/shell/commands.ts";
import { navigationContextKey } from "@/shell/context";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { type OperationalError, statusPresentation } from "@/shell/errors.ts";
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

type PendingTerminalEntry = {
  kind: "item" | "tab" | "restart" | "split";
  itemId: string;
  tabId?: string;
  paneId?: string;
  epoch: string;
  revision: number | null;
  navigationKey: string;
  origin: Renderable;
  version: number;
  requestId: number;
  allowReactivate?: boolean;
  creation?: {
    sourceTabId: string | undefined;
    existingTabIds: readonly string[];
    selectionAdvanced?: boolean;
  };
};

function canProjectTabEntry(
  entry: PendingTerminalEntry,
  snapshot: WorkCraftState["snapshot"],
): boolean {
  const selected = snapshot?.surfaces.find(
    (surface) => surface.itemId === entry.itemId,
  )?.activeTabId;
  if (snapshot === null || selected == null) {
    return false;
  }
  if (entry.creation && (entry.revision === null || snapshot.revision < entry.revision)) {
    return !entry.creation.existingTabIds.includes(selected);
  }
  return selected === entry.tabId;
}

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
  const entryClosing = useRef(false);
  const successfulFormCloses = useRef(new WeakSet<NonNullable<DialogState>>());
  // Only this close commit may transfer the submitted input's origin to its return endpoint.
  const formCloseOwner = useRef<{
    entry: PendingTerminalEntry;
    target: Renderable | null;
  } | null>(null);
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
  const [pendingTerminalEntry, setPendingTerminalEntry] = useState<PendingTerminalEntry | null>(
    null,
  );
  const [reactivatingPaneIds, setReactivatingPaneIds] = useState<ReadonlySet<string>>(new Set());
  const reactivatingPaneIdsRef = useRef(
    new Map<string, { epoch: string; revision: number | null }>(),
  );
  const itemFocusVersion = useRef(0);
  const tabEntryOwner = useRef<PendingTerminalEntry | null>(null);
  const latestTabRequest = useRef<{
    tabId: string;
    promise: Promise<DurableCommandResult | undefined>;
  } | null>(null);
  const projectingTabEntry = useRef(false);
  useLayoutEffect(() => {
    if (pendingTerminalEntry === null) {
      tabEntryOwner.current = null;
    }
  }, [pendingTerminalEntry]);
  useLayoutEffect(() => {
    // Even buffered leave-and-return movement permanently cancels an activation handoff.
    const cancelItemFocus = (_target?: Renderable | null, previous?: Renderable | null) => {
      const target = focusTargetFor(renderer.currentFocusedRenderable);
      if (target?.region === "navigator") {
        lastNavigatorControl.current = target.control ?? "results";
      }
      const tabEntry = tabEntryOwner.current;
      if (tabEntry?.version === itemFocusVersion.current) {
        // Only our origin becoming ineligible and our own tabs projection are not user movement.
        if (
          (renderer.currentFocusedRenderable === null &&
            previous === tabEntry.origin &&
            !isEligibleFocusTarget(tabEntry.origin, renderer.root) &&
            canProjectTabEntry(tabEntry, snapshotRef.current)) ||
          (projectingTabEntry.current && renderer.currentFocusedRenderable === tabEntry.origin)
        ) {
          return;
        }
      }
      if (
        formCloseOwner.current?.entry.version === itemFocusVersion.current &&
        liveState.current.dialog === null &&
        (renderer.currentFocusedRenderable === null ||
          renderer.currentFocusedRenderable === formCloseOwner.current.target)
      ) {
        return;
      }
      if (
        entryClosing.current &&
        (renderer.currentFocusedRenderable === null ||
          renderer.currentFocusedRenderable?.id === "region:category")
      ) {
        return;
      }
      itemFocusVersion.current += 1;
      latestTabRequest.current = null;
    };
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, cancelItemFocus);
    return () => {
      cancelItemFocus();
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, cancelItemFocus);
    };
  }, [renderer]);
  const terminalRefs = useRef(new Map<string, EmbeddedTerminalRenderable>());
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
  const [errorClock, setErrorClock] = useState(Date.now());
  useEffect(() => {
    if (!state.operationalError) {
      return;
    }
    const timeout = setTimeout(
      () => setErrorClock(Date.now()),
      Math.max(0, state.operationalError.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [state.operationalError]);
  const missingPanes = useRef(new Map<string, string>());
  useEffect(() => {
    const now = Date.now();
    const epoch = snapshot?.epoch ?? "connecting";
    const failures: OperationalError[] = [];
    function add(sourceKey: string, sourceLabel: string, operation: string, message: string): void {
      failures.push({
        sourceKey,
        sourceLabel,
        operation,
        message,
        epoch,
        contextKey: "",
        requestId: ++operationSequence.current,
        expiresAt: now + 8000,
        origin: "background",
      });
    }
    for (const item of snapshot?.items ?? []) {
      if (item.kind === "directory" && !item.archived && item.data.discoveryError) {
        add(
          `directory:${item.id}:discovery`,
          item.title,
          "Git discovery",
          item.data.discoveryError,
        );
      }
    }
    for (const pane of snapshot?.panes ?? []) {
      if (pane.processStatus === "failed") {
        add(`pane:${pane.id}:process`, pane.title, "Process", pane.errorText ?? "Process failed");
      }
    }
    if (workCraft.connectionError) {
      add("daemon:connection", "Daemon", "Connection", workCraft.connectionError);
    }
    failures.sort((a, b) => b.sourceKey.localeCompare(a.sourceKey));
    dispatch({ type: "sources.observe", epoch, failures, now });
  }, [snapshot, workCraft.connectionError]);

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
  function canReceiveWorkbenchInput(paneId?: string): boolean {
    const local = liveState.current;
    if (
      renderer.width < 80 ||
      local.dialog !== null ||
      (renderer.width < 120 && local.navigatorOpen) ||
      entryClosing.current
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
        itemFocusVersion.current += 1;
        setPendingTerminalEntry(null);
        entryClosing.current = false;
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
    } else if (previous === "drawer" && navigatorMode === "hidden" && !entryClosing.current) {
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
      !entryClosing.current
    ) {
      dispatch({ type: "focus.set", focus: { region: "category" } });
    }
  }, [navigatorVisible, state.focus.region]);

  const { focus: resolvedFocus, focusedPaneId } = resolveShellFocus({
    focus:
      tabEntryOwner.current?.version === itemFocusVersion.current &&
      tabEntryOwner.current.tabId !== undefined &&
      surface?.activeTabId === tabEntryOwner.current.tabId &&
      activeTab?.id !== tabEntryOwner.current.tabId
        ? { region: "tabs" }
        : state.focus,
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
            : terminalRefs.current.get(resolvedFocus.paneId)
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
      const owner = formCloseOwner.current;
      if (owner?.entry.version === itemFocusVersion.current) {
        owner.target = renderer.root.findDescendantById(nativeFocusId(resolvedFocus)) ?? null;
      }
      const tabEntry = tabEntryOwner.current;
      const projectTab =
        tabEntry?.version === itemFocusVersion.current &&
        canProjectTabEntry(tabEntry, snapshot) &&
        resolvedFocus.region === "tabs" &&
        (renderer.currentFocusedRenderable === tabEntry.origin ||
          (renderer.currentFocusedRenderable === null &&
            !isEligibleFocusTarget(tabEntry.origin, renderer.root)));
      if (projectTab) {
        tabEntry.origin = renderer.root.findDescendantById("region:tabs")!;
      }
      projectingTabEntry.current = resolvedFocus.region === "tabs";
      focusShellTarget(renderer, resolvedFocus);
      projectingTabEntry.current = false;
      if (owner?.entry.version === itemFocusVersion.current && renderer.currentFocusedRenderable) {
        owner.entry.origin = renderer.currentFocusedRenderable;
      }
      formCloseOwner.current = null;
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
    latestTabRequest.current = null;
    if (workCraft.status !== "connected") {
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
    }
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
    if (command.type === "surface.selectTab") {
      latestTabRequest.current = null;
    }
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
    const sourceKey = `${id}:${command.type}`;
    const requestId = ++operationSequence.current;
    const version = itemFocusVersion.current;
    const originTarget = focusTargetFor(renderer.currentFocusedRenderable);
    const guardsEntry =
      command.type === "surface.ensure" ||
      command.type === "directory.register" ||
      command.type === "item.create" ||
      command.type === "process.restart" ||
      command.type === "pane.split" ||
      command.type === "tab.create" ||
      (command.type === "surface.selectTab" &&
        originTarget?.region === "workbench" &&
        !originTarget.control &&
        tabEntryOwner.current?.version === version);
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
        isCurrent: () =>
          sourceOperations.current.get(sourceKey) === requestId &&
          (!guardsEntry || itemFocusVersion.current === version),
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
    const onPaneRestarted = restartPaneId
      ? focusOnPaneCommand("restart", restartPaneId)
      : undefined;
    let entryVersion = restartPaneId ? itemFocusVersion.current : null;
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
      onTabSelectionStarted: focusOnTabSelectionStarted,
      onTabCreateStarted: () => {
        const complete = focusOnTabSelectionStarted(undefined, false, true);
        entryVersion = itemFocusVersion.current;
        return (tabId, paneId, revision) => complete(revision, tabId, paneId);
      },
      onPaneRestarted,
      onPaneSplitStarted: () => {
        const complete = focusOnPaneCommand("split");
        entryVersion = itemFocusVersion.current;
        return complete;
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
      if (
        tabEntryOwner.current?.version === entryVersion &&
        tabEntryOwner.current.revision === null
      ) {
        tabEntryOwner.current = null;
      }
      setPendingTerminalEntry((entry) =>
        entry?.version === entryVersion && entry.revision === null ? null : entry,
      );
    });
  }

  function focusOnItemOpen(): ExecuteCommandInput["onItemOpened"] {
    const origin = renderer.currentFocusedRenderable;
    const epoch = snapshot?.epoch;
    const version = ++itemFocusVersion.current;
    const requestId = ++operationSequence.current;
    setPendingTerminalEntry(null);
    return (itemId, revision) => {
      if (
        origin !== null &&
        epoch !== undefined &&
        !renderer.isDestroyed &&
        itemFocusVersion.current === version &&
        renderer.currentFocusedRenderable === origin
      ) {
        setPendingTerminalEntry({
          kind: "item",
          itemId,
          epoch,
          revision,
          origin,
          version,
          requestId,
          navigationKey: deriveShellModel({
            snapshot: snapshotRef.current,
            state: liveState.current,
          }).navigationKey,
        });
      }
    };
  }

  function focusOnTabSelectionStarted(
    tabId: string | undefined,
    fromStrip = false,
    creating = false,
  ): (revision: number, tabId?: string, paneId?: string) => void {
    const origin = renderer.currentFocusedRenderable;
    const originTarget = focusTargetFor(origin);
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: liveState.current,
    });
    if (
      !origin ||
      (!creating &&
        (originTarget?.region !== "workbench" || originTarget.control !== undefined) &&
        !(fromStrip && originTarget?.region === "tabs")) ||
      !snapshot ||
      !currentModel.activeItem ||
      !canReceiveWorkbenchInput() ||
      !canEnterTab()
    ) {
      return () => {};
    }
    const entry: PendingTerminalEntry = {
      kind: "tab",
      itemId: currentModel.activeItem.id,
      tabId,
      epoch: snapshot.epoch,
      revision: null,
      navigationKey: currentModel.navigationKey,
      origin,
      version: ++itemFocusVersion.current,
      requestId: ++operationSequence.current,
      allowReactivate: fromStrip,
      ...(creating
        ? {
            creation: {
              sourceTabId: currentModel.activeTab?.id,
              existingTabIds: currentModel.tabs.map((tab) => tab.id),
            },
          }
        : {}),
    };
    tabEntryOwner.current = entry;
    setPendingTerminalEntry(entry);
    return (revision, createdTabId, paneId) => {
      if (itemFocusVersion.current === entry.version && !renderer.isDestroyed) {
        const completed = { ...entry, revision, tabId: createdTabId ?? entry.tabId, paneId };
        tabEntryOwner.current = completed;
        setPendingTerminalEntry(completed);
      }
    };
  }

  function requestTabSelection(tabId: string): Promise<DurableCommandResult | undefined> {
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: liveState.current,
    });
    if (
      workCraft.status !== "connected" ||
      !currentModel.surface ||
      !currentModel.tabs.some((tab) => tab.id === tabId)
    ) {
      return Promise.resolve(undefined);
    }
    const expected = { navigationKey: currentModel.navigationKey, dialog: null };
    const request = {
      tabId,
      promise: runCommand(
        { type: "surface.selectTab", surfaceId: currentModel.surface.id, tabId },
        "tabs",
        expected,
      ),
    };
    latestTabRequest.current = request;
    void request.promise.then((result) => {
      if (latestTabRequest.current === request) {
        if (!result) {
          const latestModel = deriveShellModel({
            snapshot: snapshotRef.current,
            state: liveState.current,
          });
          if (
            latestModel.navigationKey === expected.navigationKey &&
            liveState.current.dialog === null
          ) {
            dispatch({ type: "tab.cursor", id: latestModel.activeTab?.id ?? null });
          }
        }
        latestTabRequest.current = null;
      }
    });
    return request.promise;
  }

  function canEnterTab(): boolean {
    const currentSnapshot = snapshotRef.current;
    const item = deriveShellModel({
      snapshot: currentSnapshot,
      state: liveState.current,
    }).activeItem;
    return (
      workCraft.status === "connected" &&
      item !== undefined &&
      !item.archived &&
      !currentSnapshot?.items.some((parent) => parent.id === item.parentId && parent.archived)
    );
  }

  async function enterTab(tabId: string): Promise<void> {
    if (!canReceiveWorkbenchInput() || !canEnterTab()) {
      return;
    }
    setFocus({ region: "tabs" });
    dispatch({ type: "tab.cursor", id: tabId });
    const complete = focusOnTabSelectionStarted(tabId, true);
    const entry = tabEntryOwner.current;
    const result = await (latestTabRequest.current?.tabId === tabId
      ? latestTabRequest.current.promise
      : requestTabSelection(tabId));
    if (result) {
      complete(result.revision);
    } else if (tabEntryOwner.current === entry) {
      setPendingTerminalEntry(null);
    }
  }

  function focusOnPaneCommand(
    kind: "restart" | "split",
    paneId?: string,
  ): NonNullable<ExecuteCommandInput["onPaneRestarted"]> {
    const origin = renderer.currentFocusedRenderable;
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: liveState.current,
    });
    const epoch = snapshotRef.current?.epoch;
    const version = ++itemFocusVersion.current;
    const requestId = ++operationSequence.current;
    const entry: PendingTerminalEntry | null =
      origin && epoch && currentModel.activeItem
        ? {
            kind,
            itemId: currentModel.activeItem.id,
            tabId: currentModel.activeTab?.id,
            paneId,
            epoch,
            revision: null,
            navigationKey: currentModel.navigationKey,
            origin,
            version,
            requestId,
          }
        : null;
    setPendingTerminalEntry(entry);
    return (paneId, revision) => {
      if (
        entry &&
        (entry.kind === "split" || entry.paneId === paneId) &&
        !renderer.isDestroyed &&
        itemFocusVersion.current === version &&
        renderer.currentFocusedRenderable === origin
      ) {
        setPendingTerminalEntry({ ...entry, paneId, revision });
      }
    };
  }

  function reactivatePane(paneId: string): void {
    if (!canReactivate(paneId)) {
      return;
    }
    const target: FocusTarget = { region: "workbench", paneId, control: "reactivate" };
    setFocus(target);
    void execute("pane.restart", { focus: target, focusedPaneId: paneId });
  }

  useLayoutEffect(() => {
    if (pendingTerminalEntry === null) {
      return;
    }
    function completeEntry(frame?: { frameId: number }): void {
      if (pendingTerminalEntry === null) {
        return;
      }
      const entryItem = snapshotRef.current?.items.find(
        (item) => item.id === pendingTerminalEntry.itemId,
      );
      const archived =
        entryItem?.archived ||
        snapshotRef.current?.items.some((item) => item.id === entryItem?.parentId && item.archived);
      let creationSelectionChanged = false;
      if (pendingTerminalEntry.creation) {
        const selected = snapshotRef.current?.surfaces.find(
          (surface) => surface.itemId === pendingTerminalEntry.itemId,
        )?.activeTabId;
        if (
          pendingTerminalEntry.revision === null ||
          (snapshotRef.current?.revision ?? 0) < pendingTerminalEntry.revision
        ) {
          if (canProjectTabEntry(pendingTerminalEntry, snapshotRef.current)) {
            // Uncorrelated new selections may transfer the origin, never bind response IDs.
            pendingTerminalEntry.creation.selectionAdvanced = true;
          } else {
            creationSelectionChanged =
              selected !== pendingTerminalEntry.creation.sourceTabId ||
              pendingTerminalEntry.creation.selectionAdvanced === true;
          }
        } else {
          creationSelectionChanged = selected !== pendingTerminalEntry.tabId;
        }
      }
      if (archived && itemFocusVersion.current === pendingTerminalEntry.version) {
        // Clearing state alone lets a delayed selection response rearm this entry.
        itemFocusVersion.current += 1;
        tabEntryOwner.current = null;
        latestTabRequest.current = null;
      }
      const missingTarget =
        snapshot !== null &&
        pendingTerminalEntry.revision !== null &&
        snapshot.revision >= pendingTerminalEntry.revision &&
        !snapshot.items.some((item) => item.id === pendingTerminalEntry.itemId) &&
        ["root", "item"].some(
          (prefix) =>
            pendingTerminalEntry.navigationKey ===
            navigationContextKey(
              snapshot.epoch,
              liveState.current,
              `${prefix}:${pendingTerminalEntry.itemId}`,
            ),
        );
      if (
        snapshot === null ||
        archived ||
        creationSelectionChanged ||
        workCraft.status !== "connected" ||
        snapshotRef.current?.epoch !== pendingTerminalEntry.epoch ||
        liveState.current.dialog !== null ||
        (!missingTarget &&
          deriveShellModel({ snapshot: snapshotRef.current, state: liveState.current })
            .navigationKey !== pendingTerminalEntry.navigationKey) ||
        resizeBlocked ||
        itemFocusVersion.current !== pendingTerminalEntry.version ||
        ((pendingTerminalEntry.kind === "split" || pendingTerminalEntry.kind === "restart") &&
          activeTab?.id !== pendingTerminalEntry.tabId) ||
        (renderer.currentFocusedRenderable !== pendingTerminalEntry.origin &&
          !(
            entryClosing.current &&
            (renderer.currentFocusedRenderable === null ||
              renderer.currentFocusedRenderable?.id === "region:category")
          )) ||
        (pendingTerminalEntry.revision !== null &&
          snapshot.revision >= pendingTerminalEntry.revision &&
          !missingTarget &&
          model.activeItem?.id !== pendingTerminalEntry.itemId)
      ) {
        if (
          (pendingTerminalEntry.kind === "split" || pendingTerminalEntry.creation !== undefined) &&
          itemFocusVersion.current === pendingTerminalEntry.version
        ) {
          itemFocusVersion.current += 1;
        }
        setPendingTerminalEntry((entry) =>
          entry?.version === pendingTerminalEntry.version ? null : entry,
        );
        return;
      }
      if (
        pendingTerminalEntry.revision === null ||
        snapshot.revision < pendingTerminalEntry.revision
      ) {
        return;
      }
      const tabEntry = pendingTerminalEntry.kind === "tab";
      const missingTab =
        tabEntry &&
        (!tabs.some((tab) => tab.id === pendingTerminalEntry.tabId) ||
          surface?.activeTabId !== pendingTerminalEntry.tabId);
      const entryPaneIds = missingTab ? [] : currentPaneIds;
      const restartEntry = pendingTerminalEntry.kind === "restart";
      const paneEntry = restartEntry || pendingTerminalEntry.kind === "split";
      const exactPaneEntry = paneEntry || pendingTerminalEntry.creation !== undefined;
      const sourceKey = paneEntry
        ? `pane:${pendingTerminalEntry.paneId}:entry`
        : tabEntry
          ? `tab:${pendingTerminalEntry.tabId}:entry`
          : `item:${pendingTerminalEntry.itemId}:entry`;
      const rememberedPaneId = state.lastPaneByTab[activeTab?.id ?? ""];
      const runningIds = (missingTarget ? [] : entryPaneIds).filter((id) =>
        snapshot.panes.some((pane) => pane.id === id && pane.processStatus === "running"),
      );
      const candidates = exactPaneEntry
        ? runningIds.filter((id) => id === pendingTerminalEntry.paneId)
        : rememberedPaneId !== undefined && runningIds.includes(rememberedPaneId)
          ? [rememberedPaneId, ...runningIds.filter((id) => id !== rememberedPaneId)]
          : runningIds;
      const usablePaneId = candidates.find((id) => {
        const terminal = terminalRefs.current.get(id);
        return terminal && hasTerminalViewport(terminal);
      });
      const paneId = usablePaneId ?? candidates[0];
      if (
        tabEntry &&
        pendingTerminalEntry.allowReactivate &&
        !usablePaneId &&
        !missingTarget &&
        !missingTab
      ) {
        const actionIds = entryPaneIds.filter(canReactivate);
        const selectedId = focusedPaneId ?? rememberedPaneId;
        const actionId = selectedId && actionIds.includes(selectedId) ? selectedId : actionIds[0];
        if (actionId) {
          const target: FocusTarget = {
            region: "workbench",
            paneId: actionId,
            control: "reactivate",
          };
          if (focusShellTarget(renderer, target)) {
            setFocus(target);
            setPendingTerminalEntry(null);
            return;
          }
          if (!frame) {
            return;
          }
        }
      }
      if (
        !usablePaneId &&
        !missingTarget &&
        entryPaneIds
          .filter((id) => !exactPaneEntry || id === pendingTerminalEntry.paneId)
          .some((id) =>
            snapshot.panes.some((pane) => pane.id === id && pane.processStatus === "starting"),
          ) &&
        !undersized
      ) {
        return;
      }
      const terminal = paneId ? terminalRefs.current.get(paneId) : undefined;
      if (
        !usablePaneId &&
        !undersized &&
        candidates.some((id) => {
          const candidate = terminalRefs.current.get(id);
          return (
            !candidate ||
            // A frame can precede the React commit of measured pane bounds.
            ((candidate.width === 0 || candidate.height === 0) &&
              (!tabEntry || !frame || canReceiveWorkbenchInput(id)))
          );
        })
      ) {
        return;
      }
      if (paneId && terminal && !undersized && hasTerminalViewport(terminal)) {
        if (navigatorMode === "drawer") {
          entryClosing.current = true;
          dispatch({ type: "navigator.hide" });
          return;
        }
        entryClosing.current = false;
        if (
          (pendingTerminalEntry.kind === "split" || pendingTerminalEntry.creation !== undefined) &&
          (!canReceiveWorkbenchInput(paneId) || !isEligibleFocusTarget(terminal, renderer.root))
        ) {
          return;
        }
        setFocus({ region: "workbench", paneId });
        if (renderer.currentFocusedRenderable === terminal) {
          dispatch({
            type: "source.clear",
            sourceKey,
            requestId: pendingTerminalEntry.requestId,
          });
        }
      } else {
        if (tabEntry || paneEntry) {
          setFocus({ region: "tabs" });
        }
        const now = Date.now();
        dispatch({
          type: "source.report",
          now,
          error: {
            sourceKey: missingTarget ? "navigator" : missingTab ? "tabs" : sourceKey,
            sourceLabel: paneEntry
              ? (snapshot.panes.find((pane) => pane.id === pendingTerminalEntry.paneId)?.title ??
                "Pane")
              : tabEntry
                ? (tabs.find((tab) => tab.id === pendingTerminalEntry.tabId)?.title ?? "Tab")
                : missingTarget
                  ? "Item"
                  : (model.activeItem?.title ?? "Item"),
            operation: "Terminal entry",
            epoch: snapshot.epoch,
            contextKey: pendingTerminalEntry.navigationKey,
            requestId: pendingTerminalEntry.requestId,
            message: missingTab
              ? "Requested tab is no longer available"
              : missingTarget
                ? "Requested item is no longer available"
                : undersized || terminal
                  ? "Terminal layout is too small"
                  : "No running terminal in the active tab",
            expiresAt: now + 8000,
            origin: "direct",
          },
        });
      }
      setPendingTerminalEntry(null);
    }
    completeEntry();
    renderer.on(CliRenderEvents.FRAME, completeEntry);
    return () => {
      renderer.off(CliRenderEvents.FRAME, completeEntry);
    };
  }, [
    pendingTerminalEntry,
    snapshot,
    state.activeNavigatorKey,
    dialogKey,
    nativeFocus,
    currentPaneIds,
    undersized,
    navigatorMode,
  ]);

  usePaste(() => {
    entryClosing.current = false;
    itemFocusVersion.current += 1;
    setPendingTerminalEntry(null);
  });

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
      entryClosing.current = false;
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
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
        terminalRefs.current.get(keyFocus.paneId)?.handleKeyPress(key);
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
    const dialog = currentState.dialog;
    const origin = renderer.currentFocusedRenderable;
    const epoch = snapshotRef.current?.epoch;
    const version = ++itemFocusVersion.current;
    const requestId = ++operationSequence.current;
    setPendingTerminalEntry(null);
    const navigationKey = deriveShellModel({
      snapshot: snapshotRef.current,
      state: currentState,
    }).navigationKey;
    function isCurrent(
      expectedNavigation: string,
      expectedDialog: DialogState,
      expectedOrigin: Renderable | null,
    ): boolean {
      return (
        !renderer.isDestroyed &&
        snapshotRef.current?.epoch === epoch &&
        itemFocusVersion.current === version &&
        liveState.current.dialog === expectedDialog &&
        renderer.currentFocusedRenderable === expectedOrigin &&
        deriveShellModel({ snapshot: snapshotRef.current, state: liveState.current })
          .navigationKey === expectedNavigation
      );
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
      onItemCreated: async (itemId, parentId, revision) => {
        if (!origin || !epoch || !isCurrent(navigationKey, dialog, origin)) {
          return;
        }
        const currentSnapshot = snapshotRef.current;
        if (
          currentSnapshot &&
          currentSnapshot.revision >= revision &&
          currentSnapshot.items.some(
            (item) => (item.id === itemId || item.id === parentId) && item.archived,
          )
        ) {
          return;
        }
        successfulFormCloses.current.add(dialog);
        dispatch({ type: "dialog.close" });
        if (
          parentId &&
          !liveState.current.navigatorQuery &&
          !liveState.current.expandedRootIds.has(parentId)
        ) {
          dispatch({ type: "root.toggle", rootId: parentId });
        }
        dispatch({
          type: "navigator.activate",
          key: navigatorItemKey({ id: itemId, parentId }),
          pending: { epoch, revision },
        });
        const nextModel = deriveShellModel({
          snapshot: snapshotRef.current,
          state: liveState.current,
        });
        const nextNavigation = nextModel.navigationKey;
        const closeFocus = resolveShellFocus({
          focus: dialog.returnFocus,
          rememberedPaneId: null,
          paneIds: nextModel.paneIds,
          runningPaneIds: nextModel.paneIds.filter((id) =>
            snapshotRef.current?.panes.some(
              (pane) => pane.id === id && pane.processStatus === "running",
            ),
          ),
          undersized,
        }).focus;
        const entry: PendingTerminalEntry = {
          kind: "item",
          itemId,
          epoch,
          revision: null,
          navigationKey: nextNavigation,
          origin,
          version,
          requestId,
        };
        formCloseOwner.current = {
          entry,
          target: renderer.root.findDescendantById(nativeFocusId(closeFocus)) ?? null,
        };
        setPendingTerminalEntry(entry);
        if (!isCurrent(nextNavigation, null, entry.origin)) {
          return;
        }
        const result = await runCommand({ type: "surface.ensure", itemId }, "navigator", {
          navigationKey: nextNavigation,
          dialog: null,
        });
        if (!isCurrent(nextNavigation, null, entry.origin)) {
          return;
        }
        setPendingTerminalEntry(result ? { ...entry, revision: result.revision } : null);
      },
    });
  }

  const presentation = statusPresentation({
    leaderActive: routerState.leaderStartedAt !== null,
    invalidMessage: routerState.invalidMessage,
    invalidMessageUntil: routerState.invalidMessageUntil,
    operationalError: state.operationalError,
    now: Math.max(errorClock, Date.now()),
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
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
      dispatch({ type: "navigator.query", query });
    },
    onInteraction: () => {
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
    },
    onExpand: (rootId: string, expanded: boolean) => {
      if (renderer.width < 80 || !liveState.current.navigatorOpen || liveState.current.dialog) {
        return;
      }
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
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
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
      void execute("cursor.activate", {
        model: {
          ...model,
          navigatorCursorIndex: entries.findIndex((entry) => entry.id === id),
        },
        focus: { region: "navigator" },
        focusedPaneId: null,
        onItemOpened: focusOnItemOpen(),
      });
    },
    onCursorChange: (id: string | null) => {
      // List reconciliation during our close is projection, not a new browsing gesture.
      if (formCloseOwner.current?.entry.version === itemFocusVersion.current) {
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
      if (missingPanes.current.get(paneId) === message) {
        return;
      }
      missingPanes.current.set(paneId, message);
      const now = Date.now();
      dispatch({
        type: "source.report",
        now,
        error: {
          sourceKey: `pane:${paneId}:layout`,
          sourceLabel: "Pane",
          operation: "Layout",
          epoch: snapshot?.epoch ?? "",
          contextKey: model.navigationKey,
          requestId: ++operationSequence.current,
          message,
          expiresAt: now + 8000,
          origin: "background",
        },
      });
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
      void requestTabSelection(id);
    },
    onEnterTab: (id: string) => {
      void enterTab(id);
    },
    entryEnabled: canEnterTab(),
    onTabScrollInteraction: () => {
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
    },
    onFocusTab: (id: string) => {
      if (!canReceiveWorkbenchInput()) {
        return;
      }
      if (projectingTabEntry.current) {
        dispatch({ type: "tab.cursor", id });
        return;
      }
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
      setFocus({ region: "tabs" });
      dispatch({ type: "tab.cursor", id });
    },
    onFocusPane: (paneId: string) => {
      itemFocusVersion.current += 1;
      setPendingTerminalEntry(null);
      setFocus({ region: "workbench", paneId });
    },
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
          canRestoreFocus: () => !successfulFormCloses.current.has(state.dialog!),
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

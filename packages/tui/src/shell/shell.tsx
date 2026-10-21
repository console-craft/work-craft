import { homedir } from "node:os";

import type { EmbeddedTerminalRenderable, MouseEvent } from "@opentui/core";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
  type CategoryKind,
  type InputStamp,
  projectPaneLayout,
  type TerminalInputContext,
} from "@work-craft/server/client";
import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import type { WorkCraftState } from "@/client/store.ts";
import {
  type CommandContext,
  commandHints,
  initialRouterState,
  type KeyLike,
  routeKey,
  type RouterState,
} from "@/input/command-router.ts";
import type { FocusTarget } from "@/input/focus.ts";
import { CategoryRail } from "@/navigation/category-rail.tsx";
import { Navigator } from "@/navigation/navigator.tsx";
import { availableCommands, completionContextFor } from "@/shell/commands.ts";
import type { ShellEnvironment } from "@/shell/context";
import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { statusPresentation } from "@/shell/errors.ts";
import { focusTargetFor } from "@/shell/focus.ts";
import { Header } from "@/shell/header.tsx";
import { calculateShellLayout } from "@/shell/layout.ts";
import { deriveShellModel } from "@/shell/model.ts";
import { ResizeGuard } from "@/shell/resize-guard.tsx";
import { createInitialShellState, reduceShellState, type ShellAction } from "@/shell/state.ts";
import { StatusBar, type StatusBarProps } from "@/shell/status-bar.tsx";
import { useShellCommands } from "@/shell/use-shell-commands";
import { useShellErrors } from "@/shell/use-shell-errors";
import { useShellFocus } from "@/shell/use-shell-focus";
import { useTerminalEntry, useTerminalEntryCompletion } from "@/shell/use-terminal-entry";
import { useFocusedControlHints } from "@/ui/interaction/control-hints";
import { useNativeFocus } from "@/ui/interaction/focus-manager.tsx";
import { isEligibleFocusTarget, moveFocus } from "@/ui/interaction/focus-utils";
import { getActiveModalFocusScope } from "@/ui/interaction/modal-focus";
import { Box } from "@/ui/primitives/box.tsx";
import { HStack } from "@/ui/primitives/hstack.tsx";
import { Stack } from "@/ui/primitives/stack.tsx";
import { hasRecoveryViewport, hasTerminalViewport, terminalRect } from "@/workbench/layout.ts";
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
  function dispatch(action: ShellAction): void {
    const previous = liveState.current;
    const next = reduceShellState(previous, action);
    shellFocus.beforeDispatch(previous, next, action);
    liveState.current = next;
    renderDispatch(action);
  }
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
  const commands = useShellCommands({
    view: () => ({ ...environment, focus, focusedPaneId, terminalWidth: dimensions.width }),
    read: readEnvironment,
    workCraft,
    entry: () => entry,
    dispatch,
    setFocus,
    canReactivate,
    nextRequestId: () => ++operationSequence.current,
  });
  const execute = commands.execute;
  const entry = useTerminalEntry({
    read: readEnvironment,
    rendered: () => environment,
    dispatch,
    nextRequestId: () => ++operationSequence.current,
    run: commands.run,
    setFocus,
    canReceiveInput: canReceiveWorkbenchInput,
    canReactivate,
    onNativeFocus: (target) => shellFocus.observeNativeFocus(target),
  });
  const snapshot = workCraft.snapshot;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const workCraftRef = useRef(workCraft);
  workCraftRef.current = workCraft;
  const operationSequence = useRef(0);
  const errors = useShellErrors({
    snapshot,
    connectionError: workCraft.connectionError,
    error: state.operationalError,
    dispatch,
    nextRequestId: () => ++operationSequence.current,
  });

  useEffect(() => {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot, attachment: workCraft.attachment });
    }
  }, [snapshot, workCraft.attachment]);

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

  const model = deriveShellModel({ snapshot, state, attachment: workCraft.attachment });
  const navigation = model.navigation;
  const stamp: InputStamp | null =
    snapshot && navigation && workCraft.attachment
      ? {
          epoch: snapshot.epoch,
          attachmentGeneration: workCraft.attachment.generation,
          navigationGeneration: navigation.generation,
          geometrySequence:
            workCraft.geometry.tabs.find(({ tabId }) => tabId === navigation.tabId)?.generation ??
            0,
        }
      : null;
  const activitySequence = useRef(0);
  const physicalInput = useRef<
    Pick<Extract<TerminalInputContext, { source: "input" }>, "kind" | "activitySequence">
  >({ kind: "focus" });
  function captureInput(kind: "key" | "paste" | "mouse", active = true): void {
    const event = { kind, ...(active ? { activitySequence: ++activitySequence.current } : {}) };
    physicalInput.current = event;
    queueMicrotask(() => {
      if (physicalInput.current === event) {
        physicalInput.current = { kind: "focus" };
      }
    });
  }
  function controlActivity(): void {
    if (stamp && canReceiveWorkbenchInput() && workCraft.stream) {
      workCraft.stream.activity(stamp, ++activitySequence.current);
    }
  }
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
  const { navigatorMode, navigatorVisible, navigatorWidth, resizeBlocked, undersized } =
    shellLayout;
  const environment: ShellEnvironment = {
    snapshot,
    state,
    model,
    layout: shellLayout,
    connected: workCraft.status === "connected",
  };
  function readEnvironment(): ShellEnvironment {
    const workCraft = workCraftRef.current;
    const snapshot = snapshotRef.current;
    const state = liveState.current;
    const model = deriveShellModel({ snapshot, state, attachment: workCraft.attachment });
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
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: local,
      attachment: workCraft.attachment,
    });
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
      stamp !== null &&
      workCraft.canSendInput(paneId, stamp)
    );
  }
  function canReactivate(paneId: string): boolean {
    if (
      !canReceiveWorkbenchInput() ||
      commands.isReactivating(paneId) ||
      !stamp ||
      !workCraft.canReactivate(paneId, stamp)
    ) {
      return false;
    }
    const currentModel = deriveShellModel({
      snapshot: snapshotRef.current,
      state: liveState.current,
      attachment: workCraft.attachment,
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
  const shellFocus = useShellFocus({
    environment,
    read: readEnvironment,
    nativeFocus,
    entry,
    dispatch,
    canReceiveInput: canReceiveWorkbenchInput,
    canReactivate,
    clearLeader: () => updateRouterState({ ...routerStateRef.current, leaderStartedAt: null }),
  });
  const { focus, focusedPaneId } = shellFocus;
  const completionContext = completionContextFor(model, state.dialog);

  useLayoutEffect(() => {
    commands.reconcileRestartProtection();
  }, [snapshot, workCraft.status]);

  useLayoutEffect(() => {
    entry.contextChanged(workCraft.status === "connected");
  }, [completionContext.navigationKey, dialogKey, workCraft.status]);

  useLayoutEffect(() => {
    commands.observeCompletion(completionContext);
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

  function reconcile(): void {
    if (snapshot !== null) {
      dispatch({ type: "snapshot.reconcile", snapshot, attachment: workCraft.attachment });
    }
  }

  function setFocus(target: FocusTarget): void {
    const current = readEnvironment();
    const navigation = current.model.navigation;
    if (
      target.region === "workbench" &&
      navigation &&
      target.paneId !== navigation.paneId &&
      current.model.paneIds.includes(target.paneId)
    ) {
      void commands
        .run(
          {
            type: "session.navigate",
            sessionId: navigation.sessionId,
            target: { kind: "pane", paneId: target.paneId },
          },
          "workbench",
        )
        .then((result) => {
          if (result) {
            dispatch({ type: "focus.set", focus: target });
          }
        });
      return;
    }
    shellFocus.setFocus(target);
  }

  useTerminalEntryCompletion(entry, environment, nativeFocus);

  usePaste(() => {
    entry.cancelInput();
    if (
      focusTargetFor(renderer.currentFocusedRenderable)?.region === "workbench" &&
      canReceiveWorkbenchInput(focusedPaneId ?? undefined)
    ) {
      captureInput("paste");
    } else {
      controlActivity();
    }
  });

  const viewerEligible =
    workCraft.status === "connected" &&
    !resizeBlocked &&
    !undersized &&
    navigatorMode !== "drawer" &&
    state.dialog === null;
  useLayoutEffect(() => {
    if (!stamp || !workCraft.stream) {
      return;
    }
    workCraft.stream.reportViewport(
      navigation?.tabId && viewerEligible
        ? {
            epoch: stamp.epoch,
            attachmentGeneration: stamp.attachmentGeneration,
            navigationGeneration: stamp.navigationGeneration,
            tabId: navigation.tabId,
            canvas: {
              cols: shellLayout.workbenchContent.width,
              rows: shellLayout.workbenchContent.height,
            },
            eligible: true,
          }
        : null,
      stamp,
    );
  }, [
    workCraft.stream,
    workCraft.attachment?.generation,
    navigation?.generation,
    navigation?.tabId,
    shellLayout.workbenchContent.width,
    shellLayout.workbenchContent.height,
    viewerEligible,
  ]);

  useKeyboard((key) => {
    // Further input supersedes a deferred handoff; local activation can start a new one.
    const duplicateSubmit =
      commands.isSubmitting(liveState.current.dialog) &&
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
    const keyPaneId = keyFocus.region === "workbench" ? keyFocus.paneId : focusedPaneId;
    const keyState = {
      ...liveState.current,
      focus: keyFocus,
    };
    const keyModel = deriveShellModel({
      snapshot,
      state: keyState,
      attachment: workCraft.attachment,
    });
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
    if (
      (!routed.handled || routed.passthroughLeader) &&
      keyFocus.region === "workbench" &&
      !keyFocus.control &&
      canReceiveWorkbenchInput(keyFocus.paneId)
    ) {
      captureInput("key");
    } else {
      controlActivity();
    }
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
    activeId: navigation?.workspaceId ?? null,
    focused: state.dialog === null && focus.region === "workspace",
    workspaces,
    onActivate: (id: string) => {
      if (renderer.width < 80) {
        return;
      }
      if (navigation) {
        void commands.run(
          {
            type: "session.navigate",
            sessionId: navigation.sessionId,
            target: { kind: "workspace", workspaceId: id },
          },
          "workspace",
        );
      }
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
    active: navigation?.category ?? null,
    categories: renderedCategories,
    focused: state.dialog === null && focus.region === "category",
    onActivate: (category: CategoryKind) => {
      if (renderer.width < 80) {
        return;
      }
      if (navigation) {
        void commands.run(
          {
            type: "session.navigate",
            sessionId: navigation.sessionId,
            target: { kind: "category", category },
          },
          "category",
        );
      }
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
    reactivatingPaneIds: commands.reactivatingPaneIds,
    canReactivate,
    onReactivatePane: commands.reactivate,
    inputEnabled: !resizeBlocked && navigatorMode !== "drawer" && state.dialog === null,
    canReceiveInput: canReceiveWorkbenchInput,
    stamp,
    canRespond: (paneId: string) =>
      stamp !== null &&
      canReceiveWorkbenchInput() &&
      !readEnvironment().layout.undersized &&
      workCraft.canRespond(paneId, stamp),
    inputEvent: () => physicalInput.current,
    onMouseInput: (event: MouseEvent) =>
      captureInput("mouse", event.type === "down" && event.button === 0),
    onResync: () => {
      void workCraft.reload();
    },
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
          canCancel: state.dialog.kind === "create" || activeSession !== undefined,
          sessions,
          promptValue: state.promptValue,
          error: state.fieldError,
          onArchive: commands.archive,
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
            void commands.attach(id);
          },
          onPromptChange: (value: string) => {
            if (renderer.width >= 80) {
              dispatch({ type: "prompt.set", value });
            }
          },
          onPromptSubmit: (value: string) => {
            if (renderer.width >= 80) {
              void commands.submitCreate(value);
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
      onMouse={(event) => {
        if (
          event.type === "down" &&
          event.button === 0 &&
          !event.target?.id.startsWith("terminal:")
        ) {
          controlActivity();
        }
      }}
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
              key={`${navigation?.workspaceId}:${navigation?.category}`}
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

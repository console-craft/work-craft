import { CliRenderEvents, type EmbeddedTerminalRenderable, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type { Command, SessionNavigation } from "@work-craft/server/client";
import { useLayoutEffect, useRef, useState } from "react";

import type { FocusTarget } from "@/input/focus";
import { navigatorItemKey } from "@/navigation/model";
import type {
  DurableCommandResult,
  ExecuteCommandInput,
  SubmitCreateInput,
} from "@/shell/commands";
import {
  isCreationNavigationCurrent,
  navigationContextKey,
  type ShellEnvironment,
} from "@/shell/context";
import { entrySourceKey, OPERATIONAL_ERROR_DURATION } from "@/shell/errors";
import { focusShellTarget, focusTargetFor, nativeFocusId } from "@/shell/focus";
import { resolveShellFocus, type ShellModel } from "@/shell/model";
import type { DialogState, ShellAction } from "@/shell/state";
import {
  canProjectTabEntry,
  entryPaneCandidates,
  entryRevisionReady,
  type PendingTerminalEntry,
} from "@/shell/terminal-entry";
import { isEligibleFocusTarget } from "@/ui/interaction/focus-utils";
import { hasTerminalViewport } from "@/workbench/layout";

export type TabEntryHandle = {
  complete(revision: number, tabId?: string, paneId?: string, navigation?: SessionNavigation): void;
  finish(): void;
};
export type PaneEntryHandle = {
  complete(paneId: string, revision: number, navigation?: SessionNavigation): void;
  finish(): void;
};

type TerminalEntryOptions = {
  read(): ShellEnvironment;
  rendered(): ShellEnvironment;
  dispatch(action: ShellAction): void;
  nextRequestId(): number;
  run: ExecuteCommandInput["run"];
  setFocus(target: FocusTarget): void;
  canReceiveInput(paneId?: string): boolean;
  canReactivate(paneId: string): boolean;
  onNativeFocus(target: Renderable | null): void;
};

export type TerminalEntryCoordinator = {
  cancel(): void;
  cancelInput(): void;
  startItemOpen(): NonNullable<ExecuteCommandInput["onItemOpened"]>;
  startTabSelection(
    tabId: string | undefined,
    fromStrip?: boolean,
    creating?: boolean,
  ): TabEntryHandle;
  startPaneCommand(kind: "restart" | "split", paneId?: string): PaneEntryHandle;
  createdItemHandler(
    dialog: Extract<NonNullable<DialogState>, { kind: "create" }>,
  ): SubmitCreateInput["onItemCreated"];
  requestTabSelection(tabId: string): Promise<DurableCommandResult | undefined>;
  enterTab(tabId: string): Promise<void>;
  canEnterTab(): boolean;
  terminal(paneId: string): EmbeddedTerminalRenderable | undefined;
  registerTerminal(paneId: string, node: EmbeddedTerminalRenderable | null): void;
  focusFor(model: ShellModel, requested: FocusTarget): FocusTarget;
  projectFocus(target: FocusTarget, perform: () => boolean): boolean;
  isClosingDrawer(): boolean;
  isClosingForm(): boolean;
  isProjectingTabFocus(): boolean;
  canRestoreFocus(dialog: NonNullable<DialogState>): boolean;
  commandStarted(command: Command): () => boolean;
  /** Scheduling bridges used only by the shell's existing layout-effect positions. */
  contextChanged(connected: boolean): void;
  hasPending(): boolean;
  completePending(environment: ShellEnvironment, frame?: { frameId: number }): void;
};

/** Owns focus intent, not restart submission protection or authoritative input permission. */
export function useTerminalEntry({
  read,
  rendered,
  dispatch,
  nextRequestId,
  run,
  setFocus,
  canReceiveInput,
  canReactivate,
  onNativeFocus,
}: TerminalEntryOptions): TerminalEntryCoordinator {
  const renderer = useRenderer();
  const [pending, setPending] = useState<PendingTerminalEntry | null>(null);
  const version = useRef(0);
  const tabOwner = useRef<PendingTerminalEntry | null>(null);
  const cancelledNavigation = useRef<string | null>(null);
  const latestTabRequest = useRef<{
    tabId: string;
    promise: Promise<DurableCommandResult | undefined>;
  } | null>(null);
  const projectingTab = useRef(false);
  const closingDrawer = useRef(false);
  const successfulFormCloses = useRef(new WeakSet<NonNullable<DialogState>>());
  const formCloseOwner = useRef<{ entry: PendingTerminalEntry; target: Renderable | null } | null>(
    null,
  );
  const terminals = useRef(new Map<string, EmbeddedTerminalRenderable>());
  const liveCanReceiveInput = useRef(canReceiveInput);
  liveCanReceiveInput.current = canReceiveInput;

  useLayoutEffect(() => {
    if (pending === null) {
      tabOwner.current = null;
    }
  }, [pending]);

  useLayoutEffect(() => {
    function observeFocus(_target?: Renderable | null, previous?: Renderable | null): void {
      onNativeFocus(renderer.currentFocusedRenderable);
      const entry = tabOwner.current;
      if (projectingTab.current) {
        return;
      }
      if (entry?.version === version.current) {
        const origin = focusTargetFor(entry.origin);
        const selectionMoved =
          origin?.region === "workbench" &&
          (read().model.navigation?.paneId !== origin.paneId ||
            !liveCanReceiveInput.current(origin.paneId));
        if (
          renderer.currentFocusedRenderable?.id === "region:tabs" &&
          (previous === entry.origin ||
            (previous == null && !isEligibleFocusTarget(entry.origin, renderer.root))) &&
          selectionMoved &&
          canProjectTabEntry(entry, read().snapshot)
        ) {
          entry.origin = renderer.currentFocusedRenderable;
          return;
        }
        if (
          (renderer.currentFocusedRenderable === null &&
            previous === entry.origin &&
            (!isEligibleFocusTarget(entry.origin, renderer.root) || selectionMoved) &&
            canProjectTabEntry(entry, read().snapshot)) ||
          (projectingTab.current && renderer.currentFocusedRenderable === entry.origin)
        ) {
          return;
        }
      }
      if (
        formCloseOwner.current?.entry.version === version.current &&
        read().state.dialog === null &&
        (renderer.currentFocusedRenderable === null ||
          renderer.currentFocusedRenderable === formCloseOwner.current.target)
      ) {
        return;
      }
      if (
        closingDrawer.current &&
        (renderer.currentFocusedRenderable === null ||
          renderer.currentFocusedRenderable?.id === "region:category")
      ) {
        return;
      }
      if (entry?.version === version.current) {
        cancelledNavigation.current = read().model.navigationKey;
      }
      version.current += 1;
      latestTabRequest.current = null;
    }
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observeFocus);
    return () => {
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observeFocus);
    };
  }, [renderer]);

  function cancel(): void {
    if (tabOwner.current?.version === version.current) {
      cancelledNavigation.current = read().model.navigationKey;
    }
    version.current += 1;
    setPending(null);
  }
  function cancelInput(): void {
    closingDrawer.current = false;
    cancel();
  }
  function finish(requestVersion: number): void {
    if (tabOwner.current?.version === requestVersion && tabOwner.current.revision === null) {
      tabOwner.current = null;
    }
    setPending((entry) =>
      entry?.version === requestVersion && entry.revision === null ? null : entry,
    );
  }
  function startItemOpen(): NonNullable<ExecuteCommandInput["onItemOpened"]> {
    cancelledNavigation.current = null;
    const origin = renderer.currentFocusedRenderable;
    const epoch = rendered().snapshot?.epoch;
    const requestVersion = ++version.current;
    const requestId = nextRequestId();
    setPending(null);
    return (itemId, revision, navigation) => {
      if (
        origin !== null &&
        epoch !== undefined &&
        !renderer.isDestroyed &&
        version.current === requestVersion &&
        renderer.currentFocusedRenderable === origin
      ) {
        setPending({
          kind: "item",
          sessionId: read().model.navigation!.sessionId,
          itemId,
          epoch,
          revision,
          origin,
          version: requestVersion,
          requestId,
          navigationKey: navigation
            ? navigationContextKey(epoch, navigation)
            : read().model.navigationKey,
        });
      }
    };
  }
  function canEnterTab(): boolean {
    const { snapshot, model, connected } = read();
    const item = model.activeItem;
    return (
      connected &&
      item !== undefined &&
      !item.archived &&
      !snapshot?.items.some((parent) => parent.id === item.parentId && parent.archived)
    );
  }
  function startTabSelection(
    tabId: string | undefined,
    fromStrip = false,
    creating = false,
  ): TabEntryHandle {
    cancelledNavigation.current = null;
    const origin = renderer.currentFocusedRenderable;
    const originTarget = focusTargetFor(origin);
    const currentModel = read().model;
    const snapshot = rendered().snapshot;
    if (
      !origin ||
      (!creating &&
        (originTarget?.region !== "workbench" || originTarget.control !== undefined) &&
        !(fromStrip && originTarget?.region === "tabs")) ||
      !snapshot ||
      !currentModel.activeItem ||
      !canReceiveInput() ||
      !canEnterTab()
    ) {
      return { complete() {}, finish() {} };
    }
    const entry: PendingTerminalEntry = {
      kind: "tab",
      sessionId: currentModel.navigation!.sessionId,
      itemId: currentModel.activeItem.id,
      tabId,
      epoch: snapshot.epoch,
      revision: null,
      navigationKey: currentModel.navigationKey,
      origin,
      version: ++version.current,
      requestId: nextRequestId(),
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
    tabOwner.current = entry;
    setPending(entry);
    return {
      complete(revision, createdTabId, paneId, navigation) {
        if (version.current === entry.version && !renderer.isDestroyed) {
          const completed = {
            ...entry,
            revision,
            tabId: createdTabId ?? entry.tabId,
            paneId,
            navigationKey: navigation
              ? navigationContextKey(entry.epoch, navigation)
              : entry.navigationKey,
          };
          tabOwner.current = completed;
          setPending(completed);
        }
      },
      finish: () => finish(entry.version),
    };
  }
  function startPaneCommand(kind: "restart" | "split", paneId?: string): PaneEntryHandle {
    cancelledNavigation.current = null;
    const origin = renderer.currentFocusedRenderable;
    const { model, snapshot } = read();
    const epoch = snapshot?.epoch;
    const requestVersion = ++version.current;
    const requestId = nextRequestId();
    const entry: PendingTerminalEntry | null =
      origin && epoch && model.activeItem
        ? {
            kind,
            sessionId: model.navigation!.sessionId,
            itemId: model.activeItem.id,
            tabId: model.activeTab?.id,
            paneId,
            epoch,
            revision: null,
            navigationKey: model.navigationKey,
            origin,
            version: requestVersion,
            requestId,
          }
        : null;
    tabOwner.current = entry;
    setPending(entry);
    return {
      complete(paneId, revision, navigation) {
        if (
          entry &&
          (entry.kind === "split" || entry.paneId === paneId) &&
          !renderer.isDestroyed &&
          version.current === requestVersion &&
          renderer.currentFocusedRenderable === entry.origin
        ) {
          const completed = {
            ...entry,
            paneId,
            revision,
            navigationKey: navigation
              ? navigationContextKey(entry.epoch, navigation)
              : entry.navigationKey,
          };
          tabOwner.current = completed;
          setPending(completed);
        }
      },
      finish: () => finish(requestVersion),
    };
  }
  function requestTabSelection(tabId: string): Promise<DurableCommandResult | undefined> {
    const { model, connected } = read();
    if (
      !connected ||
      !model.navigation ||
      !model.surface ||
      !model.tabs.some((tab) => tab.id === tabId)
    ) {
      return Promise.resolve(undefined);
    }
    if (latestTabRequest.current?.tabId === tabId) {
      return latestTabRequest.current.promise;
    }
    const expected = { navigationKey: model.navigationKey, dialog: null };
    const request = {
      tabId,
      promise: run(
        {
          type: "session.navigate",
          sessionId: model.navigation.sessionId,
          target: { kind: "tab", tabId },
        },
        "tabs",
        expected,
      ),
    };
    latestTabRequest.current = request;
    void request.promise.then((result) => {
      if (latestTabRequest.current === request) {
        if (!result) {
          const latest = read();
          if (
            latest.model.navigationKey === expected.navigationKey &&
            latest.state.dialog === null
          ) {
            dispatch({ type: "tab.cursor", id: latest.model.activeTab?.id ?? null });
          }
        }
        latestTabRequest.current = null;
      }
    });
    return request.promise;
  }
  async function enterTab(tabId: string): Promise<void> {
    if (!canReceiveInput() || !canEnterTab()) {
      return;
    }
    setFocus({ region: "tabs" });
    dispatch({ type: "tab.cursor", id: tabId });
    const handle = startTabSelection(tabId, true);
    const entry = tabOwner.current;
    const result = await (latestTabRequest.current?.tabId === tabId
      ? latestTabRequest.current.promise
      : requestTabSelection(tabId));
    if (result) {
      handle.complete(result.revision, result.tabId, result.paneId, result.navigation);
    } else if (tabOwner.current === entry) {
      setPending(null);
    }
  }
  function focusFor(model: ShellModel, requested: FocusTarget): FocusTarget {
    if (
      cancelledNavigation.current !== null &&
      cancelledNavigation.current !== model.navigationKey
    ) {
      if (requested.region === "workbench") {
        return { region: "tabs" };
      }
      cancelledNavigation.current = null;
    }
    const entry = tabOwner.current;
    if (
      entry?.version === version.current &&
      read().snapshot?.epoch !== entry.epoch &&
      requested.region === "workbench"
    ) {
      return { region: "tabs" };
    }
    if (
      entry?.version === version.current &&
      requested.region === "workbench" &&
      nativeFocusId(requested) !== entry.origin.id
    ) {
      return { region: "tabs" };
    }
    if (
      entry?.version === version.current &&
      entry.revision === null &&
      model.navigationKey !== entry.navigationKey &&
      requested.region === "workbench"
    ) {
      return { region: "tabs" };
    }
    return entry?.version === version.current &&
      entry.tabId !== undefined &&
      model.navigation?.tabId === entry.tabId &&
      model.activeTab?.id !== entry.tabId
      ? { region: "tabs" }
      : requested;
  }
  function projectFocus(target: FocusTarget, perform: () => boolean): boolean {
    const owner = formCloseOwner.current;
    if (owner?.entry.version === version.current) {
      owner.target = renderer.root.findDescendantById(nativeFocusId(target)) ?? null;
    }
    const entry = tabOwner.current;
    if (
      entry?.version === version.current &&
      canProjectTabEntry(entry, rendered().snapshot) &&
      target.region === "tabs" &&
      (renderer.currentFocusedRenderable === entry.origin ||
        (renderer.currentFocusedRenderable === null &&
          !isEligibleFocusTarget(entry.origin, renderer.root)))
    ) {
      entry.origin = renderer.root.findDescendantById("region:tabs")!;
    }
    projectingTab.current = target.region === "tabs";
    const result = perform();
    projectingTab.current = false;
    if (owner?.entry.version === version.current && renderer.currentFocusedRenderable) {
      owner.entry.origin = renderer.currentFocusedRenderable;
    }
    formCloseOwner.current = null;
    return result;
  }
  function commandStarted(command: Command): () => boolean {
    if (
      (command.type === "session.navigate" && command.target.kind === "tab") ||
      (command.type === "session.step" && command.level === "tab")
    ) {
      latestTabRequest.current = null;
    }
    const requestVersion = version.current;
    const origin = focusTargetFor(renderer.currentFocusedRenderable);
    const guardsEntry =
      command.type === "session.openItem" ||
      command.type === "directory.register" ||
      command.type === "item.create" ||
      command.type === "process.restart" ||
      command.type === "pane.split" ||
      command.type === "tab.create" ||
      ((command.type === "session.navigate" || command.type === "session.step") &&
        origin?.region === "workbench" &&
        !origin.control &&
        tabOwner.current?.version === requestVersion);
    return () => !guardsEntry || version.current === requestVersion;
  }
  function createdItemHandler(
    dialog: Extract<NonNullable<DialogState>, { kind: "create" }>,
  ): SubmitCreateInput["onItemCreated"] {
    cancelledNavigation.current = null;
    const origin = renderer.currentFocusedRenderable;
    const epoch = read().snapshot?.epoch;
    const requestVersion = ++version.current;
    const requestId = nextRequestId();
    setPending(null);
    const undersized = rendered().layout.undersized;
    function isCurrent(
      expectedNavigation: string,
      expectedDialog: DialogState,
      expectedOrigin: Renderable | null,
    ): boolean {
      const latest = read();
      return (
        !renderer.isDestroyed &&
        latest.snapshot?.epoch === epoch &&
        version.current === requestVersion &&
        latest.state.dialog === expectedDialog &&
        renderer.currentFocusedRenderable === expectedOrigin &&
        latest.model.navigationKey === expectedNavigation
      );
    }
    return async (itemId, parentId, revision) => {
      const currentNavigation = read().model.navigation;
      if (
        !origin ||
        !epoch ||
        !isCurrent(read().model.navigationKey, dialog, origin) ||
        !isCreationNavigationCurrent(dialog.scope.navigation, currentNavigation, itemId, parentId)
      ) {
        return;
      }
      const currentSnapshot = read().snapshot;
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
      if (parentId && !read().state.navigatorQuery && !read().state.expandedRootIds.has(parentId)) {
        dispatch({ type: "root.toggle", rootId: parentId });
      }
      dispatch({
        type: "navigator.cursor",
        key: navigatorItemKey({ id: itemId, parentId }),
      });
      const latest = read();
      const nextModel = latest.model;
      const nextNavigation = nextModel.navigationKey;
      const closeFocus = resolveShellFocus({
        focus: dialog.returnFocus,
        rememberedPaneId: null,
        paneIds: nextModel.paneIds,
        runningPaneIds: nextModel.paneIds.filter((id) =>
          latest.snapshot?.panes.some((pane) => pane.id === id && pane.processStatus === "running"),
        ),
        undersized,
      }).focus;
      const entry: PendingTerminalEntry = {
        kind: "item",
        sessionId: latest.model.navigation!.sessionId,
        itemId,
        epoch,
        revision: null,
        navigationKey: nextNavigation,
        origin,
        version: requestVersion,
        requestId,
      };
      formCloseOwner.current = {
        entry,
        target: renderer.root.findDescendantById(nativeFocusId(closeFocus)) ?? null,
      };
      setPending(entry);
      if (!isCurrent(nextNavigation, null, entry.origin)) {
        return;
      }
      const sessionId = latest.model.navigation?.sessionId;
      if (!sessionId) {
        return;
      }
      const result = await run({ type: "session.openItem", sessionId, itemId }, "navigator", {
        navigationKey: nextNavigation,
        dialog: null,
      });
      const receiptNavigation = result?.navigation
        ? navigationContextKey(epoch, result.navigation)
        : nextNavigation;
      if (
        !isCurrent(nextNavigation, null, entry.origin) &&
        !isCurrent(receiptNavigation, null, entry.origin)
      ) {
        return;
      }
      setPending(
        result ? { ...entry, revision: result.revision, navigationKey: receiptNavigation } : null,
      );
    };
  }

  // Completion consumes the rendered projection; cancellation also checks current native/live state.
  function completePending(environment: ShellEnvironment, frame?: { frameId: number }): void {
    if (!pending || cancelStale(pending, environment)) {
      return;
    }
    const snapshot = environment.snapshot;
    if (!entryRevisionReady(pending, snapshot) || !snapshot) {
      return;
    }
    const { model, layout } = environment;
    const tabEntry = pending.kind === "tab";
    const paneEntry = pending.kind === "restart" || pending.kind === "split";
    const exactPaneEntry = paneEntry || pending.creation !== undefined;
    // The selection commit precedes spawn status; its old stopped process is not a failed restart.
    if (
      exactPaneEntry &&
      snapshot.revision === pending.revision &&
      snapshot.panes.some(
        (pane) =>
          pane.id === pending.paneId && ["exited", "interrupted"].includes(pane.processStatus),
      )
    ) {
      return;
    }
    const missingTarget = targetIsMissing(pending, environment);
    const missingTab =
      tabEntry &&
      (!model.tabs.some((tab) => tab.id === pending.tabId) ||
        model.navigation?.tabId !== pending.tabId);
    const paneIds = missingTab ? [] : model.paneIds;
    const sourceKey = paneEntry
      ? entrySourceKey("pane", pending.paneId!)
      : tabEntry
        ? entrySourceKey("tab", pending.tabId!)
        : entrySourceKey("item", pending.itemId);
    const remembered = model.navigation?.paneId ?? undefined;
    const running = (missingTarget ? [] : paneIds).filter((id) =>
      snapshot.panes.some((pane) => pane.id === id && pane.processStatus === "running"),
    );
    const candidates = entryPaneCandidates(pending, running, remembered);
    const usable = candidates.find((id) => {
      const terminal = terminals.current.get(id);
      return terminal?.parent && hasTerminalViewport(terminal.parent.getLayout());
    });
    const paneId = usable ?? candidates[0];
    if (
      tabEntry &&
      pending.allowReactivate &&
      !usable &&
      !missingTarget &&
      !missingTab &&
      tryRecovery(paneIds, remembered, frame)
    ) {
      return;
    }
    if (
      !usable &&
      !missingTarget &&
      paneIds
        .filter((id) => !exactPaneEntry || id === pending.paneId)
        .some((id) =>
          snapshot.panes.some((pane) => pane.id === id && pane.processStatus === "starting"),
        ) &&
      !layout.undersized
    ) {
      return;
    }
    if (!usable && !layout.undersized && awaitingNativeLayout(candidates, tabEntry, frame)) {
      return;
    }
    const terminal = paneId ? terminals.current.get(paneId) : undefined;
    if (
      paneId &&
      terminal?.parent &&
      !layout.undersized &&
      hasTerminalViewport(terminal.parent.getLayout())
    ) {
      if (layout.navigatorMode === "drawer") {
        closingDrawer.current = true;
        dispatch({ type: "navigator.hide" });
        return;
      }
      if (closingDrawer.current) {
        const strip = renderer.root.findDescendantById("region:tabs");
        if (!strip || !isEligibleFocusTarget(strip, renderer.root)) {
          return;
        }
        projectingTab.current = true;
        pending.origin = strip;
        focusShellTarget(renderer, { region: "tabs" });
        projectingTab.current = false;
        closingDrawer.current = false;
        dispatch({ type: "focus.set", focus: { region: "tabs" } });
      }
      if (!canReceiveInput(paneId) || !isEligibleFocusTarget(terminal, renderer.root)) {
        return;
      }
      tabOwner.current = null;
      setFocus({ region: "workbench", paneId });
      if (renderer.currentFocusedRenderable === terminal) {
        dispatch({ type: "source.clear", sourceKey, requestId: pending.requestId });
      }
    } else {
      if (tabEntry || paneEntry) {
        setFocus({ region: "tabs" });
      }
      reportFailure(pending, environment, {
        sourceKey,
        missingTarget,
        missingTab,
        terminal: terminal !== undefined,
      });
    }
    setPending(null);
  }

  function creationSelectionChanged(entry: PendingTerminalEntry): boolean {
    if (!entry.creation) {
      return false;
    }
    const snapshot = read().snapshot;
    const selected = read().model.navigation?.tabId;
    if (entry.revision === null || (snapshot?.revision ?? 0) < entry.revision) {
      if (canProjectTabEntry(entry, snapshot)) {
        entry.creation.selectionAdvanced = true;
        return false;
      }
      return selected !== entry.creation.sourceTabId || entry.creation.selectionAdvanced === true;
    }
    return selected !== entry.tabId;
  }
  function targetIsMissing(entry: PendingTerminalEntry, environment: ShellEnvironment): boolean {
    const snapshot = environment.snapshot;
    return (
      snapshot !== null &&
      entry.revision !== null &&
      snapshot.revision >= entry.revision &&
      !snapshot.items.some((item) => item.id === entry.itemId) &&
      read().model.navigation?.itemId === entry.itemId
    );
  }
  function cancelStale(entry: PendingTerminalEntry, environment: ShellEnvironment): boolean {
    const latest = read();
    const item = latest.snapshot?.items.find((item) => item.id === entry.itemId);
    const archived =
      item?.archived ||
      latest.snapshot?.items.some((parent) => parent.id === item?.parentId && parent.archived);
    const selectionChanged = creationSelectionChanged(entry);
    if (archived && version.current === entry.version) {
      version.current += 1;
      tabOwner.current = null;
      latestTabRequest.current = null;
    }
    const missingTarget = targetIsMissing(entry, environment);
    const { snapshot, model, layout } = environment;
    const origin = focusTargetFor(entry.origin);
    const awaitingStrip =
      renderer.currentFocusedRenderable === null &&
      canProjectTabEntry(entry, latest.snapshot) &&
      (!isEligibleFocusTarget(entry.origin, renderer.root) ||
        (origin?.region === "workbench" &&
          (latest.model.navigation?.paneId !== origin.paneId || !canReceiveInput(origin.paneId))));
    if (
      snapshot === null ||
      archived ||
      selectionChanged ||
      !environment.connected ||
      latest.snapshot?.epoch !== entry.epoch ||
      latest.state.dialog !== null ||
      (entry.revision !== null &&
        (latest.snapshot?.revision ?? -1) >= entry.revision &&
        !missingTarget &&
        latest.model.navigationKey !== entry.navigationKey) ||
      layout.resizeBlocked ||
      version.current !== entry.version ||
      ((entry.kind === "split" || entry.kind === "restart") &&
        model.activeTab?.id !== entry.tabId) ||
      (renderer.currentFocusedRenderable !== entry.origin &&
        !awaitingStrip &&
        !(
          closingDrawer.current &&
          (renderer.currentFocusedRenderable === null ||
            renderer.currentFocusedRenderable?.id === "region:category")
        )) ||
      (entry.revision !== null &&
        snapshot.revision >= entry.revision &&
        !missingTarget &&
        model.activeItem?.id !== entry.itemId)
    ) {
      if (
        (entry.kind === "split" || entry.creation !== undefined) &&
        version.current === entry.version
      ) {
        version.current += 1;
      }
      if (snapshot?.epoch !== entry.epoch) {
        cancelledNavigation.current = entry.navigationKey;
      }
      setPending((current) => (current?.version === entry.version ? null : current));
      return true;
    }
    return false;
  }
  function tryRecovery(
    paneIds: readonly string[],
    selectedId: string | null | undefined,
    frame?: { frameId: number },
  ): boolean {
    const actionIds = paneIds.filter(canReactivate);
    const actionId = selectedId && actionIds.includes(selectedId) ? selectedId : undefined;
    if (actionId) {
      const target: FocusTarget = { region: "workbench", paneId: actionId, control: "reactivate" };
      if (focusShellTarget(renderer, target)) {
        setFocus(target);
        setPending(null);
        return true;
      }
      if (!frame) {
        return true;
      }
    }
    return false;
  }
  function awaitingNativeLayout(
    candidates: readonly string[],
    tabEntry: boolean,
    frame?: { frameId: number },
  ): boolean {
    return candidates.some((id) => {
      const terminal = terminals.current.get(id);
      const viewport = terminal?.parent?.getLayout();
      return (
        !terminal ||
        ((!viewport || !(viewport.width > 0 && viewport.height > 0)) &&
          (!tabEntry || !frame || canReceiveInput(id)))
      );
    });
  }
  function reportFailure(
    entry: PendingTerminalEntry,
    environment: ShellEnvironment,
    failure: { sourceKey: string; missingTarget: boolean; missingTab: boolean; terminal: boolean },
  ): void {
    const { snapshot, model, layout } = environment;
    if (!snapshot) {
      return;
    }
    const { sourceKey, missingTarget, missingTab, terminal } = failure;
    const paneEntry = entry.kind === "split" || entry.kind === "restart";
    const tabEntry = entry.kind === "tab";
    const now = Date.now();
    dispatch({
      type: "source.report",
      now,
      error: {
        sourceKey: missingTarget ? "navigator" : missingTab ? "tabs" : sourceKey,
        sourceLabel: paneEntry
          ? (snapshot.panes.find((pane) => pane.id === entry.paneId)?.title ?? "Pane")
          : tabEntry
            ? (model.tabs.find((tab) => tab.id === entry.tabId)?.title ?? "Tab")
            : missingTarget
              ? "Item"
              : (model.activeItem?.title ?? "Item"),
        operation: "Terminal entry",
        epoch: snapshot.epoch,
        contextKey: entry.navigationKey,
        requestId: entry.requestId,
        message: missingTab
          ? "Requested tab is no longer available"
          : missingTarget
            ? "Requested item is no longer available"
            : layout.undersized || terminal
              ? "Terminal layout is too small"
              : "No running terminal in the active tab",
        expiresAt: now + OPERATIONAL_ERROR_DURATION,
        origin: "direct",
      },
    });
  }

  return {
    cancel,
    cancelInput,
    startItemOpen,
    startTabSelection,
    startPaneCommand,
    createdItemHandler,
    requestTabSelection,
    enterTab,
    canEnterTab,
    focusFor,
    projectFocus,
    commandStarted,
    completePending,
    terminal: (id) => terminals.current.get(id),
    registerTerminal(id, node) {
      if (node === null) {
        terminals.current.delete(id);
      } else {
        terminals.current.set(id, node);
      }
    },
    isClosingDrawer: () => closingDrawer.current,
    isClosingForm: () => formCloseOwner.current?.entry.version === version.current,
    isProjectingTabFocus: () =>
      projectingTab.current ||
      (tabOwner.current?.version === version.current &&
        tabOwner.current.origin.id === "region:tabs" &&
        renderer.currentFocusedRenderable === tabOwner.current.origin),
    canRestoreFocus: (dialog) => !successfulFormCloses.current.has(dialog),
    contextChanged(connected) {
      latestTabRequest.current = null;
      if (!connected) {
        cancel();
      }
    },
    hasPending: () => pending !== null,
  };
}

/** Keep frame completion after the shell's logical/native focus projection effects. */
export function useTerminalEntryCompletion(
  entry: TerminalEntryCoordinator,
  environment: ShellEnvironment,
  nativeFocus: Renderable | null,
): void {
  const renderer = useRenderer();
  useLayoutEffect(() => {
    if (!entry.hasPending()) {
      return;
    }
    const complete = (frame?: { frameId: number }) => entry.completePending(environment, frame);
    complete();
    renderer.on(CliRenderEvents.FRAME, complete);
    return () => {
      renderer.off(CliRenderEvents.FRAME, complete);
    };
  }, [
    entry,
    environment.snapshot,
    environment.model.navigationKey,
    environment.state.dialog,
    nativeFocus,
    environment.model.paneIds,
    environment.layout.undersized,
    environment.layout.navigatorMode,
  ]);
}

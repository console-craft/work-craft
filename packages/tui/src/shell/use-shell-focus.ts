import { CliRenderEvents, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { focusKey, type FocusTarget } from "@/input/focus";
import type { ShellEnvironment } from "@/shell/context";
import { focusShellTarget, focusTargetFor, nativeFocusId } from "@/shell/focus";
import { resolveShellFocus } from "@/shell/model";
import type { ShellAction, ShellState } from "@/shell/state";
import type { TerminalEntryCoordinator } from "@/shell/use-terminal-entry";
import { focusRenderable, isEligibleFocusTarget } from "@/ui/interaction/focus-utils";

type ShellFocusOptions = {
  environment: ShellEnvironment;
  read(): ShellEnvironment;
  nativeFocus: Renderable | null;
  entry: TerminalEntryCoordinator;
  dispatch(action: ShellAction): void;
  canReceiveInput(paneId?: string): boolean;
  canReactivate(paneId: string): boolean;
  clearLeader(): void;
  rememberPane(tabId: string, paneId: string): void;
};
export type ShellFocusController = {
  focus: FocusTarget;
  focusedPaneId: string | null;
  setFocus(target: FocusTarget): void;
  beforeDispatch(previous: ShellState, next: ShellState, action: ShellAction): void;
  observeNativeFocus(target: Renderable | null): void;
};

/** Coordinates shell presentation with native focus; it installs no keyboard policy. */
export function useShellFocus({
  environment,
  read,
  nativeFocus,
  entry,
  dispatch,
  canReceiveInput,
  canReactivate,
  clearLeader,
  rememberPane,
}: ShellFocusOptions): ShellFocusController {
  const renderer = useRenderer();
  const { state, snapshot, model, layout } = environment;
  const { activeTab, paneIds } = model;
  const { navigatorMode, navigatorVisible, resizeBlocked, undersized } = layout;
  const presentationGeneration = useRef(0);
  const drawerReturn = useRef<Renderable | null>(null);
  const guardReturn = useRef<Renderable | null>(null);
  const lastNavigatorControl = useRef<"filter" | "results">("results");
  const dialogKey =
    state.dialog === null
      ? null
      : state.dialog.kind === "sessions"
        ? "sessions"
        : state.dialog.kind === "archive"
          ? `archive:${state.dialog.itemId}`
          : `create:${state.dialog.createKind}`;

  function beforeDispatch(previous: ShellState, next: ShellState, action: ShellAction): void {
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
  }
  function observeNativeFocus(target: Renderable | null): void {
    const focus = focusTargetFor(target);
    if (focus?.region === "navigator") {
      lastNavigatorControl.current = focus.control ?? "results";
    }
  }
  useLayoutEffect(() => {
    function onResize(): void {
      if (renderer.width < 80) {
        guardReturn.current ??= renderer.currentFocusedRenderable;
        entry.cancelInput();
        clearLeader();
        renderer.currentFocusedRenderable?.blur();
      }
      dispatch({ type: "presentation.resize", width: renderer.width });
    }
    renderer.on(CliRenderEvents.RESIZE, onResize);
    return () => {
      renderer.off(CliRenderEvents.RESIZE, onResize);
    };
  }, [renderer]);
  const previousMode = useRef(layout.navigatorMode);
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
          read().state.dialog ||
          renderer.width < 80 ||
          read().state.navigatorOpen
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
      read().state.focus.region === "navigator" &&
      !entry.isClosingDrawer()
    ) {
      dispatch({ type: "focus.set", focus: { region: "category" } });
    }
  }, [navigatorVisible, state.focus.region]);

  const { focus: resolvedFocus, focusedPaneId } = resolveShellFocus({
    focus: entry.focusFor(model, state.focus),
    rememberedPaneId: state.lastPaneByTab[activeTab?.id ?? ""] ?? null,
    paneIds,
    runningPaneIds: paneIds.filter((id) =>
      snapshot?.panes.some((pane) => pane.id === id && pane.processStatus === "running"),
    ),
    reactivatePaneIds: paneIds.filter(canReactivate),
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
      (nativeTarget.region !== "workbench" || paneIds.includes(nativeTarget.paneId)) &&
      nativeFocus === renderer.currentFocusedRenderable &&
      !transientWorkbenchProjection
    ) {
      dispatch({ type: "focus.set", focus: nativeTarget, tabId: activeTab?.id });
    }
  }, [nativeFocus, dialogKey, undersized, state.focus]);

  function setFocus(target: FocusTarget): void {
    if (target.region === "navigator" && target.control === undefined) {
      target = { ...target, control: lastNavigatorControl.current };
    }
    if (
      renderer.width < 80 ||
      ((target.region === "workbench" || target.region === "tabs") && !canReceiveInput())
    ) {
      return;
    }
    if (target.region === "workbench") {
      const current = read();
      if (
        current.model.activeItem?.archived ||
        current.snapshot?.items.some(
          (item) => item.id === current.model.activeItem?.parentId && item.archived,
        )
      ) {
        return;
      }
      if (activeTab) {
        rememberPane(activeTab.id, target.paneId);
      }
      if (
        !(target.control === "reactivate"
          ? canReactivate(target.paneId)
          : canReceiveInput(target.paneId))
      ) {
        if (activeTab && current.model.paneIds.includes(target.paneId)) {
          // Logical selection survives even when native input is prohibited.
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
  return { focus, focusedPaneId, setFocus, beforeDispatch, observeNativeFocus };
}

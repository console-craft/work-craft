import type { CategoryKind, Snapshot } from "@work-craft/server/client";

import { focusAfterNavigatorHide, focusKey, type FocusTarget } from "@/input/focus.ts";
import {
  categoriesForWorkspace,
  navigatorEntries,
  navigatorItemKey,
  sessionsInOrder,
  workspacesForSession,
} from "@/navigation/model.ts";
import {
  clearOperationalError,
  type OperationalError,
  reportOperationalError,
  retainedErrorSources,
  retainsErrorSource,
} from "@/shell/errors.ts";
import { DEFAULT_NAVIGATOR_WIDTH, resizeNavigatorWidth } from "@/shell/layout.ts";
import type { CreateKind } from "@/shell/model.ts";
import { paneIds } from "@/workbench/layout.ts";
import { selectedTab, surfaceForItem, tabsForSurface } from "@/workbench/model";

export type ShellRegion = "workspace" | "session" | "category" | "navigator" | "tabs" | "workbench";

export type DialogState =
  | { kind: "sessions"; returnFocus: FocusTarget }
  | { kind: "create"; createKind: CreateKind; returnFocus: FocusTarget }
  | { kind: "archive"; itemId: string; title: string; path: string; returnFocus: FocusTarget }
  | null;

export type ShellState = {
  navigatorQuery: string;
  navigatorScopes: Record<
    string,
    { query: string; cursor: string | null; expanded: ReadonlySet<string> }
  >;
  navigatorOrder: string[];
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  activeCategory: CategoryKind;
  activeNavigatorKey: string | null;
  /** A successful open may precede the snapshot containing its new item. */
  pendingNavigatorActivation: { epoch: string; revision: number } | null;
  navigatorCursorKey: string | null;
  tabCursorId: string | null;
  focus: FocusTarget;
  lastPaneByTab: Record<string, string>;
  navigatorOpen: boolean;
  widthBand: "wide" | "narrow" | "blocked";
  navigatorWidth: number;
  expandedRootIds: ReadonlySet<string>;
  workspaceViewportStart: number;
  dialog: DialogState;
  promptValue: string;
  operationalError: OperationalError | null;
  sourceFailures: Record<string, number>;
  failureFingerprints: Record<string, string>;
  fieldError: string | null;
  errorEpoch: string | null;
};

export type ShellAction =
  | { type: "navigator.query"; query: string }
  | { type: "navigator.hide" }
  | { type: "presentation.resize"; width: number }
  | { type: "snapshot.reconcile"; snapshot: Snapshot }
  | { type: "session.activate"; id: string }
  | {
      type: "focus.set";
      focus: FocusTarget;
      tabId?: string;
    }
  | { type: "workspace.activate"; id: string }
  | { type: "category.activate"; category: CategoryKind }
  | { type: "navigator.cursor"; key: string | null }
  | {
      type: "navigator.activate";
      key: string;
      pending?: NonNullable<ShellState["pendingNavigatorActivation"]>;
    }
  | { type: "tab.cursor"; id: string | null }
  | { type: "root.toggle"; rootId: string }
  | { type: "navigator.toggle"; hasWorkbench: boolean }
  | { type: "navigator.reveal" }
  | { type: "navigator.resize"; direction: -1 | 1; terminalWidth: number }
  | { type: "workspace.viewport"; start: number }
  | { type: "dialog.open"; dialog: Exclude<DialogState, null> }
  | { type: "dialog.close" }
  | { type: "prompt.set"; value: string }
  | { type: "field.error"; message: string | null }
  | { type: "source.report"; error: OperationalError; now: number }
  | { type: "source.clear"; sourceKey: string; requestId: number }
  | { type: "sources.observe"; epoch: string; failures: OperationalError[]; now: number };

export function createInitialShellState(width = 120): ShellState {
  return {
    navigatorQuery: "",
    navigatorScopes: {},
    navigatorOrder: [],
    activeSessionId: null,
    activeWorkspaceId: null,
    activeCategory: "inbox",
    activeNavigatorKey: null,
    pendingNavigatorActivation: null,
    navigatorCursorKey: null,
    tabCursorId: null,
    focus: { region: "workspace" },
    lastPaneByTab: {},
    navigatorOpen: width >= 120,
    widthBand: width < 80 ? "blocked" : width < 120 ? "narrow" : "wide",
    navigatorWidth: DEFAULT_NAVIGATOR_WIDTH,
    expandedRootIds: new Set(),
    workspaceViewportStart: 0,
    dialog: null,
    promptValue: "",
    operationalError: null,
    sourceFailures: {},
    failureFingerprints: {},
    fieldError: null,
    errorEpoch: null,
  };
}

export function reduceShellState(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "snapshot.reconcile":
      return reconcileShellState(state, action.snapshot);
    case "session.activate":
      return {
        ...state,
        ...changeScope(state, null, state.activeCategory),
        activeSessionId: action.id,
        activeWorkspaceId: null,
        activeNavigatorKey: null,
        pendingNavigatorActivation: null,
        focus: { region: "workspace" },
        navigatorCursorKey: null,
        tabCursorId: null,
        dialog: null,
        promptValue: "",
      };
    case "focus.set":
      if (
        focusKey(state.focus) === focusKey(action.focus) &&
        (action.focus.region !== "workbench" ||
          state.lastPaneByTab[action.tabId ?? state.tabCursorId ?? ""] === action.focus.paneId)
      ) {
        return state;
      }
      return {
        ...state,
        focus: action.focus,
        lastPaneByTab:
          action.focus.region === "workbench" && (action.tabId ?? state.tabCursorId)
            ? { ...state.lastPaneByTab, [action.tabId ?? state.tabCursorId!]: action.focus.paneId }
            : state.lastPaneByTab,
      };
    case "workspace.activate":
      return {
        ...state,
        ...changeScope(state, action.id, state.activeCategory),
        activeWorkspaceId: action.id,
        activeNavigatorKey: null,
        pendingNavigatorActivation: null,
      };
    case "category.activate":
      return {
        ...state,
        ...changeScope(state, state.activeWorkspaceId, action.category),
        activeCategory: action.category,
        activeNavigatorKey: null,
        pendingNavigatorActivation: null,
      };
    case "navigator.cursor":
      return { ...state, navigatorCursorKey: action.key };
    case "navigator.query":
      return { ...state, navigatorQuery: action.query };
    case "navigator.activate":
      return {
        ...state,
        activeNavigatorKey: action.key,
        navigatorCursorKey: action.key,
        pendingNavigatorActivation: action.pending ?? null,
      };
    case "tab.cursor":
      return { ...state, tabCursorId: action.id };
    case "root.toggle": {
      const expandedRootIds = new Set(state.expandedRootIds);
      if (expandedRootIds.has(action.rootId)) {
        expandedRootIds.delete(action.rootId);
      } else {
        expandedRootIds.add(action.rootId);
      }
      return { ...state, expandedRootIds };
    }
    case "navigator.reveal":
      return !state.navigatorOpen && state.widthBand !== "blocked"
        ? { ...state, navigatorOpen: true }
        : state;
    case "navigator.toggle": {
      if (state.widthBand === "blocked") {
        return state;
      }
      if (!state.navigatorOpen) {
        return { ...state, navigatorOpen: true };
      }
      return {
        ...state,
        navigatorOpen: false,
        focus: focusAfterNavigatorHide(
          state.focus,
          state.lastPaneByTab[state.tabCursorId ?? ""] ?? null,
          action.hasWorkbench,
        ),
      };
    }
    case "navigator.hide":
      return { ...state, navigatorOpen: false };
    case "presentation.resize": {
      const widthBand = action.width < 80 ? "blocked" : action.width < 120 ? "narrow" : "wide";
      if (widthBand === state.widthBand) {
        return state;
      }
      return {
        ...state,
        widthBand,
        navigatorOpen:
          widthBand === "blocked" || (state.widthBand === "wide" && widthBand === "narrow")
            ? false
            : state.navigatorOpen,
      };
    }
    case "navigator.resize":
      return {
        ...state,
        navigatorWidth: resizeNavigatorWidth(
          state.navigatorWidth,
          action.direction,
          action.terminalWidth,
        ),
      };
    case "workspace.viewport":
      return { ...state, workspaceViewportStart: Math.max(0, action.start) };
    case "dialog.open":
      return { ...state, dialog: action.dialog, promptValue: "", fieldError: null };
    case "dialog.close":
      if (state.dialog === null) {
        return state;
      }
      return {
        ...state,
        dialog:
          state.dialog.kind === "create" &&
          state.dialog.createKind === "session" &&
          state.activeSessionId === null
            ? { kind: "sessions", returnFocus: state.dialog.returnFocus }
            : null,
        focus: state.dialog.returnFocus,
        promptValue: "",
      };
    case "prompt.set":
      return { ...state, promptValue: action.value, fieldError: null };
    case "field.error":
      return { ...state, fieldError: action.message };
    case "source.report":
      return {
        ...state,
        operationalError: reportOperationalError(state.operationalError, action.error, action.now),
        sourceFailures: {
          ...state.sourceFailures,
          [action.error.sourceKey]: action.error.requestId,
        },
      };
    case "source.clear": {
      const sourceFailures = { ...state.sourceFailures };
      if ((sourceFailures[action.sourceKey] ?? Infinity) <= action.requestId) {
        delete sourceFailures[action.sourceKey];
      }
      const current = state.operationalError;
      return {
        ...state,
        sourceFailures,
        operationalError:
          current?.sourceKey === action.sourceKey && current.requestId <= action.requestId
            ? clearOperationalError(current, action.sourceKey, current.requestId)
            : current,
      };
    }
    case "sources.observe": {
      const reset = state.errorEpoch !== action.epoch;
      const fingerprints: Record<string, string> = {};
      let operationalError = reset ? null : state.operationalError;
      for (const failure of action.failures) {
        const fingerprint = JSON.stringify([failure.operation, failure.message]);
        fingerprints[failure.sourceKey] = fingerprint;
        if (reset || state.failureFingerprints[failure.sourceKey] !== fingerprint) {
          operationalError = reportOperationalError(operationalError, failure, action.now);
        }
      }
      if (
        operationalError?.origin === "background" &&
        !(operationalError.sourceKey in fingerprints)
      ) {
        operationalError = null;
      }
      return {
        ...state,
        errorEpoch: action.epoch,
        operationalError,
        failureFingerprints: fingerprints,
        sourceFailures: reset ? {} : state.sourceFailures,
      };
    }
  }
}

export function reconcileShellState(state: ShellState, snapshot: Snapshot): ShellState {
  const sessions = sessionsInOrder(snapshot);
  const sessionStillExists = sessions.some(({ id }) => id === state.activeSessionId);
  const activeSessionId = sessionStillExists
    ? state.activeSessionId
    : sessions.length === 1
      ? sessions[0]!.id
      : null;
  const sessionChanged = activeSessionId !== state.activeSessionId;
  const workspaces =
    activeSessionId === null ? [] : workspacesForSession(snapshot, activeSessionId);
  const activeWorkspaceId = workspaces.some(({ id }) => id === state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : (workspaces[0]?.id ?? null);
  const categories =
    activeWorkspaceId === null ? [] : categoriesForWorkspace(snapshot, activeWorkspaceId);
  const activeCategory = categories.some(({ kind }) => kind === state.activeCategory)
    ? state.activeCategory
    : (categories[0]?.kind ?? "inbox");
  const scopedState =
    activeWorkspaceId === state.activeWorkspaceId && activeCategory === state.activeCategory
      ? state
      : { ...state, ...changeScope(state, activeWorkspaceId, activeCategory) };
  const expandedRootIds = scopedState.expandedRootIds;
  const entries =
    activeWorkspaceId === null
      ? []
      : navigatorEntries(
          snapshot,
          activeWorkspaceId,
          activeCategory,
          expandedRootIds,
          scopedState.navigatorQuery,
          process.env.HOME ?? "",
        );
  const pendingNavigatorActivation =
    state.pendingNavigatorActivation?.epoch === snapshot.epoch &&
    snapshot.revision < state.pendingNavigatorActivation.revision &&
    activeSessionId === state.activeSessionId &&
    activeWorkspaceId === state.activeWorkspaceId &&
    activeCategory === state.activeCategory
      ? state.pendingNavigatorActivation
      : null;
  // Creation chooses its item on success, not when its snapshot happens to arrive.
  const activeNavigatorKey =
    (state.activeNavigatorKey === null && state.dialog?.kind === "create") ||
    snapshot.items.some(
      (item) =>
        navigatorItemKey(item) === state.activeNavigatorKey &&
        item.workspaceId === activeWorkspaceId &&
        item.category === activeCategory,
    ) ||
    pendingNavigatorActivation !== null
      ? state.activeNavigatorKey
      : (entries[0]?.key ?? null);
  const oldIndex = scopedState.navigatorOrder.indexOf(scopedState.navigatorCursorKey ?? "");
  const surviving = new Set(entries.map((entry) => entry.key));
  const neighbor =
    scopedState.navigatorOrder.slice(oldIndex + 1).find((key) => surviving.has(key)) ??
    scopedState.navigatorOrder
      .slice(0, Math.max(0, oldIndex))
      .reverse()
      .find((key) => surviving.has(key));
  const navigatorCursorKey = entries.some(({ key }) => key === scopedState.navigatorCursorKey)
    ? scopedState.navigatorCursorKey
    : (neighbor ?? entries.find((entry) => entry.matches)?.key ?? entries[0]?.key ?? null);
  const itemId = snapshot.items.find((item) => navigatorItemKey(item) === activeNavigatorKey)?.id;
  const surface = surfaceForItem(snapshot, itemId);
  const tabs = tabsForSurface(snapshot, surface?.id);
  const tabCursorId = tabs.some(({ id }) => id === state.tabCursorId)
    ? state.tabCursorId
    : tabs.some(({ id }) => id === surface?.activeTabId)
      ? surface!.activeTabId
      : (tabs[0]?.id ?? null);
  const activeTab = selectedTab(tabs, surface?.activeTabId) ?? tabs[0];
  const panes = paneIds(activeTab?.layout ?? null);
  const selectedPaneId = state.focus.region === "workbench" ? state.focus.paneId : null;
  const focus =
    sessionChanged && activeSessionId !== null
      ? { region: "workspace" as const }
      : state.focus.region === "workbench" &&
          (!panes.includes(state.focus.paneId) ||
            !snapshot.panes.some(
              (pane) =>
                pane.id === selectedPaneId &&
                pane.processStatus ===
                  (state.focus.region === "workbench" && state.focus.control === "reactivate"
                    ? "exited"
                    : "running"),
            ))
        ? { region: "tabs" as const }
        : state.focus;
  const dialog =
    activeSessionId === null
      ? { kind: "sessions" as const, returnFocus: state.focus }
      : sessionChanged && state.dialog?.kind === "create"
        ? null
        : state.dialog;

  const sourceKeys = retainedErrorSources(snapshot);
  function retainsSource(sourceKey: string): boolean {
    return retainsErrorSource(sourceKey, sourceKeys);
  }
  return {
    ...scopedState,
    operationalError:
      state.operationalError && retainsSource(state.operationalError.sourceKey)
        ? state.operationalError
        : null,
    sourceFailures: Object.fromEntries(
      Object.entries(state.sourceFailures).filter(([key]) => retainsSource(key)),
    ),
    activeSessionId,
    activeWorkspaceId,
    activeCategory,
    activeNavigatorKey,
    pendingNavigatorActivation,
    navigatorCursorKey,
    navigatorOrder: entries.map((entry) => entry.key),
    tabCursorId,
    focus,
    expandedRootIds,
    dialog,
    promptValue: dialog?.kind === "create" ? state.promptValue : "",
    lastPaneByTab: Object.fromEntries(
      Object.entries(state.lastPaneByTab).filter(
        ([tabId, paneId]) =>
          snapshot.tabs.some((tab) => tab.id === tabId && paneIds(tab.layout).includes(paneId)) &&
          snapshot.panes.some((pane) => pane.id === paneId),
      ),
    ),
  };
}

function changeScope(
  state: ShellState,
  workspaceId: string | null,
  category: CategoryKind,
): Pick<
  ShellState,
  "navigatorScopes" | "navigatorQuery" | "navigatorCursorKey" | "expandedRootIds" | "navigatorOrder"
> {
  const key = JSON.stringify([state.activeWorkspaceId, state.activeCategory]);
  const navigatorScopes = {
    ...state.navigatorScopes,
    [key]: {
      query: state.navigatorQuery,
      cursor: state.navigatorCursorKey,
      expanded: state.expandedRootIds,
    },
  };
  const next = navigatorScopes[JSON.stringify([workspaceId, category])];
  return {
    navigatorScopes,
    navigatorQuery: next?.query ?? "",
    navigatorCursorKey: next?.cursor ?? null,
    expandedRootIds: next?.expanded ?? new Set(),
    navigatorOrder: [],
  };
}

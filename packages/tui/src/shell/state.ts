import type { ClientAttachment, SessionNavigation, Snapshot } from "@work-craft/server/client";

import { focusAfterNavigatorHide, focusKey, type FocusTarget } from "@/input/focus.ts";
import {
  clearOperationalError,
  type OperationalError,
  reportOperationalError,
  retainedErrorSources,
  retainsErrorSource,
} from "@/shell/errors.ts";
import { DEFAULT_NAVIGATOR_WIDTH, resizeNavigatorWidth } from "@/shell/layout.ts";
import { type CreateKind, deriveShellModel } from "@/shell/model.ts";

export type ShellRegion = "workspace" | "session" | "category" | "navigator" | "tabs" | "workbench";

export type DialogState =
  | { kind: "sessions"; returnFocus: FocusTarget; awaitingAttachment?: true }
  | {
      kind: "create";
      createKind: CreateKind;
      returnFocus: FocusTarget;
      scope: { epoch: string; navigation: SessionNavigation | null; parentId: string | null };
    }
  | { kind: "archive"; itemId: string; title: string; path: string; returnFocus: FocusTarget }
  | null;

export type ShellState = {
  navigatorQuery: string;
  navigatorScopes: Record<
    string,
    { query: string; cursor: string | null; expanded: ReadonlySet<string> }
  >;
  navigatorOrder: string[];
  /** Presentation-memory identity, never an active selection. */
  navigatorScope: string;
  navigatorCursorKey: string | null;
  tabCursorId: string | null;
  focus: FocusTarget;
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
  | { type: "snapshot.reconcile"; snapshot: Snapshot; attachment: ClientAttachment | null }
  | { type: "session.attached" }
  | {
      type: "focus.set";
      focus: FocusTarget;
      tabId?: string;
    }
  | { type: "navigator.cursor"; key: string | null }
  | { type: "tab.cursor"; id: string | null }
  | { type: "root.toggle"; rootId: string }
  | { type: "navigator.toggle"; hasWorkbench: boolean; paneId?: string | null }
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
    navigatorScope: "",
    navigatorCursorKey: null,
    tabCursorId: null,
    focus: { region: "workspace" },
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
      return reconcileShellState(state, action.snapshot, action.attachment);
    case "session.attached":
      return {
        ...state,
        focus: { region: "workspace" },
        navigatorCursorKey: null,
        tabCursorId: null,
        dialog: null,
        promptValue: "",
      };
    case "focus.set":
      if (focusKey(state.focus) === focusKey(action.focus)) {
        return state;
      }
      return {
        ...state,
        focus: action.focus,
      };
    case "navigator.cursor":
      return { ...state, navigatorCursorKey: action.key };
    case "navigator.query":
      return { ...state, navigatorQuery: action.query };
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
        focus: focusAfterNavigatorHide(state.focus, action.paneId ?? null, action.hasWorkbench),
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
          state.dialog.scope.navigation === null
            ? { kind: "sessions", returnFocus: state.dialog.returnFocus, awaitingAttachment: true }
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

export function reconcileShellState(
  state: ShellState,
  snapshot: Snapshot,
  attachment: ClientAttachment | null,
): ShellState {
  const navigation = snapshot.navigation.find(
    ({ sessionId }) => sessionId === attachment?.sessionId,
  );
  const scope = JSON.stringify([navigation?.workspaceId ?? null, navigation?.category ?? null]);
  const scopedState =
    scope === state.navigatorScope ? state : { ...state, ...changeScope(state, scope) };
  const model = deriveShellModel({ snapshot, state: scopedState, attachment });
  const entries = model.entries;
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
  const tabs = model.tabs;
  const tabCursorId = tabs.some(({ id }) => id === state.tabCursorId)
    ? state.tabCursorId
    : (model.activeTab?.id ?? tabs[0]?.id ?? null);
  const selectedPaneId = navigation?.paneId ?? null;
  const focus =
    state.dialog === null && state.focus.region === "workbench"
      ? selectedPaneId &&
        model.paneIds.includes(selectedPaneId) &&
        snapshot.panes.some(
          (pane) =>
            pane.id === selectedPaneId &&
            pane.processStatus ===
              (state.focus.region === "workbench" && state.focus.control === "reactivate"
                ? "exited"
                : "running"),
        )
        ? { ...state.focus, paneId: selectedPaneId }
        : { region: "tabs" as const }
      : state.focus;
  const draftSessionId =
    state.dialog?.kind === "create" ? state.dialog.scope.navigation?.sessionId : undefined;
  const deletedDraftSession =
    draftSessionId !== undefined && !snapshot.sessions.some(({ id }) => id === draftSessionId);
  const dialog =
    !attachment?.sessionId && (state.dialog?.kind !== "create" || deletedDraftSession)
      ? state.dialog?.kind === "sessions"
        ? state.dialog
        : { kind: "sessions" as const, returnFocus: state.focus, awaitingAttachment: true as const }
      : attachment?.sessionId &&
          state.dialog?.kind === "sessions" &&
          state.dialog.awaitingAttachment
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
    navigatorCursorKey,
    navigatorOrder: entries.map((entry) => entry.key),
    tabCursorId,
    focus,
    dialog,
    promptValue: dialog?.kind === "create" ? state.promptValue : "",
  };
}

function changeScope(
  state: ShellState,
  scope: string,
): Pick<
  ShellState,
  | "navigatorScope"
  | "navigatorScopes"
  | "navigatorQuery"
  | "navigatorCursorKey"
  | "expandedRootIds"
  | "navigatorOrder"
> {
  const navigatorScopes = {
    ...state.navigatorScopes,
    [state.navigatorScope]: {
      query: state.navigatorQuery,
      cursor: state.navigatorCursorKey,
      expanded: state.expandedRootIds,
    },
  };
  const next = navigatorScopes[scope];
  return {
    navigatorScope: scope,
    navigatorScopes,
    navigatorQuery: next?.query ?? "",
    navigatorCursorKey: next?.cursor ?? null,
    expandedRootIds: next?.expanded ?? new Set(),
    navigatorOrder: [],
  };
}

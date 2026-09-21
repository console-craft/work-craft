import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import { focusAfterNavigatorHide, type FocusTarget } from "../input/focus.ts";
import { navigatorEntries, workspacesForSession } from "../navigation/model.ts";
import { paneIds } from "../workbench/layout.ts";
import {
  DEFAULT_NAVIGATOR_WIDTH,
  resizeNavigatorWidth,
  type NavigatorPreference,
} from "./layout.ts";
import type { CreateKind } from "./model.ts";

export type ShellRegion = "workspace" | "session" | "category" | "navigator" | "tabs" | "workbench";

export type DialogState =
  | { kind: "sessions"; returnFocus: FocusTarget }
  | { kind: "create"; createKind: CreateKind; returnFocus: FocusTarget }
  | null;

export type ShellState = {
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  activeCategory: CategoryKind;
  activeNavigatorKey: string | null;
  workspaceCursorId: string | null;
  categoryCursor: CategoryKind;
  navigatorCursorKey: string | null;
  tabCursorId: string | null;
  focus: FocusTarget;
  lastWorkbenchPaneId: string | null;
  navigatorPreference: NavigatorPreference;
  navigatorWidth: number;
  expandedProjectIds: ReadonlySet<string>;
  navigatorScrollTop: number;
  workspaceViewportStart: number;
  dialog: DialogState;
  promptValue: string;
  errors: Partial<Record<ShellRegion, string>>;
};

export type ShellAction =
  | { type: "snapshot.reconcile"; snapshot: Snapshot }
  | { type: "session.activate"; id: string }
  | { type: "focus.set"; focus: FocusTarget }
  | { type: "workspace.cursor"; id: string | null }
  | { type: "workspace.activate"; id: string }
  | { type: "category.cursor"; category: CategoryKind }
  | { type: "category.activate"; category: CategoryKind }
  | { type: "navigator.cursor"; key: string | null }
  | { type: "navigator.activate"; key: string }
  | { type: "tab.cursor"; id: string | null }
  | { type: "project.toggle"; projectId: string }
  | { type: "navigator.toggle"; hasWorkbench: boolean }
  | { type: "navigator.resize"; direction: -1 | 1; terminalWidth: number }
  | { type: "navigator.scroll"; start: number }
  | { type: "workspace.viewport"; start: number }
  | { type: "dialog.open"; dialog: Exclude<DialogState, null> }
  | { type: "dialog.close" }
  | { type: "prompt.set"; value: string }
  | { type: "error.set"; region: ShellRegion; error: string | null };

export function createInitialShellState(): ShellState {
  return {
    activeSessionId: null,
    activeWorkspaceId: null,
    activeCategory: "inbox",
    activeNavigatorKey: null,
    workspaceCursorId: null,
    categoryCursor: "inbox",
    navigatorCursorKey: null,
    tabCursorId: null,
    focus: { region: "category" },
    lastWorkbenchPaneId: null,
    navigatorPreference: "auto",
    navigatorWidth: DEFAULT_NAVIGATOR_WIDTH,
    expandedProjectIds: new Set(),
    navigatorScrollTop: 0,
    workspaceViewportStart: 0,
    dialog: null,
    promptValue: "",
    errors: {},
  };
}

export function reduceShellState(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "snapshot.reconcile":
      return reconcileShellState(state, action.snapshot);
    case "session.activate":
      return {
        ...state,
        activeSessionId: action.id,
        activeWorkspaceId: null,
        activeNavigatorKey: null,
        workspaceCursorId: null,
        navigatorCursorKey: null,
        tabCursorId: null,
        dialog: null,
        promptValue: "",
      };
    case "focus.set":
      return {
        ...state,
        focus: action.focus,
        lastWorkbenchPaneId:
          action.focus.region === "workbench" ? action.focus.paneId : state.lastWorkbenchPaneId,
      };
    case "workspace.cursor":
      return { ...state, workspaceCursorId: action.id };
    case "workspace.activate":
      return {
        ...state,
        activeWorkspaceId: action.id,
        workspaceCursorId: action.id,
        activeNavigatorKey: null,
        navigatorCursorKey: null,
      };
    case "category.cursor":
      return { ...state, categoryCursor: action.category };
    case "category.activate":
      return {
        ...state,
        activeCategory: action.category,
        categoryCursor: action.category,
        activeNavigatorKey: null,
        navigatorCursorKey: null,
      };
    case "navigator.cursor":
      return { ...state, navigatorCursorKey: action.key };
    case "navigator.activate":
      return { ...state, activeNavigatorKey: action.key, navigatorCursorKey: action.key };
    case "tab.cursor":
      return { ...state, tabCursorId: action.id };
    case "project.toggle": {
      const expandedProjectIds = new Set(state.expandedProjectIds);
      if (expandedProjectIds.has(action.projectId)) {
        expandedProjectIds.delete(action.projectId);
      } else {
        expandedProjectIds.add(action.projectId);
      }
      return { ...state, expandedProjectIds };
    }
    case "navigator.toggle": {
      if (state.navigatorPreference === "hidden") {
        return { ...state, navigatorPreference: "auto" };
      }
      return {
        ...state,
        navigatorPreference: "hidden",
        focus: focusAfterNavigatorHide(state.focus, state.lastWorkbenchPaneId, action.hasWorkbench),
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
    case "navigator.scroll":
      return { ...state, navigatorScrollTop: Math.max(0, action.start) };
    case "workspace.viewport":
      return { ...state, workspaceViewportStart: Math.max(0, action.start) };
    case "dialog.open":
      return { ...state, dialog: action.dialog, promptValue: "" };
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
      return { ...state, promptValue: action.value };
    case "error.set": {
      const errors = { ...state.errors };
      if (action.error === null) {
        delete errors[action.region];
      } else {
        errors[action.region] = action.error;
      }
      return { ...state, errors };
    }
  }
}

export function reconcileShellState(state: ShellState, snapshot: Snapshot): ShellState {
  const sessions = [...snapshot.sessions].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
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
  const categories = snapshot.categories
    .filter(({ workspaceId }) => workspaceId === activeWorkspaceId)
    .sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind));
  const activeCategory = categories.some(({ kind }) => kind === state.activeCategory)
    ? state.activeCategory
    : (categories[0]?.kind ?? "inbox");
  const projectIds = new Set(
    snapshot.projects
      .filter(
        (project) =>
          project.workspaceId === activeWorkspaceId && project.category === activeCategory,
      )
      .map(({ id }) => id),
  );
  const expandedProjectIds = new Set(
    [...state.expandedProjectIds].filter((id) => projectIds.has(id)),
  );
  const entries =
    activeWorkspaceId === null
      ? []
      : navigatorEntries(snapshot, activeWorkspaceId, activeCategory, expandedProjectIds);
  const activeNavigatorKey = entries.some(({ key }) => key === state.activeNavigatorKey)
    ? state.activeNavigatorKey
    : (entries[0]?.key ?? null);
  const navigatorCursorKey = entries.some(({ key }) => key === state.navigatorCursorKey)
    ? state.navigatorCursorKey
    : activeNavigatorKey;
  const activeEntry = entries.find(({ key }) => key === activeNavigatorKey);
  const itemId = activeEntry?.kind === "item" ? activeEntry.id : null;
  const surface = snapshot.surfaces.find((candidate) => candidate.itemId === itemId);
  const tabs = snapshot.tabs
    .filter(({ surfaceId }) => surfaceId === surface?.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const tabCursorId = tabs.some(({ id }) => id === state.tabCursorId)
    ? state.tabCursorId
    : tabs.some(({ id }) => id === surface?.activeTabId)
      ? surface!.activeTabId
      : (tabs[0]?.id ?? null);
  const activeTab = tabs.find(({ id }) => id === surface?.activeTabId) ?? tabs[0];
  const panes = paneIds(activeTab?.layout ?? null);
  const focus =
    state.focus.region === "workbench" && !panes.includes(state.focus.paneId)
      ? { region: "tabs" as const }
      : state.focus;
  const dialog =
    activeSessionId === null
      ? { kind: "sessions" as const, returnFocus: state.focus }
      : sessionChanged && state.dialog?.kind === "create"
        ? null
        : state.dialog;

  return {
    ...state,
    activeSessionId,
    activeWorkspaceId,
    activeCategory,
    activeNavigatorKey,
    workspaceCursorId: workspaces.some(({ id }) => id === state.workspaceCursorId)
      ? state.workspaceCursorId
      : activeWorkspaceId,
    categoryCursor: categories.some(({ kind }) => kind === state.categoryCursor)
      ? state.categoryCursor
      : activeCategory,
    navigatorCursorKey,
    tabCursorId,
    focus,
    expandedProjectIds,
    dialog,
    promptValue: dialog?.kind === "create" ? state.promptValue : "",
  };
}

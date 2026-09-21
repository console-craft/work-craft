import type { CategoryKind, Snapshot } from "@work-craft/server/client";

import type { FocusTarget } from "@/input/focus.ts";
import {
  categoriesForWorkspace,
  navigatorEntries,
  type NavigatorEntry,
  projectIdForEntry,
  workspacesForSession,
} from "@/navigation/model.ts";
import type { NavigatorPreference } from "@/shell/layout.ts";
import { paneIds } from "@/workbench/layout.ts";

export type CreateKind = "session" | "workspace" | "project" | "item";

export type ShellModelState = {
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
};

export type ShellModel = {
  navigationKey: string;
  completionKey: string;
  sessions: Snapshot["sessions"];
  activeSession: Snapshot["sessions"][number] | undefined;
  workspaces: Snapshot["workspaces"];
  categories: Snapshot["categories"];
  entries: NavigatorEntry[];
  activeEntry: NavigatorEntry | undefined;
  surface: Snapshot["surfaces"][number] | undefined;
  tabs: Snapshot["tabs"];
  activeTab: Snapshot["tabs"][number] | undefined;
  paneIds: string[];
  sessionCursor: string | null;
  categoryIndex: number;
  navigatorActiveIndex: number;
  navigatorCursorIndex: number;
  tabActiveIndex: number;
  tabCursorIndex: number;
  workspaceCursorIndex: number;
  categoryCursorIndex: number;
  sessionCursorIndex: number;
  activeCategoryTitle: string;
  cursorEntry: NavigatorEntry | undefined;
};

const FIXED_CATEGORIES: readonly { kind: CategoryKind; title: string }[] = [
  { kind: "inbox", title: "Inbox" },
  { kind: "today", title: "Today" },
  { kind: "design", title: "Design" },
  { kind: "implementation", title: "Implementation" },
  { kind: "collaboration", title: "Collaboration" },
  { kind: "operations", title: "Operations" },
];

export function deriveShellModel(input: {
  snapshot: Snapshot | null;
  state: ShellModelState;
  sessionCursorId: string | null;
}): ShellModel {
  const { snapshot, state } = input;
  const sessions = [...(snapshot?.sessions ?? [])].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const activeSession = sessions.find(({ id }) => id === state.activeSessionId);
  const workspaces =
    snapshot === null || state.activeSessionId === null
      ? []
      : workspacesForSession(snapshot, state.activeSessionId);
  const projectedCategories =
    snapshot === null || state.activeWorkspaceId === null
      ? []
      : categoriesForWorkspace(snapshot, state.activeWorkspaceId);
  const categories =
    projectedCategories.length > 0
      ? projectedCategories
      : FIXED_CATEGORIES.map((category, position) => ({
          ...category,
          workspaceId: state.activeWorkspaceId ?? "",
          position,
        }));
  const entries =
    snapshot === null || state.activeWorkspaceId === null
      ? []
      : navigatorEntries(
          snapshot,
          state.activeWorkspaceId,
          state.activeCategory,
          state.expandedProjectIds,
        );
  const activeEntry = entries.find(({ key }) => key === state.activeNavigatorKey);
  const surface =
    snapshot === null || activeEntry?.kind !== "item"
      ? undefined
      : snapshot.surfaces.find(({ itemId }) => itemId === activeEntry.id);
  const tabs = [...(snapshot?.tabs ?? [])]
    .filter(({ surfaceId }) => surfaceId === surface?.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const activeTab = tabs.find(({ id }) => id === surface?.activeTabId) ?? tabs[0];
  const navigationKey = JSON.stringify([
    snapshot?.epoch ?? null,
    state.activeSessionId,
    state.activeWorkspaceId,
    state.activeCategory,
    state.activeNavigatorKey,
  ]);
  const sessionCursor = sessions.some(({ id }) => id === input.sessionCursorId)
    ? input.sessionCursorId
    : sessions.some(({ id }) => id === state.activeSessionId)
      ? state.activeSessionId
      : (sessions[0]?.id ?? null);

  return {
    navigationKey,
    completionKey: JSON.stringify([navigationKey, surface?.id ?? null, activeTab?.id ?? null]),
    sessions,
    activeSession,
    workspaces,
    categories,
    entries,
    activeEntry,
    surface,
    tabs,
    activeTab,
    paneIds: paneIds(activeTab?.layout ?? null),
    sessionCursor,
    categoryIndex: categories.findIndex(({ kind }) => kind === state.activeCategory),
    navigatorActiveIndex: entries.findIndex(({ key }) => key === state.activeNavigatorKey),
    navigatorCursorIndex: entries.findIndex(({ key }) => key === state.navigatorCursorKey),
    tabActiveIndex: tabs.findIndex(({ id }) => id === activeTab?.id),
    tabCursorIndex: tabs.findIndex(({ id }) => id === state.tabCursorId),
    workspaceCursorIndex: workspaces.findIndex(({ id }) => id === state.workspaceCursorId),
    categoryCursorIndex: categories.findIndex(({ kind }) => kind === state.categoryCursor),
    sessionCursorIndex: sessions.findIndex(({ id }) => id === sessionCursor),
    activeCategoryTitle:
      categories.find(({ kind }) => kind === state.activeCategory)?.title ?? "Work",
    cursorEntry: entries.find(({ key }) => key === state.navigatorCursorKey),
  };
}

export function resolveShellFocus(input: {
  focus: FocusTarget;
  lastWorkbenchPaneId: string | null;
  paneIds: readonly string[];
  undersized: boolean;
}): { focus: FocusTarget; focusedPaneId: string | null } {
  const focus =
    input.focus.region === "workbench" &&
    (input.undersized || !input.paneIds.includes(input.focus.paneId))
      ? { region: "tabs" as const }
      : input.focus;
  const focusedPaneId =
    focus.region === "workbench"
      ? focus.paneId
      : input.paneIds.includes(input.lastWorkbenchPaneId ?? "")
        ? input.lastWorkbenchPaneId
        : (input.paneIds[0] ?? null);
  return { focus, focusedPaneId };
}

export function projectIdForShellContext(
  state: ShellModelState,
  snapshot: Snapshot,
): string | undefined {
  if (state.activeWorkspaceId === null) {
    return undefined;
  }
  const entries = navigatorEntries(
    snapshot,
    state.activeWorkspaceId,
    state.activeCategory,
    state.expandedProjectIds,
  );
  if (state.focus.region === "navigator") {
    return projectIdForEntry(entries.find((entry) => entry.key === state.navigatorCursorKey));
  }
  const itemId = state.activeNavigatorKey?.startsWith("item:")
    ? state.activeNavigatorKey.slice("item:".length)
    : undefined;
  return snapshot.items.find(({ id }) => id === itemId)?.projectId;
}

import type { CategoryKind, Snapshot } from "@work-craft/server/client";

import type { FocusTarget } from "@/input/focus.ts";
import {
  categoriesForWorkspace,
  navigatorEntries,
  type NavigatorEntry,
  navigatorItemKey,
  rootIdForEntry,
  sessionsInOrder,
  workspacesForSession,
} from "@/navigation/model.ts";
import { completionContextKey, navigationContextKey } from "@/shell/context";
import { paneIds } from "@/workbench/layout.ts";
import { selectedTab, surfaceForItem, tabsForSurface } from "@/workbench/model";

export type CreateKind = "session" | "workspace" | "directory" | "generic-root" | "generic-child";

export type ShellModelState = {
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  activeCategory: CategoryKind;
  activeNavigatorKey: string | null;
  navigatorCursorKey: string | null;
  tabCursorId: string | null;
  focus: FocusTarget;
  lastPaneByTab: Record<string, string>;
  navigatorOpen: boolean;
  navigatorWidth: number;
  expandedRootIds: ReadonlySet<string>;
  navigatorQuery: string;
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
  categoryIndex: number;
  navigatorActiveIndex: number;
  navigatorCursorIndex: number;
  tabActiveIndex: number;
  tabCursorIndex: number;
  activeCategoryTitle: string;
  cursorEntry: NavigatorEntry | undefined;
  activeItem: Snapshot["items"][number] | undefined;
  firstMatchId: string | undefined;
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
}): ShellModel {
  const { snapshot, state } = input;
  const sessions = snapshot === null ? [] : sessionsInOrder(snapshot);
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
          state.expandedRootIds,
          state.navigatorQuery,
          process.env.HOME ?? "",
        );
  const activeItem = snapshot?.items.find(
    (item) =>
      navigatorItemKey(item) === state.activeNavigatorKey &&
      item.workspaceId === state.activeWorkspaceId &&
      item.category === state.activeCategory,
  );
  const activeEntry = entries.find(({ id }) => id === activeItem?.id);
  const surface =
    snapshot === null || activeItem === undefined
      ? undefined
      : surfaceForItem(snapshot, activeItem.id);
  const tabs = snapshot === null ? [] : tabsForSurface(snapshot, surface?.id);
  const activeTab = selectedTab(tabs, surface?.activeTabId) ?? tabs[0];
  const navigationKey = navigationContextKey(
    snapshot?.epoch ?? null,
    state,
    state.activeNavigatorKey,
  );

  return {
    navigationKey,
    completionKey: completionContextKey(navigationKey, surface?.id ?? null, activeTab?.id ?? null),
    sessions,
    activeSession,
    workspaces,
    categories,
    entries,
    activeEntry,
    activeItem,
    firstMatchId: entries.find((entry) => entry.matches)?.id,
    surface,
    tabs,
    activeTab,
    paneIds: paneIds(activeTab?.layout ?? null),
    categoryIndex: categories.findIndex(({ kind }) => kind === state.activeCategory),
    navigatorActiveIndex: entries.findIndex(({ key }) => key === state.activeNavigatorKey),
    navigatorCursorIndex: entries.findIndex(({ key }) => key === state.navigatorCursorKey),
    tabActiveIndex: tabs.findIndex(({ id }) => id === activeTab?.id),
    tabCursorIndex: tabs.findIndex(({ id }) => id === state.tabCursorId),
    activeCategoryTitle:
      categories.find(({ kind }) => kind === state.activeCategory)?.title ?? "Work",
    cursorEntry: entries.find(({ key }) => key === state.navigatorCursorKey),
  };
}

export function resolveShellFocus(input: {
  focus: FocusTarget;
  rememberedPaneId: string | null;
  paneIds: readonly string[];
  runningPaneIds: readonly string[];
  reactivatePaneIds?: readonly string[];
  undersized: boolean;
}): { focus: FocusTarget; focusedPaneId: string | null } {
  const focusedPaneId =
    input.focus.region === "workbench" && input.paneIds.includes(input.focus.paneId)
      ? input.focus.paneId
      : input.paneIds.includes(input.rememberedPaneId ?? "")
        ? input.rememberedPaneId
        : (input.paneIds[0] ?? null);
  const focus =
    input.focus.region === "workbench" &&
    (input.undersized ||
      !input.paneIds.includes(input.focus.paneId) ||
      !(
        input.focus.control === "reactivate"
          ? (input.reactivatePaneIds ?? [])
          : input.runningPaneIds
      ).includes(input.focus.paneId))
      ? { region: "tabs" as const }
      : input.focus;
  return { focus, focusedPaneId };
}

export function genericRootIdForShellContext(
  state: ShellModelState,
  snapshot: Snapshot,
): string | undefined {
  if (state.activeWorkspaceId === null || state.activeCategory === "implementation") {
    return undefined;
  }
  const entries = navigatorEntries(
    snapshot,
    state.activeWorkspaceId,
    state.activeCategory,
    state.expandedRootIds,
  );
  const entry = entries.find(
    (entry) =>
      entry.key ===
      (state.focus.region === "navigator" ? state.navigatorCursorKey : state.activeNavigatorKey),
  );
  const active = snapshot.items.find((item) => navigatorItemKey(item) === state.activeNavigatorKey);
  const rootId =
    state.focus.region === "navigator" ? rootIdForEntry(entry) : (active?.parentId ?? active?.id);
  return snapshot.items.some(
    (item) => item.id === rootId && item.kind === "generic" && !item.archived,
  )
    ? rootId
    : undefined;
}

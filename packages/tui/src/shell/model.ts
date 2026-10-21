import type { ClientAttachment, SessionNavigation, Snapshot } from "@work-craft/server/client";

import type { FocusTarget } from "@/input/focus.ts";
import {
  categoriesForWorkspace,
  navigatorEntries,
  type NavigatorEntry,
  rootIdForEntry,
  sessionsInOrder,
  workspacesForSession,
} from "@/navigation/model.ts";
import { completionContextKey, navigationContextKey } from "@/shell/context";
import { paneIds } from "@/workbench/layout.ts";
import { selectedTab, surfaceForItem, tabsForSurface } from "@/workbench/model";

export type CreateKind = "session" | "workspace" | "directory" | "generic-root" | "generic-child";

export type ShellModelState = {
  navigatorCursorKey: string | null;
  tabCursorId: string | null;
  focus: FocusTarget;
  navigatorOpen: boolean;
  navigatorWidth: number;
  expandedRootIds: ReadonlySet<string>;
  navigatorQuery: string;
};

export type ShellModel = {
  navigation: SessionNavigation | null;
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

export function deriveShellModel(input: {
  snapshot: Snapshot | null;
  state: ShellModelState;
  attachment: ClientAttachment | null;
}): ShellModel {
  const { snapshot, state, attachment } = input;
  const navigation =
    snapshot?.navigation.find(({ sessionId }) => sessionId === attachment?.sessionId) ?? null;
  const workspaceId = navigation?.workspaceId ?? null;
  const category = navigation?.category ?? null;
  const sessions = snapshot === null ? [] : sessionsInOrder(snapshot);
  const activeSession = sessions.find(({ id }) => id === attachment?.sessionId);
  const workspaces =
    snapshot === null || !attachment?.sessionId
      ? []
      : workspacesForSession(snapshot, attachment.sessionId);
  const categories =
    snapshot === null || workspaceId === null ? [] : categoriesForWorkspace(snapshot, workspaceId);
  const entries =
    snapshot === null || workspaceId === null || category === null
      ? []
      : navigatorEntries(
          snapshot,
          workspaceId,
          category,
          state.expandedRootIds,
          state.navigatorQuery,
          process.env.HOME ?? "",
        );
  const activeItem = snapshot?.items.find(
    (item) =>
      item.id === navigation?.itemId &&
      item.workspaceId === workspaceId &&
      item.category === category,
  );
  const activeEntry = entries.find(({ id }) => id === activeItem?.id);
  const surface =
    snapshot === null || activeItem === undefined
      ? undefined
      : surfaceForItem(snapshot, activeItem.id);
  const tabs = snapshot === null ? [] : tabsForSurface(snapshot, surface?.id);
  const activeTab = selectedTab(tabs, navigation?.tabId);
  const navigationKey = navigationContextKey(snapshot?.epoch ?? null, navigation);

  return {
    navigation,
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
    categoryIndex: categories.findIndex(({ kind }) => kind === category),
    navigatorActiveIndex: entries.findIndex(({ id }) => id === navigation?.itemId),
    navigatorCursorIndex: entries.findIndex(({ key }) => key === state.navigatorCursorKey),
    tabActiveIndex: tabs.findIndex(({ id }) => id === activeTab?.id),
    tabCursorIndex: tabs.findIndex(({ id }) => id === state.tabCursorId),
    activeCategoryTitle: categories.find(({ kind }) => kind === category)?.title ?? "Work",
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
  navigation: SessionNavigation | null,
): string | undefined {
  if (
    !navigation?.workspaceId ||
    !navigation.category ||
    navigation.category === "implementation"
  ) {
    return undefined;
  }
  const entries = navigatorEntries(
    snapshot,
    navigation.workspaceId,
    navigation.category,
    state.expandedRootIds,
  );
  const entry = entries.find(
    (entry) => entry.key === (state.focus.region === "navigator" ? state.navigatorCursorKey : null),
  );
  const active = snapshot.items.find((item) => item.id === navigation.itemId);
  const rootId =
    state.focus.region === "navigator" ? rootIdForEntry(entry) : (active?.parentId ?? active?.id);
  return snapshot.items.some(
    (item) => item.id === rootId && item.kind === "generic" && !item.archived,
  )
    ? rootId
    : undefined;
}

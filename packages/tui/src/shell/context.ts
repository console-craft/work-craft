import type { SessionNavigation, Snapshot } from "@work-craft/server/client";

import type { ShellLayout } from "@/shell/layout";
import type { ShellModel } from "@/shell/model";
import type { ShellState } from "@/shell/state";

export type ShellEnvironment = {
  snapshot: Omit<Snapshot, "terminalHistories"> | null;
  state: ShellState;
  model: ShellModel;
  layout: ShellLayout;
  connected: boolean;
};

export function navigationContextKey(
  epoch: string | null,
  navigation: SessionNavigation | null,
): string {
  return JSON.stringify([epoch, navigation?.sessionId ?? null, navigation?.generation ?? null]);
}

export function completionContextKey(
  navigationKey: string,
  surfaceId: string | null,
  tabId: string | null,
): string {
  return JSON.stringify([navigationKey, surfaceId, tabId]);
}

/** Only filling this create's exact previously empty chain can advance its own context. */
export function isCreationNavigationCurrent(
  before: SessionNavigation | null,
  after: SessionNavigation | null,
  itemId: string,
  parentId: string | null,
  kind: "item" | "workspace" = "item",
): boolean {
  if (navigationContextKey(null, before) === navigationContextKey(null, after)) {
    return true;
  }
  if (kind === "workspace") {
    return (
      before !== null &&
      after !== null &&
      before.workspaceId === null &&
      before.category === null &&
      before.itemId === null &&
      before.tabId === null &&
      before.paneId === null &&
      after.sessionId === before.sessionId &&
      after.generation === before.generation + 1 &&
      after.workspaceId === itemId &&
      after.category === "inbox" &&
      after.itemId === null &&
      after.tabId === null &&
      after.paneId === null
    );
  }
  return (
    before !== null &&
    after !== null &&
    before.itemId === null &&
    after.sessionId === before.sessionId &&
    after.generation === before.generation + 1 &&
    after.workspaceId === before.workspaceId &&
    after.category === before.category &&
    after.itemId === (parentId ?? itemId) &&
    after.tabId === null &&
    after.paneId === null
  );
}

import type { Snapshot } from "@work-craft/server/client";

import type { ShellLayout } from "@/shell/layout";
import type { ShellModel } from "@/shell/model";
import type { ShellState } from "@/shell/state";

export type ShellEnvironment = {
  snapshot: Snapshot | null;
  state: ShellState;
  model: ShellModel;
  layout: ShellLayout;
  connected: boolean;
};

export function navigationContextKey(
  epoch: string | null,
  selection: Pick<ShellState, "activeSessionId" | "activeWorkspaceId" | "activeCategory">,
  navigatorKey: string | null,
): string {
  return JSON.stringify([
    epoch,
    selection.activeSessionId,
    selection.activeWorkspaceId,
    selection.activeCategory,
    navigatorKey,
  ]);
}

export function completionContextKey(
  navigationKey: string,
  surfaceId: string | null,
  tabId: string | null,
): string {
  return JSON.stringify([navigationKey, surfaceId, tabId]);
}

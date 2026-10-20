import type { Snapshot } from "@work-craft/server/client";

export function surfaceForItem(
  snapshot: Snapshot,
  itemId: string | undefined,
): Snapshot["surfaces"][number] | undefined {
  return snapshot.surfaces.find((surface) => surface.itemId === itemId);
}

export function tabsForSurface(
  snapshot: Snapshot,
  surfaceId: string | undefined,
): Snapshot["tabs"] {
  return snapshot.tabs
    .filter((tab) => tab.surfaceId === surfaceId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** Authoritative selection only; callers choose whether presentation may fall back. */
export function selectedTab(
  tabs: readonly Snapshot["tabs"][number][],
  activeTabId: string | null | undefined,
): Snapshot["tabs"][number] | undefined {
  return tabs.find((tab) => tab.id === activeTabId);
}

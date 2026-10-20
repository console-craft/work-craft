import type { Renderable } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";

export type PendingTerminalEntry = {
  kind: "item" | "tab" | "restart" | "split";
  itemId: string;
  tabId?: string;
  paneId?: string;
  epoch: string;
  revision: number | null;
  navigationKey: string;
  origin: Renderable;
  version: number;
  requestId: number;
  allowReactivate?: boolean;
  creation?: {
    sourceTabId: string | undefined;
    existingTabIds: readonly string[];
    selectionAdvanced?: boolean;
  };
};

/** New snapshot selections may transfer the origin, never supply the response's exact IDs. */
export function canProjectTabEntry(
  entry: Pick<PendingTerminalEntry, "itemId" | "tabId" | "revision" | "creation">,
  snapshot: Snapshot | null,
): boolean {
  const selected = snapshot?.surfaces.find(
    (surface) => surface.itemId === entry.itemId,
  )?.activeTabId;
  if (snapshot === null || selected == null) {
    return false;
  }
  if (entry.creation && (entry.revision === null || snapshot.revision < entry.revision)) {
    return !entry.creation.existingTabIds.includes(selected);
  }
  return selected === entry.tabId;
}

export function entryRevisionReady(
  entry: Pick<PendingTerminalEntry, "epoch" | "revision">,
  snapshot: Pick<Snapshot, "epoch" | "revision"> | null,
): boolean {
  return (
    snapshot !== null &&
    snapshot.epoch === entry.epoch &&
    entry.revision !== null &&
    snapshot.revision >= entry.revision
  );
}

/** Running candidates only; native size and presentation eligibility remain separate gates. */
export function entryPaneCandidates(
  entry: Pick<PendingTerminalEntry, "kind" | "paneId" | "creation">,
  runningIds: readonly string[],
  rememberedPaneId: string | undefined,
): string[] {
  if (entry.kind === "restart" || entry.kind === "split" || entry.creation !== undefined) {
    return runningIds.filter((id) => id === entry.paneId);
  }
  return rememberedPaneId !== undefined && runningIds.includes(rememberedPaneId)
    ? [rememberedPaneId, ...runningIds.filter((id) => id !== rememberedPaneId)]
    : [...runningIds];
}

import type { Command, Snapshot } from "@work-craft/server/client";

import type { ShellRegion } from "@/shell/state";
import { paneIds } from "@/workbench/layout";

export const OPERATIONAL_ERROR_DURATION = 8_000;

export function commandSourceKey(command: Command, region: ShellRegion): string {
  const id =
    "itemId" in command
      ? command.itemId
      : "paneId" in command
        ? command.paneId
        : "surfaceId" in command
          ? command.surfaceId
          : region;
  return `${id}:${command.type}`;
}

export function entrySourceKey(kind: "item" | "tab" | "pane", id: string): string {
  return `${kind}:${id}:entry`;
}

export function discoverySourceKey(itemId: string): string {
  return `directory:${itemId}:discovery`;
}

export function processSourceKey(paneId: string): string {
  return `pane:${paneId}:process`;
}

export function layoutSourceKey(paneId: string): string {
  return `pane:${paneId}:layout`;
}

/** Record-owned failures stop existing with their source; transient form errors keep their lifetime. */
export function retainedErrorSources(snapshot: Snapshot): ReadonlySet<string> {
  const keys = new Set<string>();
  const roots = new Set(
    snapshot.items
      .filter((item) => item.parentId === null && !item.archived)
      .map((item) => item.id),
  );
  for (const item of snapshot.items) {
    if (item.archived || (item.parentId !== null && !roots.has(item.parentId))) {
      continue;
    }
    keys.add(`${item.id}:surface.ensure`);
    keys.add(`${item.id}:item.setArchived`);
    keys.add(entrySourceKey("item", item.id));
    keys.add(discoverySourceKey(item.id));
  }
  for (const pane of snapshot.panes) {
    keys.add(`${pane.id}:process.restart`);
    keys.add(`${pane.id}:pane.split`);
    keys.add(processSourceKey(pane.id));
  }
  for (const surface of snapshot.surfaces) {
    keys.add(`${surface.id}:tab.create`);
    keys.add(`${surface.id}:surface.selectTab`);
  }
  for (const tab of snapshot.tabs) {
    const surface = snapshot.surfaces.find((surface) => surface.id === tab.surfaceId);
    if (surface && keys.has(entrySourceKey("item", surface.itemId))) {
      keys.add(entrySourceKey("tab", tab.id));
    }
    for (const paneId of paneIds(tab.layout)) {
      keys.add(layoutSourceKey(paneId));
      if (
        surface &&
        keys.has(entrySourceKey("item", surface.itemId)) &&
        snapshot.panes.some((pane) => pane.id === paneId)
      ) {
        keys.add(entrySourceKey("pane", paneId));
      }
    }
  }
  return keys;
}

export function retainsErrorSource(sourceKey: string, retained: ReadonlySet<string>): boolean {
  return (
    !/:(?:surface\.ensure|item\.setArchived|entry|discovery|pane\.split|process\.restart|tab\.create|surface\.selectTab|process|layout)$/.test(
      sourceKey,
    ) || retained.has(sourceKey)
  );
}

export function observeOperationalFailures(
  snapshot: Snapshot | null,
  connectionError: string | null,
  now: number,
  nextRequestId: () => number,
): OperationalError[] {
  const failures: OperationalError[] = [];
  function add(sourceKey: string, sourceLabel: string, operation: string, message: string): void {
    failures.push({
      sourceKey,
      sourceLabel,
      operation,
      message,
      epoch: snapshot?.epoch ?? "connecting",
      contextKey: "",
      requestId: nextRequestId(),
      expiresAt: now + OPERATIONAL_ERROR_DURATION,
      origin: "background",
    });
  }
  for (const item of snapshot?.items ?? []) {
    if (item.kind === "directory" && !item.archived && item.data.discoveryError) {
      add(discoverySourceKey(item.id), item.title, "Git discovery", item.data.discoveryError);
    }
  }
  for (const pane of snapshot?.panes ?? []) {
    if (pane.processStatus === "failed") {
      add(processSourceKey(pane.id), pane.title, "Process", pane.errorText ?? "Process failed");
    }
  }
  if (connectionError) {
    add("daemon:connection", "Daemon", "Connection", connectionError);
  }
  return failures.sort((a, b) => b.sourceKey.localeCompare(a.sourceKey));
}

export type OperationalError = {
  sourceKey: string;
  sourceLabel: string;
  operation: string;
  epoch: string;
  contextKey: string;
  requestId: number;
  message: string;
  expiresAt: number;
  origin: "direct" | "background";
};

export function reportOperationalError(
  current: OperationalError | null,
  next: OperationalError,
  now: number,
): OperationalError {
  return current !== null &&
    current.epoch === next.epoch &&
    current.expiresAt > now &&
    current.origin === "direct" &&
    next.origin === "background"
    ? current
    : next;
}

export function clearOperationalError(
  current: OperationalError | null,
  sourceKey: string,
  requestId: number,
): OperationalError | null {
  return current?.sourceKey === sourceKey && current.requestId === requestId ? null : current;
}

function safe(value: string): string {
  return value.replace(
    /[\x00-\x1f\x7f-\x9f]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

export function statusPresentation(input: {
  leaderActive: boolean;
  invalidMessage: string | null;
  invalidMessageUntil: number | null;
  operationalError: OperationalError | null;
  now: number;
}): { mode: "HINTS" | "LEADER" | "ERROR"; text?: string } {
  if (input.leaderActive) {
    return { mode: "LEADER" };
  }
  if (input.invalidMessage !== null && (input.invalidMessageUntil ?? 0) > input.now) {
    return { mode: "ERROR", text: input.invalidMessage };
  }
  const error = input.operationalError;
  return error !== null && error.expiresAt > input.now
    ? {
        mode: "ERROR",
        text: `${safe(error.sourceLabel)} — ${safe(error.operation)} failed: ${safe(error.message)}`,
      }
    : { mode: "HINTS" };
}

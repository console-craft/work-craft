import type { ClientAttachment, ControlSnapshot } from "@work-craft/server/client";

import type { ConnectionStatus } from "@/client/store";

export type ShellPresentation = { snapshot: ControlSnapshot; sessionId: string };

function coherent(snapshot: ControlSnapshot, sessionId: string): boolean {
  const navigation = snapshot.navigation.find((entry) => entry.sessionId === sessionId);
  if (!snapshot.sessions.some(({ id }) => id === sessionId) || !navigation) {
    return false;
  }
  if (navigation.itemId === null) {
    return true;
  }
  const item = snapshot.items.find(({ id }) => id === navigation.itemId);
  const parent = snapshot.items.find(({ id }) => id === item?.parentId);
  return (
    !!item &&
    !item.archived &&
    (item.parentId === null || (!!parent && !parent.archived)) &&
    (navigation.tabId === null || snapshot.tabs.some(({ id }) => id === navigation.tabId)) &&
    (navigation.paneId === null || snapshot.panes.some(({ id }) => id === navigation.paneId))
  );
}

/** Last coherent display only; callers must still authorize against live attachment/state. */
export function projectShellPresentation(
  previous: ShellPresentation | null,
  live: {
    snapshot: ControlSnapshot | null;
    attachment: ClientAttachment | null;
    status: ConnectionStatus;
    requestedSessionId: string | null;
  },
): ShellPresentation | null {
  if (live.attachment?.sessionId === null) {
    return null;
  }
  const sessionId =
    live.status === "connected" && live.attachment
      ? live.attachment.sessionId
      : previous?.sessionId;
  if (!sessionId || (!live.attachment && live.requestedSessionId !== sessionId)) {
    return null;
  }
  const snapshot = live.snapshot ?? previous?.snapshot;
  if (
    !snapshot ||
    !coherent(snapshot, sessionId) ||
    (previous && live.attachment === null && snapshot.epoch !== previous.snapshot.epoch)
  ) {
    return null;
  }
  return previous?.snapshot === snapshot && previous.sessionId === sessionId
    ? previous
    : { snapshot, sessionId };
}

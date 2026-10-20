import type { Snapshot } from "@work-craft/server/client";
import { useEffect, useRef, useState } from "react";

import {
  layoutSourceKey,
  observeOperationalFailures,
  OPERATIONAL_ERROR_DURATION,
  type OperationalError,
} from "@/shell/errors";
import type { ShellAction } from "@/shell/state";

export function useShellErrors({
  snapshot,
  connectionError,
  error,
  dispatch,
  nextRequestId,
}: {
  snapshot: Snapshot | null;
  connectionError: string | null;
  error: OperationalError | null;
  dispatch(action: ShellAction): void;
  nextRequestId(): number;
}): { now: number; reportMissingPane(paneId: string, message: string, contextKey: string): void } {
  const [clock, setClock] = useState(Date.now());
  const missingPanes = useRef(new Map<string, string>());
  useEffect(() => {
    if (!error) {
      return;
    }
    const timeout = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, error.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    const now = Date.now();
    dispatch({
      type: "sources.observe",
      epoch: snapshot?.epoch ?? "connecting",
      failures: observeOperationalFailures(snapshot, connectionError, now, nextRequestId),
      now,
    });
  }, [snapshot, connectionError]);

  function reportMissingPane(paneId: string, message: string, contextKey: string): void {
    if (missingPanes.current.get(paneId) === message) {
      return;
    }
    missingPanes.current.set(paneId, message);
    const now = Date.now();
    dispatch({
      type: "source.report",
      now,
      error: {
        sourceKey: layoutSourceKey(paneId),
        sourceLabel: "Pane",
        operation: "Layout",
        epoch: snapshot?.epoch ?? "",
        contextKey,
        requestId: nextRequestId(),
        message,
        expiresAt: now + OPERATIONAL_ERROR_DURATION,
        origin: "background",
      },
    });
  }
  return { now: Math.max(clock, Date.now()), reportMissingPane };
}

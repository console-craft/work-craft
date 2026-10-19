import type { Snapshot } from "@work-craft/server/client";

import type { AlertStatus } from "@/ui/components/alert.tsx";

/** Persistent state notice, not a second operational-error channel. */
export function paneNotice(
  processStatus: Snapshot["panes"][number]["processStatus"],
  connected: boolean,
): { status: AlertStatus; title: string; reactivate: boolean } | null {
  const reactivate = processStatus === "exited";
  if (!connected) {
    return { status: "warning", title: "Disconnected", reactivate };
  }
  switch (processStatus) {
    case "running":
      return null;
    case "starting":
      return { status: "info", title: "Starting terminal", reactivate };
    case "exited":
      return { status: "warning", title: "Terminal exited", reactivate };
    case "failed":
      return { status: "error", title: "Terminal failed", reactivate };
    case "interrupted":
      return { status: "warning", title: "Terminal interrupted", reactivate };
  }
}

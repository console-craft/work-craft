import type {
  CommandResponse,
  SessionNavigation,
  WorkCraftClient,
} from "@work-craft/server/client";

import type { CliArgs } from "./args.ts";

type Snapshot = Awaited<ReturnType<WorkCraftClient["snapshot"]>>;
type Health = Awaited<ReturnType<WorkCraftClient["health"]>>;
type Counts = Omit<
  { [Key in keyof Snapshot]: Snapshot[Key] extends unknown[] ? number : never },
  "epoch" | "revision" | "sessionWorkspaces" | "terminalHistories" | "navigation" | "geometry"
>;
export type Status = Omit<Health, "protocol"> & { running: true; counts: Counts };

export function snapshotCounts(snapshot: Snapshot): Counts {
  return {
    sessions: snapshot.sessions.length,
    workspaces: snapshot.workspaces.length,
    categories: snapshot.categories.length,
    items: snapshot.items.length,
    surfaces: snapshot.surfaces.length,
    tabs: snapshot.tabs.length,
    panes: snapshot.panes.length,
  };
}

export async function readStatus(
  client: Pick<WorkCraftClient, "health" | "snapshot">,
): Promise<Status> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await client.snapshot();
    const health = await client.health();
    if (snapshot.epoch === health.epoch && snapshot.revision === health.revision) {
      return {
        running: true,
        pid: health.pid,
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        counts: snapshotCounts(snapshot),
      };
    }
  }
  throw new Error("could not read coherent daemon status");
}

function navigationLines(navigation: SessionNavigation): string[] {
  return [
    `Session: ${navigation.sessionId}`,
    `Workspace: ${navigation.workspaceId ?? "-"}`,
    `Category: ${navigation.category ?? "-"}`,
    `Item: ${navigation.itemId ?? "-"}`,
    `Tab: ${navigation.tabId ?? "-"}`,
    `Pane: ${navigation.paneId ?? "-"}`,
  ];
}

export function formatSnapshot(snapshot: Snapshot): string {
  const lines: string[] = [];
  for (const session of snapshot.sessions) {
    lines.push(session.name);
    const navigation = snapshot.navigation.find(({ sessionId }) => sessionId === session.id);
    if (navigation) {
      lines.push(...navigationLines(navigation).map((line) => `  ${line}`));
    }
    for (const membership of snapshot.sessionWorkspaces
      .filter(({ sessionId }) => sessionId === session.id)
      .sort((a, b) => a.position - b.position || a.workspaceId.localeCompare(b.workspaceId))) {
      const workspace = snapshot.workspaces.find(({ id }) => id === membership.workspaceId);
      if (workspace === undefined) {
        continue;
      }
      lines.push(`  ${workspace.name}`);
      for (const category of snapshot.categories.filter(
        ({ workspaceId }) => workspaceId === workspace.id,
      )) {
        lines.push(`    ${category.title}`);
        for (const root of snapshot.items
          .filter(
            ({ workspaceId, category: kind }) =>
              workspaceId === workspace.id && kind === category.kind,
          )
          .filter((item) => item.parentId === null)) {
          const label = (item: Snapshot["items"][number]) =>
            `${JSON.stringify(item.title)} [${item.id}]${item.archived ? " [archived]" : ""}${item.kind !== "generic" && item.data.availability === "unavailable" ? " [unavailable]" : ""}`;
          lines.push(`      ${label(root)}`);
          for (const item of snapshot.items.filter(({ parentId }) => parentId === root.id)) {
            lines.push(`        ${label(item)}`);
          }
        }
      }
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

type Result = CommandResponse["result"];

export function formatResult(command: CliArgs["command"], result: Result): string {
  switch (command) {
    case "session.navigate":
    case "session.step":
    case "session.openItem":
      if (!result.navigation) {
        throw new Error(`Missing navigation result for ${command}`);
      }
      return `${navigationLines(result.navigation).join("\n")}\n`;
    case "session.create":
    case "workspace.create":
    case "item.create":
    case "item.setArchived":
      return `ID: ${result.id}\n`;
    case "directory.register":
      return `ID: ${result.id}\nRoot: ${result.rootItemId}\n`;
    case "session.update":
      return `Updated session: ${result.id}\n`;
    case "session.delete":
      return `Deleted session: ${result.id}\n`;
    case "session.workspace.add":
      return `Session: ${result.sessionId}\nAdded workspace: ${result.workspaceId}\n`;
    case "session.workspace.remove":
      return `Session: ${result.sessionId}\nRemoved workspace: ${result.workspaceId}\n`;
    case "surface.ensure":
      return `Item: ${result.itemId}\nSurface: ${result.surfaceId}\n`;
    case "tab.create":
      return `Tab: ${result.tabId}\nPane: ${result.paneId}\n`;
    case "pane.split":
    case "process.restart":
      return `Pane: ${result.paneId}\n`;
    case "daemon.stop":
      return "Stopped Work Craft\n";
    case "daemon.destroy":
      return "Destroyed Work Craft\n";
    case "snapshot":
    case "daemon.status":
      throw new Error(`No mutation result formatter for ${command}`);
  }
}

export function formatStatus(status: Status): string {
  return (
    `Running: true\n` +
    `PID: ${status.pid}\n` +
    `Epoch: ${status.epoch}\n` +
    `Revision: ${status.revision}\n` +
    `Sessions: ${status.counts.sessions}\n` +
    `Workspaces: ${status.counts.workspaces}\n` +
    `Categories: ${status.counts.categories}\n` +
    `Items: ${status.counts.items}\n` +
    `Surfaces: ${status.counts.surfaces}\n` +
    `Tabs: ${status.counts.tabs}\n` +
    `Panes: ${status.counts.panes}\n`
  );
}

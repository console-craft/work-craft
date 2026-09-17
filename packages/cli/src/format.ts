import type { CommandResponse, WorkCraftClient } from "@work-craft/server/client";
import type { CliArgs } from "./args.ts";

type Snapshot = Awaited<ReturnType<WorkCraftClient["snapshot"]>>;
type Health = Awaited<ReturnType<WorkCraftClient["health"]>>;
type Counts = Omit<
  { [Key in keyof Snapshot]: Snapshot[Key] extends unknown[] ? number : never },
  "epoch" | "revision" | "terminalHistories"
>;
export type Status = Health & { running: true; counts: Counts };

export function snapshotCounts(snapshot: Snapshot): Counts {
  return {
    sessions: snapshot.sessions.length,
    workspaces: snapshot.workspaces.length,
    categories: snapshot.categories.length,
    projects: snapshot.projects.length,
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

export function formatSnapshot(snapshot: Snapshot): string {
  const lines: string[] = [];
  for (const session of snapshot.sessions) {
    lines.push(session.name);
    for (const workspace of snapshot.workspaces.filter(
      ({ sessionId }) => sessionId === session.id,
    )) {
      lines.push(`  ${workspace.name}`);
      for (const category of snapshot.categories.filter(
        ({ workspaceId }) => workspaceId === workspace.id,
      )) {
        lines.push(`    ${category.title}`);
        for (const project of snapshot.projects.filter(
          ({ workspaceId, category: kind }) =>
            workspaceId === workspace.id && kind === category.kind,
        )) {
          lines.push(`      ${project.name}`);
          for (const item of snapshot.items.filter(({ projectId }) => projectId === project.id)) {
            lines.push(`        ${item.title} [${item.id}]`);
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
    case "session.create":
    case "workspace.create":
    case "project.create":
    case "item.create":
      return `ID: ${result.id}\n`;
    case "surface.ensure":
      return `Item: ${result.itemId}\nSurface: ${result.surfaceId}\n`;
    case "surface.selectTab":
      return `Surface: ${result.surfaceId}\nTab: ${result.tabId}\n`;
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
    `Projects: ${status.counts.projects}\n` +
    `Items: ${status.counts.items}\n` +
    `Surfaces: ${status.counts.surfaces}\n` +
    `Tabs: ${status.counts.tabs}\n` +
    `Panes: ${status.counts.panes}\n`
  );
}

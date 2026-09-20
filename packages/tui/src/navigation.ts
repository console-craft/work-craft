import type { CategoryKind, Snapshot } from "@work-craft/server/client";

export type NavigatorEntry = {
  key: string;
  kind: "project" | "item";
  id: string;
  projectId: string;
  label: string;
  depth: 0 | 1;
};

export function workspacesForSession(
  snapshot: Snapshot,
  sessionId: string,
): Snapshot["workspaces"] {
  return snapshot.sessionWorkspaces
    .filter((membership) => membership.sessionId === sessionId)
    .sort((a, b) => a.position - b.position || a.workspaceId.localeCompare(b.workspaceId))
    .flatMap((membership) =>
      snapshot.workspaces.filter((workspace) => workspace.id === membership.workspaceId),
    );
}

export function categoriesForWorkspace(
  snapshot: Snapshot,
  workspaceId: string,
): Snapshot["categories"] {
  return snapshot.categories
    .filter((category) => category.workspaceId === workspaceId)
    .sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind));
}

export function navigatorEntries(
  snapshot: Snapshot,
  workspaceId: string,
  category: CategoryKind,
  expandedProjectIds: ReadonlySet<string>,
): NavigatorEntry[] {
  return snapshot.projects
    .filter((project) => project.workspaceId === workspaceId && project.category === category)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .flatMap((project) => {
      const projectEntry: NavigatorEntry = {
        key: `project:${project.id}`,
        kind: "project",
        id: project.id,
        projectId: project.id,
        label: project.name,
        depth: 0,
      };
      if (!expandedProjectIds.has(project.id)) {
        return [projectEntry];
      }
      const items = snapshot.items
        .filter((item) => item.projectId === project.id)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map<NavigatorEntry>((item) => ({
          key: `item:${item.id}`,
          kind: "item",
          id: item.id,
          projectId: project.id,
          label: item.title,
          depth: 1,
        }));
      return [projectEntry, ...items];
    });
}

export function projectIdForEntry(entry: NavigatorEntry | undefined): string | undefined {
  return entry?.projectId;
}

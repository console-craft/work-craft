import type { CategoryKind, Snapshot } from "@work-craft/server/client";

export type NavigatorEntry = {
  key: string;
  kind: "project" | "item";
  id: string;
  projectId: string;
  label: string;
  depth: 0 | 1;
};

export type NavigationNode = {
  key: string;
  kind: "session" | "workspace" | "category" | "project" | "item";
  id: string;
  label: string;
  children?: NavigationNode[];
};

export type NavigationEntry = {
  node: NavigationNode;
  depth: number;
  path: NavigationNode[];
};

function byPosition<T extends { id?: string; kind?: string; position: number }>(
  a: T,
  b: T,
): number {
  return a.position - b.position || (a.id ?? a.kind ?? "").localeCompare(b.id ?? b.kind ?? "");
}

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

export function buildNavigation(snapshot: Snapshot, sessionId: string): NavigationNode[] {
  return snapshot.sessionWorkspaces
    .filter((membership) => membership.sessionId === sessionId)
    .sort((a, b) => a.position - b.position || a.workspaceId.localeCompare(b.workspaceId))
    .flatMap((membership) => {
      const workspace = snapshot.workspaces.find(({ id }) => id === membership.workspaceId);
      if (workspace === undefined) {
        return [];
      }
      return [
        {
          key: `session:${sessionId}:workspace:${workspace.id}`,
          kind: "workspace",
          id: workspace.id,
          label: workspace.name,
          children: snapshot.categories
            .filter((category) => category.workspaceId === workspace.id)
            .sort(byPosition)
            .map((category) => ({
              key: `session:${sessionId}:category:${workspace.id}:${category.kind}`,
              kind: "category",
              id: category.kind,
              label: category.title,
              children: snapshot.projects
                .filter(
                  (project) =>
                    project.workspaceId === workspace.id && project.category === category.kind,
                )
                .sort(byPosition)
                .map((project) => ({
                  key: `session:${sessionId}:project:${project.id}`,
                  kind: "project",
                  id: project.id,
                  label: project.name,
                  children: snapshot.items
                    .filter((item) => item.projectId === project.id)
                    .sort(byPosition)
                    .map((item) => ({
                      key: `session:${sessionId}:item:${item.id}`,
                      kind: "item",
                      id: item.id,
                      label: item.title,
                    })),
                })),
            })),
        },
      ];
    });
}

export function flattenNavigation(
  nodes: NavigationNode[],
  depth = 0,
  ancestors: NavigationNode[] = [],
): NavigationEntry[] {
  return nodes.flatMap((node) => {
    const path = [...ancestors, node];
    return [{ node, depth, path }, ...flattenNavigation(node.children ?? [], depth + 1, path)];
  });
}

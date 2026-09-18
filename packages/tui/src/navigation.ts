import type { Snapshot } from "@work-craft/server/client";

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

export function buildNavigation(snapshot: Snapshot): NavigationNode[] {
  return [...snapshot.sessions].sort(byPosition).map((session) => ({
    key: `session:${session.id}`,
    kind: "session",
    id: session.id,
    label: session.name,
    children: snapshot.sessionWorkspaces
      .filter(({ sessionId }) => sessionId === session.id)
      .sort((a, b) => a.position - b.position || a.workspaceId.localeCompare(b.workspaceId))
      .flatMap((membership) => {
        const workspace = snapshot.workspaces.find(({ id }) => id === membership.workspaceId);
        if (workspace === undefined) {
          return [];
        }
        return [
          {
            key: `workspace:${workspace.id}`,
            kind: "workspace",
            id: workspace.id,
            label: workspace.name,
            children: snapshot.categories
              .filter((category) => category.workspaceId === workspace.id)
              .sort(byPosition)
              .map((category) => ({
                key: `category:${workspace.id}:${category.kind}`,
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
                    key: `project:${project.id}`,
                    kind: "project",
                    id: project.id,
                    label: project.name,
                    children: snapshot.items
                      .filter((item) => item.projectId === project.id)
                      .sort(byPosition)
                      .map((item) => ({
                        key: `item:${item.id}`,
                        kind: "item",
                        id: item.id,
                        label: item.title,
                      })),
                  })),
              })),
          },
        ];
      }),
  }));
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

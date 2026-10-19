import type { CategoryKind, Snapshot } from "@work-craft/server/client";

import { homeRelativePath } from "@/navigation/path-label.ts";

export type NavigatorEntry = {
  key: string;
  kind: "root" | "item";
  id: string;
  rootId: string;
  label: string;
  depth: 0 | 1;
  item: Snapshot["items"][number];
  matches: boolean;
  hasChildren: boolean;
  expanded: boolean;
  failed?: boolean;
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
  expandedRootIds: ReadonlySet<string>,
  query = "",
  homePath = "",
): NavigatorEntry[] {
  const needle = query.toLocaleLowerCase();
  function matches(item: Snapshot["items"][number]): boolean {
    return [
      item.title,
      ...(item.kind === "generic"
        ? []
        : [item.data.path, homeRelativePath(item.data.path, homePath), item.data.branch ?? ""]),
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  }
  return snapshot.items
    .filter(
      (root) =>
        root.parentId === null &&
        !root.archived &&
        root.workspaceId === workspaceId &&
        root.category === category,
    )
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .flatMap((root) => {
      const children = snapshot.items
        .filter((item) => item.parentId === root.id && !item.archived)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const matchingChildren = children.filter(matches);
      if (query !== "" && !matches(root) && matchingChildren.length === 0) {
        return [];
      }
      const rootEntry: NavigatorEntry = {
        key: `root:${root.id}`,
        kind: "root",
        id: root.id,
        rootId: root.id,
        label: root.title,
        depth: 0,
        item: root,
        matches: matches(root),
        hasChildren: children.length > 0,
        expanded: query !== "" ? matchingChildren.length > 0 : expandedRootIds.has(root.id),
      };
      if (query === "" && !expandedRootIds.has(root.id)) {
        return [rootEntry];
      }
      const items = (query === "" ? children : matchingChildren).map<NavigatorEntry>((item) => ({
        key: `item:${item.id}`,
        kind: "item",
        id: item.id,
        rootId: root.id,
        label: item.title,
        depth: 1,
        item,
        matches: matches(item),
        hasChildren: false,
        expanded: false,
      }));
      return [rootEntry, ...items];
    });
}

export function rootIdForEntry(entry: NavigatorEntry | undefined): string | undefined {
  return entry?.rootId;
}

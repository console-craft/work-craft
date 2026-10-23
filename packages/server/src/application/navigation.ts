import {
  type CategoryKind,
  type LayoutNode,
  type NavigationLevel,
  type NavigationTarget,
  ProtocolError,
  type SessionNavigation,
  type Snapshot,
  type WorkItem,
} from "../api/protocol.ts";

export type NavigationCatalog = Pick<
  Snapshot,
  "sessions" | "workspaces" | "sessionWorkspaces" | "categories" | "items" | "tabs"
> & {
  surfaces: Pick<Snapshot["surfaces"][number], "id" | "itemId">[];
  panes: Pick<Snapshot["panes"][number], "id" | "surfaceId">[];
};
export type NavigationMemory = {
  surfaceTabs: Record<string, string>;
  tabPanes: Record<string, string>;
};
export type NavigationState = { cursor: SessionNavigation; memory: NavigationMemory };

function ordered<T extends { position: number; id: string }>(values: T[]): T[] {
  return values.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function workspaceIds(catalog: NavigationCatalog, sessionId: string): string[] {
  return ordered(
    catalog.sessionWorkspaces
      .filter(
        (entry) =>
          entry.sessionId === sessionId &&
          catalog.workspaces.some(({ id }) => id === entry.workspaceId),
      )
      .map((entry) => ({ ...entry, id: entry.workspaceId })),
  ).map(({ id }) => id);
}

function items(
  catalog: NavigationCatalog,
  workspaceId: string | null,
  category: CategoryKind | null,
): WorkItem[] {
  const candidates = catalog.items.filter(
    (entry) => entry.workspaceId === workspaceId && entry.category === category && !entry.archived,
  );
  return ordered(candidates.filter(({ parentId }) => parentId === null)).flatMap((root) => [
    root,
    ...ordered(candidates.filter(({ parentId }) => parentId === root.id)),
  ]);
}

function tabs(catalog: NavigationCatalog, surfaceId: string | undefined) {
  return ordered(catalog.tabs.filter((tab) => tab.surfaceId === surfaceId));
}

function leafIds(layout: LayoutNode | null): string[] {
  if (layout === null) {
    return [];
  }
  return layout.type === "pane"
    ? [layout.paneId]
    : [...leafIds(layout.first), ...leafIds(layout.second)];
}

function panes(catalog: NavigationCatalog, tabId: string | null): string[] {
  const tab = catalog.tabs.find(({ id }) => id === tabId);
  return leafIds(tab?.layout ?? null).filter((id) =>
    catalog.panes.some((pane) => pane.id === id && pane.surfaceId === tab?.surfaceId),
  );
}

function neighbor(selected: string | null, before: string[], after: string[]): string | null {
  if (selected !== null && after.includes(selected)) {
    return selected;
  }
  const index = selected === null ? -1 : before.indexOf(selected);
  if (index < 0) {
    return after[0] ?? null;
  }
  return (
    before.slice(index + 1).find((id) => after.includes(id)) ??
    before
      .slice(0, index)
      .reverse()
      .find((id) => after.includes(id)) ??
    null
  );
}

function sameRecord(first: Record<string, string>, second: Record<string, string>): boolean {
  return (
    Object.keys(first).length === Object.keys(second).length &&
    Object.entries(first).every(([key, value]) => second[key] === value)
  );
}

function finish(
  state: NavigationState,
  cursor: SessionNavigation,
  memory = state.memory,
): NavigationState {
  const surfaceTabs = { ...memory.surfaceTabs };
  const tabPanes = { ...memory.tabPanes };
  const changed = (["workspaceId", "category", "itemId", "tabId", "paneId"] as const).some(
    (key) => state.cursor[key] !== cursor[key],
  );
  if (
    !changed &&
    sameRecord(state.memory.surfaceTabs, surfaceTabs) &&
    sameRecord(state.memory.tabPanes, tabPanes)
  ) {
    return state;
  }
  return {
    cursor: { ...cursor, generation: state.cursor.generation + Number(changed) },
    memory: { surfaceTabs, tabPanes },
  };
}

function project(
  catalog: NavigationCatalog,
  state: NavigationState,
  workspaceId: string | null,
  category: CategoryKind | null,
  itemId: string | null,
  tabId?: string | null,
  paneId?: string | null,
): NavigationState {
  const surface = catalog.surfaces.find((entry) => entry.itemId === itemId);
  const surfaceTabs = tabs(catalog, surface?.id);
  const rememberedTab = tabId ?? (surface && state.memory.surfaceTabs[surface.id]);
  const activeTab = surfaceTabs.find(({ id }) => id === rememberedTab) ?? surfaceTabs[0];
  const paneIds = panes(catalog, activeTab?.id ?? null);
  const rememberedPane = paneId ?? (activeTab && state.memory.tabPanes[activeTab.id]);
  const selectedPane = paneIds.find((id) => id === rememberedPane) ?? paneIds[0] ?? null;
  const memory = {
    surfaceTabs: {
      ...state.memory.surfaceTabs,
      ...(surface && activeTab ? { [surface.id]: activeTab.id } : {}),
    },
    tabPanes: {
      ...state.memory.tabPanes,
      ...(activeTab && selectedPane ? { [activeTab.id]: selectedPane } : {}),
    },
  };
  return finish(
    state,
    {
      ...state.cursor,
      workspaceId,
      category,
      itemId,
      tabId: activeTab?.id ?? null,
      paneId: selectedPane,
    },
    memory,
  );
}

/** Seed deterministically without creating resources or treating process status as selection. */
export function initialNavigation(
  catalog: NavigationCatalog,
  sessionId: string,
  memory: NavigationMemory = { surfaceTabs: {}, tabPanes: {} },
): NavigationState {
  if (!catalog.sessions.some(({ id }) => id === sessionId)) {
    throw new ProtocolError("session not found");
  }
  const state: NavigationState = {
    cursor: {
      sessionId,
      generation: 0,
      workspaceId: null,
      category: null,
      itemId: null,
      tabId: null,
      paneId: null,
    },
    memory,
  };
  const workspaceId = workspaceIds(catalog, sessionId)[0] ?? null;
  const category = workspaceId === null ? null : "inbox";
  const selected = project(
    catalog,
    state,
    workspaceId,
    category,
    items(catalog, workspaceId, category)[0]?.id ?? null,
  );
  return { ...selected, cursor: { ...selected.cursor, generation: 0 } };
}

/** Resolve the full ancestry in the session; never repair an invalid explicit command. */
export function selectNavigation(
  catalog: NavigationCatalog,
  state: NavigationState,
  target: NavigationTarget,
): NavigationState {
  const workspaces = workspaceIds(catalog, state.cursor.sessionId);
  if (!catalog.sessions.some(({ id }) => id === state.cursor.sessionId)) {
    throw new ProtocolError("session not found");
  }
  if (target.kind === "workspace" || target.kind === "category") {
    const workspaceId = target.kind === "workspace" ? target.workspaceId : state.cursor.workspaceId;
    if (workspaceId === null || !workspaces.includes(workspaceId)) {
      throw new ProtocolError("workspace not in session");
    }
    const category =
      target.kind === "category" ? target.category : (state.cursor.category ?? "inbox");
    if (
      !catalog.categories.some(
        (entry) => entry.workspaceId === workspaceId && entry.kind === category,
      )
    ) {
      throw new ProtocolError("category not found for workspace");
    }
    if (workspaceId === state.cursor.workspaceId && category === state.cursor.category) {
      return state;
    }
    return project(
      catalog,
      state,
      workspaceId,
      category,
      items(catalog, workspaceId, category)[0]?.id ?? null,
    );
  }
  const paneTabs =
    target.kind === "pane"
      ? catalog.tabs.filter((entry) => panes(catalog, entry.id).includes(target.paneId))
      : [];
  if (
    target.kind === "pane" &&
    (paneTabs.length !== 1 ||
      panes(catalog, paneTabs[0]!.id).filter((id) => id === target.paneId).length !== 1)
  ) {
    throw new ProtocolError("pane must belong to exactly one tab and layout leaf");
  }
  const tab =
    target.kind === "tab" ? catalog.tabs.find(({ id }) => id === target.tabId) : paneTabs[0];
  if (target.kind !== "item" && tab === undefined) {
    throw new ProtocolError(`${target.kind} not found`);
  }
  const surface = catalog.surfaces.find(({ id }) => id === tab?.surfaceId);
  const itemId = target.kind === "item" ? target.itemId : surface?.itemId;
  const item = catalog.items.find(({ id }) => id === itemId);
  if (
    !item ||
    !workspaces.includes(item.workspaceId) ||
    !items(catalog, item.workspaceId, item.category).some(({ id }) => id === item.id)
  ) {
    throw new ProtocolError("item not eligible in session (missing or archived)");
  }
  return project(
    catalog,
    state,
    item.workspaceId,
    item.category,
    item.id,
    tab?.id,
    target.kind === "pane" ? target.paneId : undefined,
  );
}

/** Resolve every relative step from current daemon state, independent of local browsing. */
export function stepNavigation(
  catalog: NavigationCatalog,
  state: NavigationState,
  level: NavigationLevel,
  direction: -1 | 1,
): NavigationState {
  const { workspaceId, category, itemId, tabId } = state.cursor;
  const surface = catalog.surfaces.find((entry) => entry.itemId === itemId);
  const values =
    level === "category"
      ? catalog.categories
          .filter((entry) => entry.workspaceId === workspaceId)
          .toSorted((a, b) => a.position - b.position || a.kind.localeCompare(b.kind))
          .map(({ kind }) => kind)
      : level === "item"
        ? items(catalog, workspaceId, category).map(({ id }) => id)
        : tabs(catalog, surface?.id).map(({ id }) => id);
  const current = level === "category" ? category : level === "item" ? itemId : tabId;
  const index = values.indexOf(current ?? "");
  const next = values[index + direction];
  if (index < 0 || next === undefined) {
    return state;
  }
  const target: NavigationTarget =
    level === "category"
      ? { kind: "category", category: next as CategoryKind }
      : level === "item"
        ? { kind: "item", itemId: next }
        : { kind: "tab", tabId: next };
  return selectNavigation(catalog, state, target);
}

function repairMemory(
  before: NavigationCatalog,
  after: NavigationCatalog,
  state: NavigationState,
): NavigationMemory {
  const workspaceSet = new Set(workspaceIds(after, state.cursor.sessionId));
  const surfaces = after.surfaces.filter((surface) =>
    after.items.some((item) => item.id === surface.itemId && workspaceSet.has(item.workspaceId)),
  );
  const surfaceTabs: Record<string, string> = {};
  const tabPanes: Record<string, string> = {};
  for (const surface of surfaces) {
    const previous = state.memory.surfaceTabs[surface.id];
    if (previous !== undefined) {
      const selected = neighbor(
        previous,
        tabs(before, surface.id).map(({ id }) => id),
        tabs(after, surface.id).map(({ id }) => id),
      );
      if (selected !== null) {
        surfaceTabs[surface.id] = selected;
      }
    }
    for (const tab of tabs(after, surface.id)) {
      const previousPane = state.memory.tabPanes[tab.id];
      if (previousPane !== undefined) {
        const selected = neighbor(previousPane, panes(before, tab.id), panes(after, tab.id));
        if (selected !== null) {
          tabPanes[tab.id] = selected;
        }
      }
    }
  }
  return { surfaceTabs, tabPanes };
}

/** Normalize all descendants/memories in the same transaction as catalog invalidation. */
export function normalizeNavigation(
  before: NavigationCatalog,
  after: NavigationCatalog,
  state: NavigationState,
): NavigationState {
  const workspaceId = neighbor(
    state.cursor.workspaceId,
    workspaceIds(before, state.cursor.sessionId),
    workspaceIds(after, state.cursor.sessionId),
  );
  const category = workspaceId === null ? null : (state.cursor.category ?? "inbox");
  const sameContext =
    workspaceId === state.cursor.workspaceId && category === state.cursor.category;
  const itemId = neighbor(
    sameContext ? state.cursor.itemId : null,
    items(before, state.cursor.workspaceId, state.cursor.category).map(({ id }) => id),
    items(after, workspaceId, category).map(({ id }) => id),
  );
  const memory = repairMemory(before, after, state);
  const projected = project(after, { ...state, memory }, workspaceId, category, itemId);
  return finish(state, projected.cursor, projected.memory);
}

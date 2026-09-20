export const CATEGORY_RAIL_WIDTH = 5;
export const DEFAULT_NAVIGATOR_WIDTH = 32;
export const COMPACT_NAVIGATOR_WIDTH = 7;
export const PREFERRED_WORKBENCH_WIDTH = 40;
export const MIN_WORKBENCH_WIDTH = 20;
export const MIN_WORKBENCH_HEIGHT = 5;
export const MIN_EXPANDED_NAVIGATOR_WIDTH = 16;

export type NavigatorMode = "expanded" | "compact" | "hidden";
export type NavigatorPreference = "auto" | "expanded" | "hidden";

export function resolveNavigatorMode(input: {
  terminalWidth: number;
  expandedWidth: number;
  preference: NavigatorPreference;
}): NavigatorMode {
  if (input.preference !== "auto") {
    return input.preference;
  }
  return input.terminalWidth - CATEGORY_RAIL_WIDTH - input.expandedWidth >=
    PREFERRED_WORKBENCH_WIDTH
    ? "expanded"
    : "compact";
}

export function resizeNavigatorWidth(
  width: number,
  direction: -1 | 1,
  terminalWidth: number,
): number {
  const maximum = Math.max(MIN_EXPANDED_NAVIGATOR_WIDTH, terminalWidth - CATEGORY_RAIL_WIDTH - 1);
  return Math.min(maximum, Math.max(MIN_EXPANDED_NAVIGATOR_WIDTH, width + direction));
}

export function visibleNavigatorWindow(
  rowCount: number,
  start: number,
  cursorIndex: number,
  height: number,
): { start: number; end: number } {
  const windowSize = Math.max(0, Math.min(rowCount, height));
  const maximumStart = Math.max(0, rowCount - windowSize);
  let nextStart = Math.min(maximumStart, Math.max(0, start));
  if (cursorIndex < nextStart) {
    nextStart = Math.max(0, cursorIndex);
  } else if (cursorIndex >= nextStart + windowSize) {
    nextStart = Math.min(maximumStart, cursorIndex - windowSize + 1);
  }
  return { start: nextStart, end: nextStart + windowSize };
}

export type WorkspaceViewport = {
  ids: string[];
  hasPrevious: boolean;
  hasNext: boolean;
};

export function workspaceViewport(
  workspaces: readonly { id: string; label: string }[],
  activeId: string | null,
  cursorId: string | null,
  availableWidth: number,
): WorkspaceViewport {
  if (workspaces.length === 0) {
    return { ids: [], hasPrevious: false, hasNext: false };
  }

  const cursorIndex = Math.max(
    0,
    workspaces.findIndex(({ id }) => id === cursorId),
  );
  const activeIndex = workspaces.findIndex(({ id }) => id === activeId);
  let best = { start: cursorIndex, end: cursorIndex };

  for (let start = 0; start <= cursorIndex; start += 1) {
    for (let end = cursorIndex; end < workspaces.length; end += 1) {
      const width =
        workspaces
          .slice(start, end + 1)
          .reduce((total, workspace) => total + Bun.stringWidth(workspace.label) + 3, 0) +
        (start > 0 ? 1 : 0) +
        (end < workspaces.length - 1 ? 1 : 0);
      if (width > availableWidth) {
        continue;
      }

      const includesActive = activeIndex < 0 || (activeIndex >= start && activeIndex <= end);
      const bestIncludesActive =
        activeIndex < 0 || (activeIndex >= best.start && activeIndex <= best.end);
      const count = end - start;
      const bestCount = best.end - best.start;
      const centerDistance = Math.abs((start + end) / 2 - cursorIndex);
      const bestCenterDistance = Math.abs((best.start + best.end) / 2 - cursorIndex);
      if (
        (includesActive && !bestIncludesActive) ||
        (includesActive === bestIncludesActive && count > bestCount) ||
        (includesActive === bestIncludesActive &&
          count === bestCount &&
          centerDistance < bestCenterDistance)
      ) {
        best = { start, end };
      }
    }
  }

  return {
    ids: workspaces.slice(best.start, best.end + 1).map(({ id }) => id),
    hasPrevious: best.start > 0,
    hasNext: best.end < workspaces.length - 1,
  };
}

export function projectInitials(label: string): string {
  const words = label.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toUpperCase();
  }
  return Array.from(words[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ellipsize(label: string, width: number): string {
  if (Bun.stringWidth(label) <= width) {
    return label;
  }
  if (width <= 0) {
    return "";
  }
  if (width === 1) {
    return "…";
  }
  return Bun.sliceAnsi(label, 0, width - 1, { ellipsis: "…" });
}

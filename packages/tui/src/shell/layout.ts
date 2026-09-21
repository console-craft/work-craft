import type { LayoutNode } from "@work-craft/server/client";

import { type FocusNode, projectPaneFocusNodes } from "@/input/focus.ts";

export const CATEGORY_RAIL_WIDTH = 5;
export const DEFAULT_NAVIGATOR_WIDTH = 32;
export const COMPACT_NAVIGATOR_WIDTH = 7;
export const MIN_EXPANDED_SHELL_WIDTH = 120;
export const MIN_WORKBENCH_WIDTH = 60;
export const MIN_WORKBENCH_HEIGHT = 5;
export const MIN_EXPANDED_NAVIGATOR_WIDTH = 16;

export type NavigatorMode = "expanded" | "compact" | "hidden";
export type NavigatorPreference = "auto" | "expanded" | "hidden";

export type ShellLayoutInput = {
  terminalWidth: number;
  terminalHeight: number;
  navigatorPreference: NavigatorPreference;
  preferredNavigatorWidth: number;
  activeSessionName: string | null;
  workspaces: readonly { id: string; label: string }[];
  activeWorkspaceId: string | null;
  workspaceCursorId: string | null;
  paneLayout: LayoutNode | null;
};

export type ShellLayout = {
  sessionWidth: number;
  workspaceWidth: number;
  workspaceViewport: WorkspaceViewport;
  navigatorMode: NavigatorMode;
  navigatorVisible: boolean;
  navigatorWidth: number;
  workbenchWidth: number;
  workbenchHeight: number;
  undersized: boolean;
  focusNodes: readonly FocusNode[];
};

export function resolveNavigatorMode(input: {
  terminalWidth: number;
  preference: NavigatorPreference;
}): NavigatorMode {
  if (input.preference !== "auto") {
    return input.preference;
  }
  return input.terminalWidth >= MIN_EXPANDED_SHELL_WIDTH ? "expanded" : "compact";
}

export function calculateShellLayout(input: ShellLayoutInput): ShellLayout {
  const sessionWidth = Math.min(
    Math.max(18, Bun.stringWidth(input.activeSessionName ?? "choose") + 14),
    Math.max(18, input.terminalWidth - 1),
  );
  const workspaceWidth = Math.max(0, input.terminalWidth - sessionWidth);
  const navigatorMode = resolveNavigatorMode({
    terminalWidth: input.terminalWidth,
    preference: input.navigatorPreference,
  });
  const workbenchHeight = Math.max(0, input.terminalHeight - 3);
  const navigatorVisible = navigatorMode !== "hidden" && workbenchHeight >= 2;
  const navigatorWidth = !navigatorVisible
    ? 0
    : navigatorMode === "expanded"
      ? input.preferredNavigatorWidth
      : COMPACT_NAVIGATOR_WIDTH;
  const workbenchWidth = input.terminalWidth - CATEGORY_RAIL_WIDTH - navigatorWidth;
  const undersized =
    workbenchWidth - 2 < MIN_WORKBENCH_WIDTH || workbenchHeight - 2 < MIN_WORKBENCH_HEIGHT;
  const workbenchX = CATEGORY_RAIL_WIDTH + navigatorWidth;
  const focusNodes: FocusNode[] = [
    {
      target: { region: "workspace" },
      rect: { x: 0, y: 0, width: Math.max(1, workspaceWidth), height: 1 },
    },
    {
      target: { region: "session" },
      rect: {
        x: Math.max(0, input.terminalWidth - sessionWidth),
        y: 0,
        width: sessionWidth,
        height: 1,
      },
    },
    {
      target: { region: "category" },
      rect: {
        x: 0,
        y: 1,
        width: CATEGORY_RAIL_WIDTH,
        height: Math.max(0, input.terminalHeight - 2),
      },
    },
    {
      target: { region: "tabs" },
      rect: { x: workbenchX, y: 1, width: Math.max(0, workbenchWidth), height: 1 },
    },
  ];
  if (navigatorVisible) {
    focusNodes.push({
      target: { region: "navigator" },
      rect: { x: CATEGORY_RAIL_WIDTH, y: 1, width: navigatorWidth, height: workbenchHeight },
    });
  }
  if (input.paneLayout !== null && !undersized) {
    focusNodes.push(
      ...projectPaneFocusNodes(input.paneLayout, {
        x: workbenchX,
        y: 2,
        width: Math.max(0, workbenchWidth),
        height: workbenchHeight,
      }),
    );
  }

  return {
    sessionWidth,
    workspaceWidth,
    workspaceViewport: workspaceViewport(
      input.workspaces,
      input.activeWorkspaceId,
      input.workspaceCursorId,
      workspaceWidth,
    ),
    navigatorMode,
    navigatorVisible,
    navigatorWidth,
    workbenchWidth,
    workbenchHeight,
    undersized,
    focusNodes,
  };
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

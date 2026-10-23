import {
  type LayoutNode,
  type PaneRect,
  projectPaneLayout,
  type Snapshot,
} from "@work-craft/server/client";

import type { FocusNode, Rect } from "@/input/focus.ts";
import {
  hasRecoveryViewport,
  reactivateRect,
  TAB_STRIP_HEIGHT,
  terminalRect,
  WORKBENCH_PADDING_X,
} from "@/workbench/layout.ts";
import { paneNotice } from "@/workbench/pane-state.ts";

export const CATEGORY_RAIL_WIDTH = 5;
export const SHELL_HEADER_HEIGHT = 3;
export const SHELL_STATUS_HEIGHT = 1;
export const DEFAULT_NAVIGATOR_WIDTH = 45;
export const MIN_EXPANDED_SHELL_WIDTH = 120;
export const MIN_WORKBENCH_WIDTH = 60;
export const MIN_WORKBENCH_HEIGHT = 6;
export const MIN_EXPANDED_NAVIGATOR_WIDTH = 16;
export type NavigatorMode = "docked" | "drawer" | "hidden";

export type ShellLayoutInput = {
  terminalWidth: number;
  terminalHeight: number;
  navigatorOpen: boolean;
  preferredNavigatorWidth: number;
  paneLayout: LayoutNode | null;
  panes?: Snapshot["panes"];
  connected?: boolean;
};
export type ShellLayout = {
  resizeBlocked: boolean;
  body: Rect;
  drawer: Rect;
  navigatorMode: NavigatorMode;
  navigatorVisible: boolean;
  navigatorWidth: number;
  workbenchWidth: number;
  workbenchHeight: number;
  workbenchContent: PaneRect;
  undersized: boolean;
  /** Includes undersized pane origins; commands filter eligible destinations. */
  focusNodes: readonly FocusNode[];
};

export function calculateShellLayout(input: ShellLayoutInput): ShellLayout {
  const width = Math.max(0, input.terminalWidth);
  const height = Math.max(0, input.terminalHeight);
  const rail = Math.min(width, CATEGORY_RAIL_WIDTH);
  const headerHeight = Math.min(SHELL_HEADER_HEIGHT, Math.max(0, height - SHELL_STATUS_HEIGHT));
  const body = {
    x: rail,
    y: headerHeight,
    width: width - rail,
    height: Math.max(0, height - headerHeight - SHELL_STATUS_HEIGHT),
  };
  const resizeBlocked = width < 80;
  const navigatorMode: NavigatorMode =
    !input.navigatorOpen || resizeBlocked || body.height < 3
      ? "hidden"
      : width >= 120
        ? "docked"
        : "drawer";
  const navigatorWidth =
    navigatorMode === "hidden"
      ? 0
      : navigatorMode === "drawer"
        ? body.width
        : Math.max(0, Math.min(body.width, Math.max(16, input.preferredNavigatorWidth)));
  const workbenchWidth = Math.max(
    0,
    body.width - (navigatorMode === "docked" ? navigatorWidth : 0),
  );
  const workbenchHeight = Math.max(0, body.height - TAB_STRIP_HEIGHT);
  const undersized =
    workbenchWidth - WORKBENCH_PADDING_X * 2 < MIN_WORKBENCH_WIDTH ||
    workbenchHeight < MIN_WORKBENCH_HEIGHT;
  const workbenchX = rail + (navigatorMode === "docked" ? navigatorWidth : 0);
  const workbenchContent: PaneRect = {
    x: workbenchX + Math.min(WORKBENCH_PADDING_X, workbenchWidth),
    y: body.y + Math.min(TAB_STRIP_HEIGHT, body.height),
    width: Math.max(0, workbenchWidth - WORKBENCH_PADDING_X * 2),
    height: workbenchHeight,
  };
  const focusNodes: FocusNode[] = [];
  if (!resizeBlocked) {
    focusNodes.push({
      target: { region: "category" },
      rect: { x: 0, y: body.y, width: rail, height: body.height },
    });
    if (navigatorMode !== "hidden") {
      focusNodes.push({
        target: { region: "navigator" },
        rect: { ...body, width: navigatorWidth },
      });
    }
    if (navigatorMode !== "drawer") {
      focusNodes.push({
        target: { region: "tabs" },
        rect: {
          x: workbenchX,
          y: body.y,
          width: workbenchWidth,
          height: Math.min(TAB_STRIP_HEIGHT, body.height),
        },
      });
      if (input.paneLayout && !undersized) {
        focusNodes.push(
          ...projectPaneLayout(input.paneLayout, workbenchContent).panes.flatMap(
            ({ paneId, rect }): FocusNode[] => {
              const pane = input.panes?.find((pane) => pane.id === paneId);
              const notice = pane ? paneNotice(pane.processStatus, input.connected ?? true) : null;
              const nodes: FocusNode[] = [
                {
                  target: { region: "workbench", paneId },
                  rect: terminalRect(rect, notice !== null),
                },
              ];
              if (notice?.reactivate && (input.connected ?? true) && hasRecoveryViewport(rect)) {
                nodes.push({
                  target: { region: "workbench", paneId, control: "reactivate" },
                  rect: reactivateRect(rect),
                });
              }
              return nodes;
            },
          ),
        );
      }
    }
  }
  return {
    resizeBlocked,
    body,
    drawer: body,
    navigatorMode,
    navigatorVisible: navigatorMode !== "hidden",
    navigatorWidth,
    workbenchWidth,
    workbenchHeight,
    workbenchContent,
    undersized,
    focusNodes,
  };
}

export function resizeNavigatorWidth(
  width: number,
  direction: -1 | 1,
  terminalWidth: number,
): number {
  return Math.min(
    Math.max(16, terminalWidth - CATEGORY_RAIL_WIDTH - 1),
    Math.max(16, width + direction),
  );
}

import type { LayoutNode } from "@work-craft/server/client";

export const TAB_STRIP_HEIGHT = 2;
export const PANE_ALERT_HEIGHT = 3;
export const PANE_TOP_BORDER_HEIGHT = 1;
export const PANE_RECOVERY_HEIGHT = PANE_TOP_BORDER_HEIGHT + PANE_ALERT_HEIGHT;
export const WORKBENCH_PADDING_X = 1;

export type PaneRect = { x: number; y: number; width: number; height: number };

/** The top border and unavailable footer are normal flow, never terminal output. */
export function terminalRect(bounds: PaneRect, showAlert: boolean): PaneRect {
  const border = Math.min(PANE_TOP_BORDER_HEIGHT, bounds.height);
  return {
    ...bounds,
    y: bounds.y + border,
    height: Math.max(0, bounds.height - border - (showAlert ? PANE_ALERT_HEIGHT : 0)),
  };
}
export type PaneGeometry = {
  panes: { paneId: string; rect: PaneRect }[];
  dividers: { id: string; orientation: "horizontal" | "vertical"; rect: PaneRect }[];
};

/** Project local or screen bounds with one divider cell and depth-first pane order. */
export function projectPaneLayout(layout: LayoutNode | null, bounds: PaneRect): PaneGeometry {
  const geometry: PaneGeometry = { panes: [], dividers: [] };
  function visit(node: LayoutNode, rect: PaneRect, id: string): void {
    if (node.type === "pane") {
      geometry.panes.push({ paneId: node.paneId, rect });
      return;
    }
    const vertical = node.direction === "vertical";
    const size = vertical ? rect.width : rect.height;
    const divider = Math.min(1, size);
    const available = size - divider;
    const first = Math.max(0, Math.min(available, Math.round(available * node.ratio)));
    geometry.dividers.push({
      id,
      orientation: node.direction,
      rect: vertical
        ? { ...rect, x: rect.x + first, width: divider }
        : { ...rect, y: rect.y + first, height: divider },
    });
    visit(
      node.first,
      vertical ? { ...rect, width: first } : { ...rect, height: first },
      `${id}.first`,
    );
    visit(
      node.second,
      vertical
        ? { ...rect, x: rect.x + first + divider, width: available - first }
        : { ...rect, y: rect.y + first + divider, height: available - first },
      `${id}.second`,
    );
  }
  if (layout !== null) {
    visit(
      layout,
      {
        x: Math.max(0, bounds.x),
        y: Math.max(0, bounds.y),
        width: Math.max(0, bounds.width),
        height: Math.max(0, bounds.height),
      },
      "split",
    );
  }
  return geometry;
}

export function paneIds(layout: LayoutNode | null): string[] {
  if (layout === null) {
    return [];
  }
  return layout.type === "pane"
    ? [layout.paneId]
    : [...paneIds(layout.first), ...paneIds(layout.second)];
}

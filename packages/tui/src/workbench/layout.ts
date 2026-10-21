import type { LayoutNode, PaneRect } from "@work-craft/server/client";

export const TAB_STRIP_HEIGHT = 2;
export const PANE_ALERT_HEIGHT = 3;
export const PANE_TOP_BORDER_HEIGHT = 1;
export const PANE_RECOVERY_HEIGHT = PANE_TOP_BORDER_HEIGHT + PANE_ALERT_HEIGHT;
export const WORKBENCH_PADDING_X = 1;
export const MIN_TERMINAL_COLUMNS = 20;
export const MIN_TERMINAL_ROWS = 5;

export function hasTerminalViewport(rect: Pick<PaneRect, "width" | "height">): boolean {
  return rect.width >= MIN_TERMINAL_COLUMNS && rect.height >= MIN_TERMINAL_ROWS;
}

export function hasRecoveryViewport(bounds: Pick<PaneRect, "width" | "height">): boolean {
  return bounds.width >= MIN_TERMINAL_COLUMNS && bounds.height >= PANE_RECOVERY_HEIGHT;
}

/** The fixed action inside the unavailable pane's padded three-row alert. */
export function reactivateRect(bounds: PaneRect): PaneRect {
  return { x: bounds.x + bounds.width - 14, y: bounds.y + bounds.height - 2, width: 12, height: 1 };
}

/** The top border and unavailable footer are normal flow, never terminal output. */
export function terminalRect(bounds: PaneRect, showAlert: boolean): PaneRect {
  const border = Math.min(PANE_TOP_BORDER_HEIGHT, bounds.height);
  return {
    ...bounds,
    y: bounds.y + border,
    height: Math.max(0, bounds.height - border - (showAlert ? PANE_ALERT_HEIGHT : 0)),
  };
}
export function paneIds(layout: LayoutNode | null): string[] {
  if (layout === null) {
    return [];
  }
  return layout.type === "pane"
    ? [layout.paneId]
    : [...paneIds(layout.first), ...paneIds(layout.second)];
}

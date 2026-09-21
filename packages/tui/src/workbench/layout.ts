import type { LayoutNode } from "@work-craft/server/client";

export type ProjectedLayout =
  | { paneId: string }
  | {
      direction: "row" | "column";
      ratio: number;
      children: [ProjectedLayout, ProjectedLayout];
    };

export function projectLayout(layout: LayoutNode): ProjectedLayout {
  if (layout.type === "pane") {
    return { paneId: layout.paneId };
  }
  return {
    direction: layout.direction === "vertical" ? "row" : "column",
    ratio: layout.ratio,
    children: [projectLayout(layout.first), projectLayout(layout.second)],
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

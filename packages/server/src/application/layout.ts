import type { LayoutNode } from "../api/protocol.ts";

export type PaneRect = { x: number; y: number; width: number; height: number };
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

/** Recompute direction-aware shares without changing pane order or split topology. */
export function equalizeLayout(root: LayoutNode): LayoutNode {
  function equalize(node: LayoutNode): { layout: LayoutNode; columns: number; rows: number } {
    if (node.type === "pane") {
      return { layout: node, columns: 1, rows: 1 };
    }

    const first = equalize(node.first);
    const second = equalize(node.second);
    const vertical = node.direction === "vertical";
    const firstSpan = vertical ? first.columns : first.rows;
    const secondSpan = vertical ? second.columns : second.rows;

    return {
      layout: {
        ...node,
        ratio: firstSpan / (firstSpan + secondSpan),
        first: first.layout,
        second: second.layout,
      },
      columns: vertical ? first.columns + second.columns : Math.max(first.columns, second.columns),
      rows: vertical ? Math.max(first.rows, second.rows) : first.rows + second.rows,
    };
  }

  return equalize(root).layout;
}

export function splitLayout(
  root: LayoutNode,
  targetPaneId: string,
  newPaneId: string,
  direction: "horizontal" | "vertical",
): LayoutNode {
  const replace = (node: LayoutNode): [LayoutNode, number] => {
    if (node.type === "pane") {
      if (node.paneId !== targetPaneId) {
        return [node, 0];
      }
      return [
        {
          type: "split",
          direction,
          ratio: 0.5,
          first: node,
          second: { type: "pane", paneId: newPaneId },
        },
        1,
      ];
    }

    const [first, firstMatches] = replace(node.first);
    const [second, secondMatches] = replace(node.second);
    return [{ ...node, first, second }, firstMatches + secondMatches];
  };

  const [layout, matches] = replace(root);
  if (matches !== 1) {
    throw new Error(`Expected pane ${targetPaneId} exactly once, found ${matches}`);
  }
  return equalizeLayout(layout);
}

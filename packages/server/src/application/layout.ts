import type { LayoutNode } from "../api/protocol.ts";

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

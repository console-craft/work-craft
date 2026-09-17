import type { LayoutNode } from "../api/protocol.ts";

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
  return layout;
}

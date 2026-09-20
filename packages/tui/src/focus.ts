import type { LayoutNode } from "@work-craft/server/client";

export type Direction = "left" | "right" | "up" | "down";
export type Rect = { x: number; y: number; width: number; height: number };
export type FocusTarget =
  | { region: "workspace" | "session" | "category" | "navigator" | "tabs" }
  | { region: "workbench"; paneId: string };
export type FocusNode = { target: FocusTarget; rect: Rect };

export function focusKey(target: FocusTarget): string {
  return target.region === "workbench" ? `workbench:${target.paneId}` : target.region;
}

export function projectPaneFocusNodes(layout: LayoutNode, bounds: Rect): FocusNode[] {
  if (layout.type === "pane") {
    return [{ target: { region: "workbench", paneId: layout.paneId }, rect: bounds }];
  }
  if (layout.direction === "vertical") {
    const firstWidth = Math.floor(bounds.width * layout.ratio);
    return [
      ...projectPaneFocusNodes(layout.first, { ...bounds, width: firstWidth }),
      ...projectPaneFocusNodes(layout.second, {
        ...bounds,
        x: bounds.x + firstWidth,
        width: bounds.width - firstWidth,
      }),
    ];
  }
  const firstHeight = Math.floor(bounds.height * layout.ratio);
  return [
    ...projectPaneFocusNodes(layout.first, { ...bounds, height: firstHeight }),
    ...projectPaneFocusNodes(layout.second, {
      ...bounds,
      y: bounds.y + firstHeight,
      height: bounds.height - firstHeight,
    }),
  ];
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function intervalGap(aStart: number, aSize: number, bStart: number, bSize: number): number {
  return Math.max(0, aStart - (bStart + bSize), bStart - (aStart + aSize));
}

function intervalsOverlap(aStart: number, aSize: number, bStart: number, bSize: number): boolean {
  return aStart < bStart + bSize && bStart < aStart + aSize;
}

function score(current: Rect, candidate: FocusNode, direction: Direction): readonly unknown[] {
  const currentCenter = center(current);
  const candidateCenter = center(candidate.rect);
  const horizontal = direction === "left" || direction === "right";
  const perpendicularGap = horizontal
    ? intervalGap(current.y, current.height, candidate.rect.y, candidate.rect.height)
    : intervalGap(current.x, current.width, candidate.rect.x, candidate.rect.width);
  const perpendicularOverlap = horizontal
    ? intervalsOverlap(current.y, current.height, candidate.rect.y, candidate.rect.height)
    : intervalsOverlap(current.x, current.width, candidate.rect.x, candidate.rect.width);
  const primaryGap = horizontal
    ? intervalGap(current.x, current.width, candidate.rect.x, candidate.rect.width)
    : intervalGap(current.y, current.height, candidate.rect.y, candidate.rect.height);
  const centerDistance = Math.hypot(
    candidateCenter.x - currentCenter.x,
    candidateCenter.y - currentCenter.y,
  );
  return [
    perpendicularOverlap ? 0 : 1,
    primaryGap,
    perpendicularGap,
    centerDistance,
    focusKey(candidate.target),
  ];
}

function compareScore(a: readonly unknown[], b: readonly unknown[]): number {
  for (let index = 0; index < a.length - 1; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return (a.at(-1) as string).localeCompare(b.at(-1) as string);
}

export function moveFocus(
  current: FocusTarget,
  direction: Direction,
  nodes: readonly FocusNode[],
): FocusTarget {
  const currentNode = nodes.find((node) => focusKey(node.target) === focusKey(current));
  if (currentNode === undefined) {
    return current;
  }
  const currentCenter = center(currentNode.rect);
  const candidates = nodes.filter((node) => {
    if (focusKey(node.target) === focusKey(current)) {
      return false;
    }
    const candidateCenter = center(node.rect);
    const horizontal = direction === "left" || direction === "right";
    if (
      !(horizontal
        ? intervalsOverlap(
            currentNode.rect.y,
            currentNode.rect.height,
            node.rect.y,
            node.rect.height,
          )
        : intervalsOverlap(
            currentNode.rect.x,
            currentNode.rect.width,
            node.rect.x,
            node.rect.width,
          ))
    ) {
      return false;
    }
    if (direction === "left") {
      return candidateCenter.x < currentCenter.x;
    }
    if (direction === "right") {
      return candidateCenter.x > currentCenter.x;
    }
    if (direction === "up") {
      return candidateCenter.y < currentCenter.y;
    }
    return candidateCenter.y > currentCenter.y;
  });
  candidates.sort((a, b) =>
    compareScore(score(currentNode.rect, a, direction), score(currentNode.rect, b, direction)),
  );
  return candidates[0]?.target ?? current;
}

export function focusAfterNavigatorHide(
  current: FocusTarget,
  lastPaneId: string | null,
  hasWorkbench: boolean,
): FocusTarget {
  if (current.region !== "navigator") {
    return current;
  }
  return hasWorkbench && lastPaneId !== null
    ? { region: "workbench", paneId: lastPaneId }
    : { region: "category" };
}

import { isRenderable, type Renderable } from "@opentui/core";

/** Native child order is authoritative even before layout or after keyed reordering. */
export function renderedOrder<T>(root: Renderable | null, byNode: ReadonlyMap<Renderable, T>): T[] {
  const ordered: T[] = [];
  function visit(node: Renderable): void {
    if (byNode.has(node)) {
      ordered.push(byNode.get(node)!);
    }
    for (const child of node.getChildren()) {
      if (isRenderable(child)) {
        visit(child);
      }
    }
  }
  if (root) {
    visit(root);
  }
  return ordered;
}

export function cyclicIndex(length: number, index: number, direction: -1 | 1): number | undefined {
  if (length === 0) {
    return undefined;
  }
  return index < 0 ? (direction === 1 ? 0 : length - 1) : (index + direction + length) % length;
}

export function pageIndex(
  offsets: readonly number[],
  index: number,
  direction: -1 | 1,
  distance: number,
): number | undefined {
  if (offsets.length === 0) {
    return undefined;
  }
  if (offsets[index] === undefined) {
    return direction === 1 ? 0 : offsets.length - 1;
  }
  let target = index;
  for (let next = index + direction; next >= 0 && next < offsets.length; next += direction) {
    target = next;
    if (Math.abs(offsets[target] - offsets[index]) >= distance) {
      break;
    }
  }
  return target;
}

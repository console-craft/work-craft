import { type CliRenderer, isRenderable, type Renderable } from "@opentui/core";

export function getFocusableRenderables(root: Renderable): Renderable[] {
  const focusable: Renderable[] = [];

  function visit(renderable: Renderable) {
    if (renderable.isDestroyed || !renderable.visible) {
      return;
    }

    if (renderable.focusable) {
      focusable.push(renderable);
    }

    for (const child of renderable.getChildren()) {
      if (isRenderable(child)) {
        visit(child);
      }
    }
  }

  visit(root);

  return focusable;
}

export function moveFocus(
  renderer: CliRenderer,
  direction: 1 | -1,
  root: Renderable = renderer.root,
): void {
  const focusable = getFocusableRenderables(root);

  if (focusable.length === 0) {
    return;
  }

  const currentIndex = focusable.findIndex(
    (renderable) => renderable === renderer.currentFocusedRenderable,
  );

  if (currentIndex === -1) {
    const target = direction === 1 ? focusable[0] : focusable[focusable.length - 1];

    target?.focus();
    return;
  }

  const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;

  focusable[nextIndex]?.focus();
}

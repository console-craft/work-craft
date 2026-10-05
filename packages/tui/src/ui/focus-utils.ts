import {
  type BaseRenderable,
  type CliRenderer,
  isRenderable,
  type Renderable,
} from "@opentui/core";

export type FocusScopeController = {
  repair(): Renderable | null;
  move(direction: 1 | -1): Renderable | null;
};

export function isWithinScope(node: Renderable, root: Renderable): boolean {
  for (let current: BaseRenderable | null = node; current !== null; current = current.parent) {
    if (current === root) {
      return true;
    }
  }
  return false;
}

function isVisible(node: Renderable): boolean {
  for (let current: BaseRenderable | null = node; current !== null; current = current.parent) {
    if (!current.visible || (isRenderable(current) && current.isDestroyed)) {
      return false;
    }
  }
  return true;
}

export function isEligibleFocusTarget(node: Renderable, root: Renderable): boolean {
  return node.focusable && isWithinScope(node, root) && isVisible(node);
}

export function getFocusableRenderables(root: Renderable): Renderable[] {
  const focusable: Renderable[] = [];

  if (!isVisible(root)) {
    return focusable;
  }

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

  for (const child of root.getChildren()) {
    if (isRenderable(child)) {
      visit(child);
    }
  }

  return focusable;
}

// Native blur requires focusable=true, even after a control has been disabled.
function blurRenderable(target: Renderable): void {
  const focusable = target.focusable;
  target.focusable = true;
  target.blur();
  target.focusable = focusable;
}

/** Callers check scope eligibility before requesting native focus. */
export function focusRenderable(renderer: CliRenderer, target: Renderable): Renderable | null {
  if (target.isDestroyed || !target.focusable) {
    return null;
  }
  const previous = renderer.currentFocusedRenderable;
  if (previous !== target && previous?.focused && !previous.isDestroyed && !previous.focusable) {
    blurRenderable(previous);
  }
  target.focus();
  return renderer.currentFocusedRenderable === target ? target : null;
}

export function moveFocus(
  renderer: CliRenderer,
  direction: 1 | -1,
  root: Renderable = renderer.root,
): Renderable | null {
  const focusable = getFocusableRenderables(root);

  if (focusable.length === 0) {
    return isEligibleFocusTarget(root, root) ? focusRenderable(renderer, root) : null;
  }

  const currentIndex = focusable.findIndex(
    (renderable) => renderable === renderer.currentFocusedRenderable,
  );

  if (currentIndex === -1) {
    const target = direction === 1 ? focusable[0] : focusable[focusable.length - 1];

    return target ? focusRenderable(renderer, target) : null;
  }

  const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;

  return focusRenderable(renderer, focusable[nextIndex]!);
}

/** Remembers traversal history only; the renderer remains the focus authority. */
export function createFocusScope(
  renderer: CliRenderer,
  root: Renderable,
  initialFocusId?: string,
  allowRootFocus = false,
): FocusScopeController {
  let previousTargets: Renderable[] = [];
  let lastChild: Renderable | null = null;

  function record(targets: Renderable[], result: Renderable | null): Renderable | null {
    previousTargets = targets;
    lastChild = result !== root ? result : null;
    return result;
  }

  function repair(): Renderable | null {
    const current = renderer.currentFocusedRenderable;
    if (!isVisible(root)) {
      if (current?.focused && isWithinScope(current, root)) {
        blurRenderable(current);
      }
      return null;
    }
    const targets = getFocusableRenderables(root);
    if (allowRootFocus && current === root && isEligibleFocusTarget(root, root)) {
      return record(targets, root);
    }
    if (current !== null && targets.includes(current)) {
      return record(targets, current);
    }
    const oldIndex = lastChild === null ? -1 : previousTargets.indexOf(lastChild);
    const successors =
      oldIndex < 0
        ? []
        : [...previousTargets.slice(oldIndex + 1), ...previousTargets.slice(0, oldIndex)];
    const target =
      successors.find((candidate) => targets.includes(candidate)) ??
      targets.find((candidate) => candidate.id === initialFocusId) ??
      targets[0] ??
      root;
    const result = isEligibleFocusTarget(target, root) ? focusRenderable(renderer, target) : null;
    if (result === null && current?.focused && isWithinScope(current, root)) {
      blurRenderable(current);
    }
    return record(targets, result);
  }

  return {
    repair,
    move(direction) {
      if (repair() === null) {
        return null;
      }
      return record(getFocusableRenderables(root), moveFocus(renderer, direction, root));
    },
  };
}

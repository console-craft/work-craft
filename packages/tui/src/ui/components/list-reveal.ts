import {
  type BoxRenderable,
  type CliRenderer,
  CliRenderEvents,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useLayoutEffect, useRef } from "react";

import { isVisible } from "@/ui/interaction/focus-utils";
import { isPrimaryPointerPressed } from "@/ui/interaction/pointer";

type ListRevealOptions = {
  renderer: CliRenderer;
  read(): {
    root: BoxRenderable | null;
    area: ScrollBoxRenderable | null;
    activeNode: BoxRenderable | null;
    disabled: boolean;
    pressedNode: BoxRenderable | null;
  };
  repair(): void;
  releasePress(): void;
};

/** Reveal cursor/layout changes without undoing manual scroll or moving a held pointer target. */
export function useListReveal({ renderer, repair, ...options }: ListRevealOptions): void {
  const current = useRef(options);
  current.current = options;
  useLayoutEffect(() => {
    let lastReveal: {
      node: BoxRenderable;
      top: number;
      height: number;
      width: number;
      viewportHeight: number;
      viewportWidth: number;
      focused: boolean;
    } | null = null;
    function reconcile(): void {
      if (current.current.read().disabled) {
        lastReveal = null;
        return;
      }
      repair();
      const { root, area, activeNode: node, pressedNode } = current.current.read();
      if (pressedNode && isPrimaryPointerPressed(renderer)) {
        return;
      }
      current.current.releasePress();
      if (!root || !area || !node || !isVisible(root)) {
        lastReveal = null;
        return;
      }
      // Content-relative geometry excludes wheel offsets, so manual scroll never snaps back.
      const next = {
        node,
        top: node.screenY - area.content.screenY,
        height: node.height,
        width: node.width,
        viewportHeight: area.viewport.height,
        viewportWidth: area.viewport.width,
        focused: root.focused,
      };
      const reveal =
        !lastReveal ||
        next.node !== lastReveal.node ||
        next.top !== lastReveal.top ||
        next.height !== lastReveal.height ||
        next.width !== lastReveal.width ||
        next.viewportHeight !== lastReveal.viewportHeight ||
        next.viewportWidth !== lastReveal.viewportWidth ||
        (next.focused && !lastReveal.focused);
      lastReveal = next;
      if (reveal) {
        area.scrollChildIntoView(node.id);
        // OpenTUI 0.5.14's nearest-edge reveal misses rows exactly one viewport tall.
        if (node.height === area.viewport.height) {
          area.scrollBy(node.screenY - area.viewport.screenY);
        }
      }
    }
    renderer.on(CliRenderEvents.FRAME, reconcile);
    return () => {
      renderer.off(CliRenderEvents.FRAME, reconcile);
    };
  }, [renderer, repair]);
}

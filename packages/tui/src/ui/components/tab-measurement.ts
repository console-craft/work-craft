import {
  type BoxRenderable,
  CliRenderEvents,
  type Renderable,
  TextBufferRenderable,
} from "@opentui/core";
import { Gutter, Unit } from "@opentui/core/yoga";
import { useRenderer } from "@opentui/react";
import { type RefObject, useLayoutEffect, useState } from "react";

import type { HStackProps } from "@/ui/primitives/hstack";
import { getContentWidth } from "@/ui/utils";

function getRowGap(node: Renderable): number {
  const gap = node.getGap(Gutter.Column);
  return Number.isFinite(gap.value)
    ? gap.value * (gap.unit === Unit.Percent ? node.width / 100 : 1)
    : 0;
}

export function useTabLabelWidth({
  labelRef,
  triggerRef,
  listRef,
  flexBasis,
  flexGrow,
}: {
  labelRef: RefObject<BoxRenderable | null>;
  triggerRef: RefObject<BoxRenderable | null>;
  listRef: RefObject<BoxRenderable | null>;
  flexBasis: HStackProps["flexBasis"];
  flexGrow: HStackProps["flexGrow"];
}): number {
  const renderer = useRenderer();
  const [labelWidth, setLabelWidth] = useState(0);
  useLayoutEffect(() => {
    if (flexBasis !== 0) {
      return;
    }
    function measureLabel() {
      const label = labelRef.current;
      if (!label) {
        return;
      }
      const children = label.getChildren().filter((child) => child.visible);
      const width =
        children.reduce(
          (total, child) =>
            total + (child instanceof TextBufferRenderable ? child.scrollWidth : child.width),
          0,
        ) +
        Math.max(0, children.length - 1) * getRowGap(label) +
        label.getLayout().width -
        getContentWidth(label);
      const row = triggerRef.current?.parent;
      const siblings = row?.getChildren() ?? [];
      const expanded = siblings.filter(
        (node) => node.getFlexBasis().value === 0 && node.getFlexGrow() > 0,
      );
      const weight = expanded.reduce((total, node) => total + node.getFlexGrow(), 0);
      const fixedWidth = siblings
        .filter((node) => !expanded.includes(node))
        .reduce((total, node) => total + node.width, 0);
      const available =
        (listRef.current?.width ?? 0) -
        fixedWidth -
        Math.max(0, siblings.length - 1) * (row ? getRowGap(row) : 0);
      const share = weight > 0 ? (available * (flexGrow ?? 0)) / weight : 0;
      // A minimum in Yoga's scroll layout becomes a flex base; apply it only when needed.
      setLabelWidth(width > share ? width : 0);
    }
    renderer.on(CliRenderEvents.FRAME, measureLabel);
    return () => {
      renderer.off(CliRenderEvents.FRAME, measureLabel);
    };
  }, [renderer, flexBasis, flexGrow, listRef]);

  return labelWidth;
}

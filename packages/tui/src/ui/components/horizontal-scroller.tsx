import {
  type BoxRenderable,
  CliRenderEvents,
  MouseButton,
  type MouseEvent,
  RenderableEvents,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";

import { consumePrimaryPointerPress, usePointerObservation } from "@/ui/pointer";
import { Box } from "@/ui/primitives/box";
import { HStack, type HStackProps } from "@/ui/primitives/hstack";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";

export interface HorizontalScrollerProps extends Omit<
  HStackProps,
  "focusable" | "focused" | "onKeyDown"
> {
  /** Reveal this rendered descendant without changing native focus. */
  revealId?: string;
  /** Reports contained wheel input and primary arrow presses, including at scroll edges. */
  onScrollInteraction?: () => void;
}

function canScroll(area: ScrollBoxRenderable, direction: -1 | 1): boolean {
  return direction === -1
    ? area.scrollLeft > 0
    : area.scrollLeft < area.scrollWidth - area.viewport.width;
}

function ScrollArrow({
  id,
  direction,
  disabled,
  areaRef,
  onScrollInteraction,
}: {
  id: string;
  direction: -1 | 1;
  disabled: boolean;
  areaRef: RefObject<ScrollBoxRenderable | null>;
  onScrollInteraction?: () => void;
}): ReactNode {
  const renderer = useRenderer();
  const pressed = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    pressed.current = undefined;
    const area = areaRef.current;
    // Native scroll changes can cross an edge before React updates disabled.
    function cancelAtEdge() {
      if (area && !canScroll(area, direction)) {
        pressed.current = undefined;
      }
    }
    area?.horizontalScrollBar.on("change", cancelAtEdge);
    return () => {
      area?.horizontalScrollBar.off("change", cancelAtEdge);
    };
  }, [disabled, direction, areaRef]);
  function handleDown(event: MouseEvent) {
    // Native autofocus would otherwise focus the surrounding composite.
    event.preventDefault();
    event.stopPropagation();
    if (event.button === MouseButton.LEFT) {
      onScrollInteraction?.();
    }
    const area = areaRef.current;
    const press =
      event.button === MouseButton.LEFT ? consumePrimaryPointerPress(renderer, event) : undefined;
    pressed.current =
      event.button === MouseButton.LEFT && area && canScroll(area, direction) ? press : undefined;
  }
  function handleUp(this: BoxRenderable, event: MouseEvent) {
    const wasPressed = pressed.current;
    pressed.current = undefined;
    const press =
      event.button === MouseButton.LEFT ? consumePrimaryPointerPress(renderer, event) : undefined;
    event.preventDefault();
    event.stopPropagation();
    const area = areaRef.current;
    const inside =
      event.x >= this.screenX && event.x < this.screenX + this.width && event.y === this.screenY;
    if (
      wasPressed !== undefined &&
      wasPressed === press &&
      inside &&
      event.button === MouseButton.LEFT &&
      area &&
      canScroll(area, direction)
    ) {
      area.scrollBy({ x: direction * Math.max(1, Math.floor(area.viewport.width / 2)), y: 0 });
    }
  }
  return (
    <Box
      id={id}
      width={1}
      height={1}
      alignSelf="flex-start"
      flexShrink={0}
      onMouseDown={handleDown}
      onMouseUp={handleUp}
      onMouseOut={() => {
        pressed.current = undefined;
      }}
      onMouseScroll={(event) => {
        areaRef.current?.processMouseEvent(event);
        event.stopPropagation();
      }}
    >
      <Text fg={disabled ? "mutedForeground" : "foreground"}>{direction === -1 ? "‹" : "›"}</Text>
    </Box>
  );
}

/** Pointer-only horizontal clipping and caller-directed reveal, without another focus endpoint. */
export function HorizontalScroller({
  children,
  id,
  height = 1,
  revealId,
  onScrollInteraction,
  ...props
}: HorizontalScrollerProps): ReactNode {
  const generatedId = useId();
  const name = id ?? generatedId;
  const renderer = useRenderer();
  usePointerObservation();
  const areaRef = useRef<ScrollBoxRenderable | null>(null);
  const revealRef = useRef(revealId);
  revealRef.current = revealId;
  const lastGeometry = useRef("");
  const [arrows, setArrows] = useState({ overflow: false, left: false, right: false });
  useLayoutEffect(() => {
    function update() {
      const area = areaRef.current;
      if (!area) {
        return;
      }
      const reserved =
        area.parent
          ?.getChildren()
          .filter((child) => child.id === `${name}:left` || child.id === `${name}:right`).length ??
        0;
      const available = Math.min(area.parent?.width ?? 0, area.viewport.width + reserved);
      const target = revealRef.current
        ? area.content.findDescendantById(revealRef.current)
        : undefined;
      const start = target ? target.screenX - area.viewport.screenX + area.scrollLeft : 0;
      const geometry = JSON.stringify([
        revealRef.current,
        area.viewport.width,
        area.scrollWidth,
        target?.num,
        start,
        target?.width,
      ]);
      if (geometry !== lastGeometry.current) {
        lastGeometry.current = geometry;
        if (target && area.viewport.width > 0) {
          if (target.width >= area.viewport.width) {
            area.scrollLeft = start;
          } else {
            area.scrollChildIntoView(target.id);
          }
        }
      }
      const next = {
        overflow: available >= 3 && area.scrollWidth > available,
        left: canScroll(area, -1),
        right: canScroll(area, 1),
      };
      setArrows((current) =>
        current.overflow === next.overflow &&
        current.left === next.left &&
        current.right === next.right
          ? current
          : next,
      );
    }
    renderer.on(CliRenderEvents.FRAME, update);
    // Buffered leave-and-return can refocus the owner without changing final props.
    let owner = areaRef.current?.parent;
    while (owner && !owner.focusable) {
      owner = owner.parent;
    }
    function revealOnRefocus() {
      lastGeometry.current = "";
      areaRef.current?.requestRender();
    }
    owner?.on(RenderableEvents.FOCUSED, revealOnRefocus);
    return () => {
      renderer.off(CliRenderEvents.FRAME, update);
      owner?.off(RenderableEvents.FOCUSED, revealOnRefocus);
    };
  }, [renderer, name]);
  function handleWheel(event: MouseEvent) {
    if (!event.scroll) {
      return;
    }
    onScrollInteraction?.();
    const backwards = event.scroll.direction === "up" || event.scroll.direction === "left";
    // Encode horizontal intent for the native handler's Shift remapping.
    event.scroll.direction = event.modifiers.shift
      ? backwards
        ? "up"
        : "down"
      : backwards
        ? "left"
        : "right";
  }
  return (
    <HStack {...props} id={name} height={height} gap={0}>
      {arrows.overflow ? (
        <ScrollArrow
          id={`${name}:left`}
          direction={-1}
          disabled={!arrows.left}
          areaRef={areaRef}
          onScrollInteraction={onScrollInteraction}
        />
      ) : null}
      <ScrollArea
        ref={areaRef}
        id={`${name}:viewport`}
        scrollX
        scrollY={false}
        focusable={false}
        height="100%"
        flexGrow={1}
        minWidth={0}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ visible: false }}
        onMouseScroll={handleWheel}
        viewportOptions={{ height: "100%", flexDirection: "row", overflow: "scroll" }}
        contentOptions={{ height: "100%", flexDirection: "row", flexWrap: "no-wrap" }}
      >
        {children}
      </ScrollArea>
      {arrows.overflow ? (
        <ScrollArrow
          id={`${name}:right`}
          direction={1}
          disabled={!arrows.right}
          areaRef={areaRef}
          onScrollInteraction={onScrollInteraction}
        />
      ) : null}
    </HStack>
  );
}

import {
  type BoxRenderable,
  MouseButton,
  type MouseEvent,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { type ReactNode, useRef, useState } from "react";

import { useControlHints } from "@/ui/interaction/control-hints";
import { FocusManager } from "@/ui/interaction/focus-manager";
import { focusRenderable } from "@/ui/interaction/focus-utils";
import { Container, type ContainerSize } from "@/ui/primitives/container";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";

const sizes = ["sm", "md", "lg", "full"] as const satisfies readonly ContainerSize[];

/** Shared demo layout and background-focus policy; controls keep their own keyboard actions. */
export function DemoPage({ id, children }: { id: string; children: ReactNode }) {
  const renderer = useRenderer();
  const [sizeIndex, setSizeIndex] = useState(3);
  const size = sizes[sizeIndex];
  const pageRef = useRef<BoxRenderable | null>(null);
  const areaRef = useRef<ScrollBoxRenderable | null>(null);
  useKeyboard((key) => {
    if (
      key.defaultPrevented ||
      key.repeated ||
      key.name !== "r" ||
      !key.ctrl ||
      key.shift ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    ) {
      return;
    }
    key.preventDefault();
    setSizeIndex((current) => (current + 1) % sizes.length);
  });
  useControlHints(pageRef, [
    { keys: "↑/↓/j/k", label: "Scroll" },
    { keys: "←/→/h/l", label: "Horizontal" },
    { keys: "Ctrl+u/d", label: "Half-page" },
    { keys: "g/G", label: "Top/bottom" },
  ]);

  function focusBackground(event: MouseEvent) {
    if (event.defaultPrevented || event.propagationStopped || event.button !== MouseButton.LEFT) {
      return;
    }
    const page = pageRef.current;
    const area = areaRef.current;
    if (!page || !area) {
      return;
    }
    for (
      let node: Renderable | null = event.target;
      node && node !== page && node !== area;
      node = node.parent
    ) {
      if (node.focusable) {
        return;
      }
    }
    focusRenderable(renderer, page);
  }

  return (
    <>
      <FocusManager focusScopeId={id} allowRootFocus />
      <ScrollArea
        ref={areaRef}
        width="100%"
        height="100%"
        scrollX
        bg="background"
        focusable={false}
        keyboardFallback
        onMouseDown={focusBackground}
      >
        <Container size={size} ref={pageRef} id={id} focusable bg="background">
          <Text variant="muted">{`Width: ${size} · Ctrl+r to resize`}</Text>
          {children}
        </Container>
      </ScrollArea>
    </>
  );
}

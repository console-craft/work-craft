import type { BoxRenderable, KeyEvent } from "@opentui/core";
import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { useControlHints } from "@/ui/control-hints";
import { Box } from "@/ui/primitives/box.tsx";
import { Icon, type IconProps } from "@/ui/primitives/icon.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

const activate = {
  names: ["return", "enter", "linefeed"],
  hint: { keys: "Enter", label: "Activate" },
};

const CATEGORY_ICONS: Record<CategoryKind, IconProps["name"]> = {
  inbox: "inbox",
  today: "calendar",
  design: "lightbulb",
  implementation: "code",
  collaboration: "discussion",
  operations: "tools",
};

export type CategoryRailProps = {
  categories: Snapshot["categories"];
  active: CategoryKind;
  cursor: CategoryKind;
  focused: boolean;
  onActivate(kind: CategoryKind, source: "keyboard" | "mouse"): void;
  onFocus(kind: CategoryKind): void;
};

export function CategoryRail({
  active,
  categories,
  cursor,
  focused,
  onActivate,
  onFocus,
}: CategoryRailProps): ReactNode {
  const theme = useTheme();
  const regionRef = useRef<BoxRenderable | null>(null);
  useControlHints(regionRef, categories.some(({ kind }) => kind === cursor) ? [activate.hint] : []);
  const cursorRef = useRef(cursor);
  useLayoutEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  function handleKeyDown(event: KeyEvent): void {
    if (
      event.defaultPrevented ||
      event.ctrl ||
      event.meta ||
      event.option ||
      event.super ||
      event.hyper ||
      event.shift
    ) {
      return;
    }
    const offset = ["j", "down"].includes(event.name)
      ? 1
      : ["k", "up"].includes(event.name)
        ? -1
        : 0;
    if (offset !== 0) {
      event.preventDefault();
      event.stopPropagation();
      const index = categories.findIndex(({ kind }) => kind === cursorRef.current);
      const next = index < 0 ? undefined : categories[index + offset];
      if (next !== undefined) {
        cursorRef.current = next.kind;
        onFocus(next.kind);
      }
    } else if (activate.names.includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      if (categories.some(({ kind }) => kind === cursorRef.current)) {
        onActivate(cursorRef.current, "keyboard");
      }
    }
  }
  return (
    <Box
      id="region:category"
      ref={regionRef}
      width={5}
      focusable
      focused={focused}
      onKeyDown={handleKeyDown}
    >
      {categories.map((category) => {
        const selected = focused && category.kind === cursor;
        const color = selected
          ? theme.colors.foreground
          : category.kind === active
            ? theme.colors.primary
            : theme.colors.mutedForeground;
        return (
          <Box
            id={`category:${category.kind}`}
            key={category.kind}
            flexDirection="row"
            height={1}
            onMouseDown={() => {
              cursorRef.current = category.kind;
              onFocus(category.kind);
              onActivate(category.kind, "mouse");
            }}
          >
            <Text fg={color} width={2}>
              {`${selected ? ">" : category.kind === active ? "*" : " "} `}
            </Text>
            <Icon
              id={`category-icon:${category.kind}`}
              name={CATEGORY_ICONS[category.kind]}
              fg={color}
              width={2}
              flexShrink={0}
            />
          </Box>
        );
      })}
    </Box>
  );
}

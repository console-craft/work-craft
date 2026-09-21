import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";

import { Box } from "@/ui/primitives/box.tsx";
import { Icon, type IconProps } from "@/ui/primitives/icon.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

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
  onActivate(kind: CategoryKind): void;
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
  return (
    <Box id="region:category" width={5}>
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
              onFocus(category.kind);
              onActivate(category.kind);
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

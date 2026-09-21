import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";

const CATEGORY_ICONS: Record<CategoryKind, string> = {
  inbox: "I",
  today: "T",
  design: "D",
  implementation: "M",
  collaboration: "C",
  operations: "O",
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
    <Box id="region:category" flexDirection="column" width={5}>
      {categories.map((category) => {
        const selected = focused && category.kind === cursor;
        return (
          <text
            id={`category:${category.kind}`}
            key={category.kind}
            fg={
              selected
                ? theme.colors.foreground
                : category.kind === active
                  ? theme.colors.primary
                  : theme.colors.mutedForeground
            }
            onMouseDown={() => {
              onFocus(category.kind);
              onActivate(category.kind);
            }}
          >
            {`${selected ? ">" : category.kind === active ? "*" : " "} ${CATEGORY_ICONS[category.kind]}`}
          </text>
        );
      })}
    </Box>
  );
}

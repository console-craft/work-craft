import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import { type ReactNode, useContext } from "react";

import { Toggle, ToggleGroup, ToggleGroupContext } from "@/ui/controls/toggle";
import { type IconName, icons } from "@/ui/icons/nerd";
import { Text } from "@/ui/primitives/text";

const CATEGORY_ICONS: Record<CategoryKind, IconName> = {
  inbox: "inbox",
  today: "calendar",
  design: "lightbulb",
  implementation: "code",
  collaboration: "discussion",
  operations: "tools",
};

interface CategoryProps {
  kind: CategoryKind;
  icon: string;
}

function Category({ kind, icon }: CategoryProps): ReactNode {
  const group = useContext(ToggleGroupContext);
  const isPressed = group?.isPressed(kind!);
  const isActive = group?.focused && group.activeValue === kind;
  // kept for future reference
  const isDisabled = false;

  const backgroundColor = isDisabled
    ? "background"
    : isActive
      ? "focus"
      : isPressed
        ? "muted"
        : "background";

  const foregroundColor = isDisabled
    ? "secondary"
    : isActive
      ? "primary"
      : isPressed
        ? "primary"
        : "foreground";

  return (
    <Toggle
      id={`category:${kind}`}
      value={kind}
      paddingY={1}
      bg={backgroundColor}
      alignItems="center"
      justifyContent="center"
    >
      <Text fg={foregroundColor} textAlign="center">
        {icon}
      </Text>
    </Toggle>
  );
}

export type CategoryRailProps = {
  categories: Snapshot["categories"];
  active: CategoryKind;
  focused: boolean;
  onActivate(kind: CategoryKind): void;
};

export function CategoryRail({
  active,
  categories,
  focused,
  onActivate,
}: CategoryRailProps): ReactNode {
  return (
    <ToggleGroup
      bg="background"
      id="region:category"
      type="single"
      value={active}
      orientation="vertical"
      gap={0}
      width={5}
      focused={focused}
      onValueChange={(next) => {
        const category = categories.find(({ kind }) => kind === (next ?? active));
        if (category !== undefined) {
          onActivate(category.kind);
        }
      }}
    >
      {categories.map(({ kind }) => (
        <Category key={kind} kind={kind} icon={icons[CATEGORY_ICONS[kind]]} />
      ))}
    </ToggleGroup>
  );
}

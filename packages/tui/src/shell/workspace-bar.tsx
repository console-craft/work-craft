import { type ReactNode, useContext } from "react";

import { SHELL_HEADER_HEIGHT } from "@/shell/layout.ts";
import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { Toggle, ToggleGroup, ToggleGroupContext } from "@/ui/controls/toggle";
import { icons } from "@/ui/icons/nerd";
import { Text } from "@/ui/primitives/text";

const WORKSPACE_NUMBERS = [
  icons.number1CircleOutline,
  icons.number2CircleOutline,
  icons.number3CircleOutline,
  icons.number4CircleOutline,
  icons.number5CircleOutline,
  icons.number6CircleOutline,
  icons.number7CircleOutline,
  icons.number8CircleOutline,
  icons.number9CircleOutline,
  icons.number10CircleOutline,
] as const;

function WorkspaceToggle({
  id,
  name,
  index,
}: {
  id: string;
  name: string;
  index: number;
}): ReactNode {
  const group = useContext(ToggleGroupContext);
  const isPressed = group?.isPressed(id);
  const isActive = group?.focused && group.activeValue === id;
  // kept for future reference
  const isDisabled = false;
  const number = WORKSPACE_NUMBERS[index];

  const backgroundColor = isDisabled
    ? "muted"
    : isActive
      ? "focus"
      : isPressed
        ? "foreground"
        : "background";

  const foregroundColor = isDisabled
    ? "secondary"
    : isActive
      ? "foreground"
      : isPressed
        ? "background"
        : "focus";

  return (
    <Toggle id={`workspace:${id}`} value={id} height={SHELL_HEADER_HEIGHT} bg={backgroundColor}>
      <Text fg={foregroundColor} textAlign="center" wrapMode="none">
        {number === undefined ? name : `${number} ${name}`}
      </Text>
    </Toggle>
  );
}

export type WorkspaceBarProps = {
  workspaces: readonly { id: string; name: string }[];
  activeId: string | null;
  focused: boolean;
  onActivate(id: string): void;
};

function WorkspaceScroller({ workspaces }: Pick<WorkspaceBarProps, "workspaces">): ReactNode {
  const group = useContext(ToggleGroupContext);
  return (
    <HorizontalScroller
      id="workspace-scroll"
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      height={SHELL_HEADER_HEIGHT}
      revealId={group?.focused && group.activeValue ? `workspace:${group.activeValue}` : undefined}
    >
      {workspaces.map(({ id, name }, index) => (
        <WorkspaceToggle key={id} id={id} name={name} index={index} />
      ))}
    </HorizontalScroller>
  );
}

export function WorkspaceBar({
  activeId,
  focused,
  workspaces,
  onActivate,
}: WorkspaceBarProps): ReactNode {
  return (
    <ToggleGroup
      id="region:workspace"
      type="single"
      value={activeId ?? undefined}
      orientation="horizontal"
      gap={0}
      height={SHELL_HEADER_HEIGHT}
      overflow="hidden"
      focused={focused}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      flexBasis={0}
      onValueChange={(next) => {
        const id = next ?? activeId;
        if (id !== null && workspaces.some((workspace) => workspace.id === id)) {
          onActivate(id);
        }
      }}
    >
      <WorkspaceScroller workspaces={workspaces} />
    </ToggleGroup>
  );
}

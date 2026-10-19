import type { ReactNode } from "react";

import { SHELL_HEADER_HEIGHT } from "@/shell/layout.ts";
import { SessionSwitcher, type SessionSwitcherProps } from "@/shell/session-switcher.tsx";
import { WorkspaceBar, type WorkspaceBarProps } from "@/shell/workspace-bar.tsx";
import { HStack } from "@/ui/primitives/hstack.tsx";

export type HeaderProps = {
  workspace: WorkspaceBarProps;
  session: SessionSwitcherProps;
  height?: number;
};

export function Header({
  workspace,
  session,
  height = SHELL_HEADER_HEIGHT,
}: HeaderProps): ReactNode {
  return (
    <HStack
      id="shell-header"
      height={height}
      visible={height > 0}
      flexShrink={0}
      minHeight={0}
      overflow="hidden"
      gap={0}
      alignItems="stretch"
      justifyContent="space-between"
      bg="background"
    >
      <WorkspaceBar {...workspace} />
      <SessionSwitcher {...session} />
    </HStack>
  );
}

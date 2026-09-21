import type { ReactNode } from "react";

import { SessionSwitcher, type SessionSwitcherProps } from "@/shell/session-switcher.tsx";
import { WorkspaceBar, type WorkspaceBarProps } from "@/shell/workspace-bar.tsx";
import { Box } from "@/ui/primitives/box.tsx";

export type HeaderProps = {
  workspace: WorkspaceBarProps;
  session: SessionSwitcherProps;
};

export function Header({ workspace, session }: HeaderProps): ReactNode {
  return (
    <Box flexDirection="row" height={1}>
      <WorkspaceBar {...workspace} />
      <SessionSwitcher {...session} />
    </Box>
  );
}

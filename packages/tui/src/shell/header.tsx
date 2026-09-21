import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { SessionSwitcher, type SessionSwitcherProps } from "./session-switcher.tsx";
import { WorkspaceBar, type WorkspaceBarProps } from "./workspace-bar.tsx";

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

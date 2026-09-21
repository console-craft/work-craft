import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import type { ConnectionStatus } from "../client/use-work-craft.ts";
import { ellipsize } from "./layout.ts";

export type SessionSwitcherProps = {
  name: string | null;
  status: ConnectionStatus;
  focused: boolean;
  width: number;
  onOpen(): void;
};

export function SessionSwitcher({
  focused,
  name,
  status,
  width,
  onOpen,
}: SessionSwitcherProps): ReactNode {
  const theme = useTheme();
  const label = ellipsize(name ?? "choose", width - 12);
  const statusColor: Record<ConnectionStatus, string> = {
    connected: theme.colors.success,
    connecting: theme.colors.warning,
    disconnected: theme.colors.error,
  };
  return (
    <Box id="region:session" flexDirection="row" flexShrink={0} width={width} onMouseDown={onOpen}>
      <text fg={focused ? theme.colors.foreground : theme.colors.mutedForeground}>
        {` Session: ${label} `}
      </text>
      <text id="connection-status" fg={statusColor[status]}>
        ●
      </text>
    </Box>
  );
}

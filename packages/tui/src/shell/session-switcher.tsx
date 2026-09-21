import type { ReactNode } from "react";

import type { ConnectionStatus } from "@/client/use-work-craft.ts";
import { ellipsize } from "@/shell/layout.ts";
import { Box } from "@/ui/primitives/box.tsx";
import { Icon } from "@/ui/primitives/icon.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

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
  const statusColor = {
    connected: theme.colors.success,
    connecting: theme.colors.warning,
    disconnected: theme.colors.error,
  };
  return (
    <Box id="region:session" flexDirection="row" flexShrink={0} width={width} onMouseDown={onOpen}>
      <Text fg={focused ? theme.colors.foreground : theme.colors.mutedForeground}>
        {` Session: ${label} `}
      </Text>
      <Icon id="connection-status" name="circleFilled" fg={statusColor[status]} />
    </Box>
  );
}

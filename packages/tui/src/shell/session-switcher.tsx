import type { BoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useRef } from "react";

import type { ConnectionStatus } from "@/client/use-work-craft.ts";
import { ellipsize } from "@/shell/layout.ts";
import { focusRenderable } from "@/ui/focus-utils.ts";
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
  const renderer = useRenderer();
  const endpoint = useRef<BoxRenderable>(null);
  const label = ellipsize(name ?? "choose", width - 12);
  const statusColor = {
    connected: theme.colors.success,
    connecting: theme.colors.warning,
    disconnected: theme.colors.error,
  };
  return (
    <Box
      id="region:session"
      ref={endpoint}
      focusable
      focused={focused}
      flexDirection="row"
      flexShrink={0}
      width={width}
      onMouseDown={() => {
        // Native mouse autofocus runs after callbacks; capture this launch endpoint now.
        if (endpoint.current !== null) {
          focusRenderable(renderer, endpoint.current);
        }
        onOpen();
      }}
    >
      <Text fg={focused ? theme.colors.foreground : theme.colors.mutedForeground}>
        {` Session: ${label} `}
      </Text>
      <Icon id="connection-status" name="circleFilled" fg={statusColor[status]} />
    </Box>
  );
}

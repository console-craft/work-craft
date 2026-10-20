import type { ReactNode } from "react";

import type { ConnectionStatus } from "@/client/store.ts";
import { Button } from "@/ui/controls/button.tsx";
import { Icon } from "@/ui/primitives/icon.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import type { ThemeColor } from "@/ui/theme";

const statusColors = {
  connected: "success",
  connecting: "warning",
  disconnected: "error",
} satisfies Record<ConnectionStatus, ThemeColor>;

export type SessionSwitcherProps = {
  name: string | null;
  status: ConnectionStatus;
  focused: boolean;
  onOpen(): void;
};

export function SessionSwitcher({
  focused,
  name,
  status,
  onOpen,
}: SessionSwitcherProps): ReactNode {
  return (
    <Button id="region:session" variant="ghost" focused={focused} gap={1} onPress={onOpen}>
      <Icon name="account" fg={focused ? "primary" : "foreground"} flexShrink={0} />
      <Text fg={focused ? "primary" : "foreground"}>{name ?? "Select session..."}</Text>
      <Icon id="connection-status" name="circleFilled" fg={statusColors[status]} flexShrink={0} />
    </Button>
  );
}

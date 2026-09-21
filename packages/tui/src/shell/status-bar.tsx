import type { ReactNode } from "react";

import type { CommandHint, StatusMode } from "@/input/command-router.ts";
import { Divider } from "@/ui/primitives/divider.tsx";
import { HStack } from "@/ui/primitives/hstack.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

export type StatusBarProps =
  | { mode: "HINTS" | "LEADER" | "ERROR"; hints: readonly CommandHint[]; text?: string }
  | { mode: "INFO"; text: string; hints?: never };

export function StatusBar(props: StatusBarProps): ReactNode {
  const theme = useTheme();
  const content =
    props.mode === "INFO"
      ? props.text
      : (props.text ?? props.hints.map(({ keys, label }) => `${keys} ${label}`).join("  "));
  return (
    <HStack id="status" height={1} alignItems="stretch">
      <Text
        fg={
          props.mode === "ERROR"
            ? theme.colors.error
            : props.mode === "LEADER"
              ? theme.colors.warning
              : props.mode === "INFO"
                ? theme.colors.info
                : theme.colors.primary
        }
      >
        {props.mode}
      </Text>
      <Divider orientation="vertical" />
      <Text>{content}</Text>
    </HStack>
  );
}

export function statusModeFor(leaderActive: boolean, compactNavigatorFocused: boolean): StatusMode {
  return leaderActive ? "LEADER" : compactNavigatorFocused ? "INFO" : "HINTS";
}

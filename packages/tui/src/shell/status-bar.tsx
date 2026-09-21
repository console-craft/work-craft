import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import type { CommandHint, StatusMode } from "../input/command-router.ts";

export type StatusBarProps =
  | { mode: "HINTS" | "LEADER" | "ERROR"; hints: readonly CommandHint[]; text?: string }
  | { mode: "INFO"; text: string; hints?: never };

export function StatusBar(props: StatusBarProps): ReactNode {
  const content =
    props.mode === "INFO"
      ? props.text
      : (props.text ?? props.hints.map(({ keys, label }) => `${keys} ${label}`).join("  "));
  return (
    <Box id="status" height={1} flexDirection="row">
      <Badge
        bordered={false}
        variant={
          props.mode === "ERROR"
            ? "error"
            : props.mode === "LEADER"
              ? "warning"
              : props.mode === "INFO"
                ? "info"
                : "default"
        }
      >
        {`${props.mode}  `}
      </Badge>
      <text>{content}</text>
    </Box>
  );
}

export function statusModeFor(leaderActive: boolean, compactNavigatorFocused: boolean): StatusMode {
  return leaderActive ? "LEADER" : compactNavigatorFocused ? "INFO" : "HINTS";
}

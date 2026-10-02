import type { ReactNode } from "react";

import type { CommandHint, StatusMode } from "@/input/command-router.ts";
import { icons } from "@/ui/icons/nerd";
import { Divider } from "@/ui/primitives/divider.tsx";
import { HStack } from "@/ui/primitives/hstack.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

export type StatusBarProps =
  | { mode: "HINTS" | "LEADER" | "ERROR"; hints: readonly CommandHint[]; text?: string }
  | { mode: "INFO"; text: string; hints?: never };

const keyIcons = new Map(
  Object.entries({
    hyper: icons.keyboard,
    leader: icons.space,
    command: icons.command,
    cmd: icons.command,
    super: icons.command,
    control: icons.control,
    ctrl: icons.control,
    option: icons.option,
    alt: icons.option,
    meta: icons.option,
    shift: icons.shift,
    caps: icons.caps,
    capslock: icons.capsLock,
    escape: icons.escape,
    esc: icons.escape,
    enter: icons.return,
    return: icons.return,
    backspace: icons.backspace,
    space: icons.space,
    tab: icons.tab,
    backtab: icons.tabReverse,
    tabreverse: icons.tabReverse,
    left: icons.arrowLeft,
    right: icons.arrowRight,
    up: icons.arrowUp,
    down: icons.arrowDown,
    f1: icons.f1,
    f2: icons.f2,
    f3: icons.f3,
    f4: icons.f4,
    f5: icons.f5,
    f6: icons.f6,
    f7: icons.f7,
    f8: icons.f8,
    f9: icons.f9,
    f10: icons.f10,
    f11: icons.f11,
    f12: icons.f12,
  }),
);

function formatHintKeys(keys: string): string {
  return keys
    .replace(/\b[a-z][a-z0-9]*\b/gi, (name) => keyIcons.get(name.toLowerCase()) ?? name)
    .replaceAll("+", " ");
}

export function StatusBar(props: StatusBarProps): ReactNode {
  const theme = useTheme();
  const content =
    props.mode === "INFO"
      ? props.text
      : (props.text ??
        props.hints.map(({ keys, label }, index) => (
          <span key={`${keys}:${label}`}>
            {index > 0 ? "  " : ""}
            {formatHintKeys(keys)} <span fg={theme.colors.mutedForeground}>{label} </span>
          </span>
        )));
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

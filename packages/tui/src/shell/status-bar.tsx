import type { ReactNode } from "react";

import type { CommandHint, StatusMode } from "@/input/command-router.ts";
import { SHELL_STATUS_HEIGHT } from "@/shell/layout.ts";
import { Badge, type BadgeColor } from "@/ui/components/badge";
import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { icons } from "@/ui/icons/nerd";
import { HStack } from "@/ui/primitives/hstack.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

export type StatusBarProps =
  | { mode: "HINTS" | "LEADER" | "ERROR"; hints: readonly CommandHint[]; text?: string }
  | { mode: "INFO"; text: string; hints?: never };

const modeColors = {
  HINTS: "primary",
  LEADER: "warning",
  INFO: "info",
  ERROR: "error",
} satisfies Record<StatusBarProps["mode"], BadgeColor>;

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

function formatHintKeys(keys: string, leaderPressed: boolean): string {
  let result = keys
    .replace(/\b[a-z][a-z0-9]*\b/gi, (name) => keyIcons.get(name.toLowerCase()) ?? name)
    .replaceAll("+", " ");

  if (leaderPressed) {
    result = result.replaceAll(keyIcons.get("leader")!, "").replaceAll(" ", "");
  }

  return result;
}

export function StatusBar(props: StatusBarProps): ReactNode {
  const theme = useTheme();
  const contentKey = JSON.stringify([
    props.mode,
    props.mode === "INFO" || props.mode === "ERROR"
      ? props.text
      : (props.text ?? props.hints.map(({ keys, label }) => [keys, label])),
  ]);
  const content =
    props.mode === "INFO" ? (
      props.text
    ) : props.mode === "ERROR" ? (
      <span fg={theme.colors.error}>{props.text}</span>
    ) : (
      (props.text ??
      props.hints.map(({ keys, label }, index) => (
        <span
          key={`${keys}:${label}`}
          fg={props.mode === "HINTS" ? theme.colors.primary : theme.colors.accent}
        >
          {index > 0 ? "  " : ""}
          {formatHintKeys(keys, props.mode === "LEADER")}{" "}
          <span fg={theme.colors.focus}>{label}</span>
        </span>
      )))
    );
  return (
    <HStack
      id="status"
      height={SHELL_STATUS_HEIGHT}
      flexShrink={0}
      minHeight={0}
      alignItems="stretch"
      bg="muted"
    >
      <Badge
        color={modeColors[props.mode]}
        flexShrink={0}
        marginRight={1}
        width={9}
        justifyContent="center"
      >
        {props.mode}
      </Badge>
      <HorizontalScroller
        key={contentKey}
        id="status-scroll"
        height={1}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minWidth={0}
      >
        <Text id="status-content" wrapMode="none" flexShrink={0}>
          {content}
        </Text>
      </HorizontalScroller>
    </HStack>
  );
}

export function statusModeFor(leaderActive: boolean, compactNavigatorFocused: boolean): StatusMode {
  return leaderActive ? "LEADER" : compactNavigatorFocused ? "INFO" : "HINTS";
}

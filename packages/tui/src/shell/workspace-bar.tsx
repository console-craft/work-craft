import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { ellipsize } from "@/shell/layout.ts";
import { useControlHints } from "@/ui/control-hints";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

const activate = {
  names: ["return", "enter", "linefeed"],
  hint: { keys: "Enter", label: "Activate" },
};

export type WorkspaceBarProps = {
  workspaces: readonly { id: string; name: string }[];
  visibleIds: readonly string[];
  activeId: string | null;
  cursorId: string | null;
  focused: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  width: number;
  onActivate(id: string): void;
  onFocus(id: string): void;
};

export function WorkspaceBar({
  activeId,
  cursorId,
  focused,
  hasNext,
  hasPrevious,
  visibleIds,
  width,
  workspaces,
  onActivate,
  onFocus,
}: WorkspaceBarProps): ReactNode {
  const theme = useTheme();
  const regionRef = useRef<BoxRenderable | null>(null);
  useControlHints(regionRef, workspaces.some(({ id }) => id === cursorId) ? [activate.hint] : []);
  const cursorRef = useRef(cursorId);
  useLayoutEffect(() => {
    cursorRef.current = cursorId;
  }, [cursorId]);

  function handleKeyDown(event: KeyEvent): void {
    if (
      event.defaultPrevented ||
      event.ctrl ||
      event.meta ||
      event.option ||
      event.super ||
      event.hyper ||
      event.shift
    ) {
      return;
    }
    const offset = ["l", "right"].includes(event.name)
      ? 1
      : ["h", "left"].includes(event.name)
        ? -1
        : 0;
    if (offset !== 0) {
      event.preventDefault();
      event.stopPropagation();
      const index = workspaces.findIndex(({ id }) => id === cursorRef.current);
      const next = index < 0 ? undefined : workspaces[index + offset];
      if (next !== undefined) {
        cursorRef.current = next.id;
        onFocus(next.id);
      }
    } else if (activate.names.includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      const id = cursorRef.current;
      if (id !== null && workspaces.some((workspace) => workspace.id === id)) {
        onActivate(id);
      }
    }
  }
  return (
    <Box
      id="region:workspace"
      ref={regionRef}
      flexDirection="row"
      width={width}
      overflow="hidden"
      focusable
      focused={focused}
      onKeyDown={handleKeyDown}
    >
      {hasPrevious ? <Text>{"<"}</Text> : null}
      {visibleIds.map((id) => {
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (workspace === undefined) {
          return null;
        }
        const cursor = focused && id === cursorId;
        const active = id === activeId;
        const label =
          visibleIds.length === 1
            ? ellipsize(workspace.name, width - Number(hasPrevious) - Number(hasNext) - 3)
            : workspace.name;
        return (
          <Text
            id={`workspace:${id}`}
            key={id}
            fg={
              cursor
                ? theme.colors.foreground
                : active
                  ? theme.colors.primary
                  : theme.colors.mutedForeground
            }
            onMouseDown={() => {
              cursorRef.current = id;
              onFocus(id);
              onActivate(id);
            }}
          >
            {` ${cursor ? ">" : active ? "*" : " "}${label} `}
          </Text>
        );
      })}
      {hasNext ? <Text>{">"}</Text> : null}
    </Box>
  );
}

import type { BoxRenderable, KeyEvent } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { useControlHints } from "@/ui/control-hints";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

const activate = {
  names: ["return", "enter", "linefeed"],
  hint: { keys: "Enter", label: "Activate" },
};

export type TabBarProps = {
  tabs: Snapshot["tabs"];
  activeId: string | null;
  cursorId: string | null;
  focused: boolean;
  error: string | null;
  onActivate(id: string): void;
  onFocus(id: string): void;
};

export function TabBar({
  activeId,
  cursorId,
  error,
  focused,
  tabs,
  onActivate,
  onFocus,
}: TabBarProps): ReactNode {
  const theme = useTheme();
  const regionRef = useRef<BoxRenderable | null>(null);
  useControlHints(regionRef, tabs.some(({ id }) => id === cursorId) ? [activate.hint] : []);
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
      const index = tabs.findIndex(({ id }) => id === cursorRef.current);
      const next = index < 0 ? undefined : tabs[index + offset];
      if (next !== undefined) {
        cursorRef.current = next.id;
        onFocus(next.id);
      }
    } else if (activate.names.includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      const id = cursorRef.current;
      if (id !== null && tabs.some((tab) => tab.id === id)) {
        onActivate(id);
      }
    }
  }
  return (
    <Box
      id="region:tabs"
      ref={regionRef}
      flexDirection="row"
      height={1}
      focusable
      focused={focused}
      onKeyDown={handleKeyDown}
      onMouseDown={() => {
        // A click is a focus request even when native focus is already projected here.
        const tab =
          tabs.find(({ id }) => id === cursorRef.current) ??
          tabs.find(({ id }) => id === activeId) ??
          tabs[0];
        if (tab !== undefined) {
          cursorRef.current = tab.id;
          onFocus(tab.id);
        }
      }}
    >
      <Box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden">
        {tabs.map((tab) => {
          const cursor = focused && tab.id === cursorId;
          return (
            <Text
              id={`tab:${tab.id}`}
              key={tab.id}
              fg={
                cursor
                  ? theme.colors.foreground
                  : tab.id === activeId
                    ? theme.colors.primary
                    : theme.colors.mutedForeground
              }
              onMouseDown={(event) => {
                event.stopPropagation();
                cursorRef.current = tab.id;
                onFocus(tab.id);
                onActivate(tab.id);
              }}
            >
              {` ${cursor ? ">" : tab.id === activeId ? "*" : " "}${tab.title} `}
            </Text>
          );
        })}
      </Box>
      {error === null ? null : (
        <Text id="tab-error" flexShrink={0} fg={theme.colors.error}>
          {` ${error}`}
        </Text>
      )}
    </Box>
  );
}

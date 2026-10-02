import type { BoxRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import type { NavigatorEntry } from "@/navigation/model.ts";
import { useControlHints } from "@/ui/control-hints";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

const activate = {
  names: ["return", "enter", "linefeed"],
  hint: { keys: "Enter", label: "Activate" },
};

export type NavigatorMode = "expanded" | "compact";

export type NavigatorProps = {
  title: string;
  entries: readonly NavigatorEntry[];
  mode: NavigatorMode;
  width: number;
  height: number;
  focused: boolean;
  cursorKey: string | null;
  activeKey: string | null;
  error: string | null;
  expandedProjectIds: ReadonlySet<string>;
  onExpand(projectId: string, expanded: boolean): void;
  onFocus(key: string): void;
  onActivate(key: string, source: "keyboard" | "mouse"): void;
};

function projectInitials(label: string): string {
  const words = label.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toUpperCase();
  }
  return Array.from(words[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ellipsize(label: string, width: number): string {
  if (Bun.stringWidth(label) <= width) return label;
  if (width <= 0) return "";
  if (width === 1) return "…";
  return Bun.sliceAnsi(label, 0, width - 1, { ellipsis: "…" });
}

export function Navigator({
  activeKey,
  cursorKey,
  entries,
  expandedProjectIds,
  error,
  focused,
  height,
  mode,
  title,
  width,
  onActivate,
  onFocus,
  onExpand,
}: NavigatorProps): ReactNode {
  const theme = useTheme();
  const regionRef = useRef<BoxRenderable | null>(null);
  useControlHints(regionRef, entries.some(({ key }) => key === cursorKey) ? [activate.hint] : []);
  const scrollbox = useRef<ScrollBoxRenderable>(null);
  const cursorRef = useRef(cursorKey);
  useLayoutEffect(() => {
    cursorRef.current = cursorKey;
  }, [cursorKey]);
  const expandedProjectIdsRef = useRef(expandedProjectIds);
  useLayoutEffect(() => {
    expandedProjectIdsRef.current = expandedProjectIds;
  }, [expandedProjectIds]);

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
    const index = entries.findIndex(({ key }) => key === cursorRef.current);
    const offset = ["j", "down"].includes(event.name)
      ? 1
      : ["k", "up"].includes(event.name)
        ? -1
        : 0;
    if (offset !== 0) {
      event.preventDefault();
      event.stopPropagation();
      const next = index < 0 ? undefined : entries[index + offset];
      if (next !== undefined) {
        cursorRef.current = next.key;
        onFocus(next.key);
      }
    } else if (["h", "left", "l", "right"].includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      const entry = entries[index];
      const expanded = ["l", "right"].includes(event.name);
      if (entry?.kind === "project" && expandedProjectIdsRef.current.has(entry.id) !== expanded) {
        const next = new Set(expandedProjectIdsRef.current);
        if (expanded) {
          next.add(entry.id);
        } else {
          next.delete(entry.id);
        }
        expandedProjectIdsRef.current = next;
        onExpand(entry.id, expanded);
      }
    } else if (activate.names.includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      const entry = entries[index];
      if (entry !== undefined) {
        onActivate(entry.key, "keyboard");
      }
    }
  }

  useEffect(() => {
    if (cursorKey !== null) {
      scrollbox.current?.scrollChildIntoView(`navigator-row:${cursorKey}`);
    }
  }, [cursorKey, entries.length, height]);

  return (
    <Box height={height} minHeight={0} width={width}>
      <Text height={1}>{title}</Text>
      <Box
        border
        id="region:navigator"
        ref={regionRef}
        focusable
        focused={focused}
        onKeyDown={handleKeyDown}
        flexGrow={1}
        minHeight={0}
        width={width}
        borderStyle="single"
      >
        <scrollbox ref={scrollbox} focusable={false} scrollY scrollX={false} flexGrow={1}>
          {entries.map((entry) => {
            const cursor = focused && entry.key === cursorKey;
            const active = entry.key === activeKey;
            const label =
              mode === "compact"
                ? entry.kind === "project"
                  ? projectInitials(entry.label)
                  : `${"·".repeat(entry.depth)} `
                : `${"  ".repeat(entry.depth)}${ellipsize(entry.label, width - 5 - entry.depth * 2)}`;
            return (
              <Text
                id={`navigator-row:${entry.key}`}
                key={entry.key}
                fg={
                  cursor
                    ? theme.colors.foreground
                    : active
                      ? theme.colors.primary
                      : theme.colors.mutedForeground
                }
                onMouseDown={() => {
                  cursorRef.current = entry.key;
                  onFocus(entry.key);
                  onActivate(entry.key, "mouse");
                }}
              >
                {`${cursor ? ">" : active ? "*" : " "} ${label}`}
              </Text>
            );
          })}
        </scrollbox>
        {error === null ? null : <Text fg={theme.colors.error}>{ellipsize(error, width - 2)}</Text>}
      </Box>
    </Box>
  );
}

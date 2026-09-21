import type { ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useEffect, useRef } from "react";

import type { NavigatorEntry } from "@/navigation/model.ts";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

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
  onFocus(key: string): void;
  onActivate(key: string): void;
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
  error,
  focused,
  height,
  mode,
  title,
  width,
  onActivate,
  onFocus,
}: NavigatorProps): ReactNode {
  const theme = useTheme();
  const scrollbox = useRef<ScrollBoxRenderable>(null);

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
        flexGrow={1}
        minHeight={0}
        width={width}
        borderStyle="single"
      >
        <scrollbox ref={scrollbox} scrollY scrollX={false} flexGrow={1}>
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
                  onFocus(entry.key);
                  onActivate(entry.key);
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

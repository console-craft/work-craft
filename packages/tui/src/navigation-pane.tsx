import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { NavigatorEntry } from "./navigation.ts";
import { ellipsize, projectInitials, type NavigatorMode } from "./shell-layout.ts";

export type NavigationPaneProps = {
  entries: NavigatorEntry[];
  mode: Exclude<NavigatorMode, "hidden">;
  width: number;
  focused: boolean;
  cursorKey: string | null;
  activeKey: string | null;
  error: string | null;
  onFocus(key: string): void;
  onActivate(key: string): void;
};

export function NavigationPane({
  activeKey,
  cursorKey,
  entries,
  error,
  focused,
  mode,
  width,
  onActivate,
  onFocus,
}: NavigationPaneProps) {
  const scrollbox = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    if (cursorKey !== null) {
      scrollbox.current?.scrollChildIntoView(`navigator-row:${cursorKey}`);
    }
  }, [cursorKey]);

  return (
    <box
      id="region:navigator"
      flexDirection="column"
      flexGrow={1}
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
            <text
              id={`navigator-row:${entry.key}`}
              key={entry.key}
              fg={cursor ? "#FFFFFF" : active ? "#60A5FA" : "#9CA3AF"}
              onMouseDown={() => {
                onFocus(entry.key);
                onActivate(entry.key);
              }}
            >
              {`${cursor ? ">" : active ? "*" : " "} ${label}`}
            </text>
          );
        })}
      </scrollbox>
      {error === null ? null : <text fg="#EF4444">{ellipsize(error, width - 2)}</text>}
    </box>
  );
}

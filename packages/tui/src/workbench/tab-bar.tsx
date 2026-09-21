import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";

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
  return (
    <Box id="region:tabs" flexDirection="row" height={1}>
      <Box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden">
        {tabs.map((tab) => {
          const cursor = focused && tab.id === cursorId;
          return (
            <text
              id={`tab:${tab.id}`}
              key={tab.id}
              fg={
                cursor
                  ? theme.colors.foreground
                  : tab.id === activeId
                    ? theme.colors.primary
                    : theme.colors.mutedForeground
              }
              onMouseDown={() => {
                onFocus(tab.id);
                onActivate(tab.id);
              }}
            >
              {` ${cursor ? ">" : tab.id === activeId ? "*" : " "}${tab.title} `}
            </text>
          );
        })}
      </Box>
      {error === null ? null : (
        <text id="tab-error" flexShrink={0} fg={theme.colors.error}>
          {` ${error}`}
        </text>
      )}
    </Box>
  );
}

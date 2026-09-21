import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";

import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

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
              onMouseDown={() => {
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

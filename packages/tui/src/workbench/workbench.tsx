import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import type { ReactNode } from "react";

import type { TerminalBuffer } from "@/client/use-work-craft.ts";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";
import { SurfaceView } from "@/workbench/surface-view.tsx";
import { TabBar } from "@/workbench/tab-bar.tsx";

export type WorkbenchProps = {
  snapshot: Snapshot | null;
  stream: StreamConnection | null;
  terminals: ReadonlyMap<string, TerminalBuffer>;
  surface: Snapshot["surfaces"][number] | undefined;
  tabs: Snapshot["tabs"];
  activeTabId: string | null;
  tabCursorId: string | null;
  tabsFocused: boolean;
  workbenchFocused: boolean;
  focusedPaneId: string | null;
  undersized: boolean;
  tabError: string | null;
  workbenchError: string | null;
  onFocusTab(id: string): void;
  onActivateTab(id: string): void;
  onFocusPane(id: string): void;
  onTerminalReady(id: string, terminal: EmbeddedTerminalRenderable | null): void;
};

export function Workbench({
  activeTabId,
  focusedPaneId,
  snapshot,
  stream,
  surface,
  tabCursorId,
  tabError,
  tabs,
  tabsFocused,
  terminals,
  undersized,
  workbenchError,
  workbenchFocused,
  onActivateTab,
  onFocusPane,
  onFocusTab,
  onTerminalReady,
}: WorkbenchProps): ReactNode {
  const theme = useTheme();
  return (
    <Box flexGrow={1} minWidth={0}>
      <TabBar
        activeId={activeTabId}
        cursorId={tabCursorId}
        error={tabError}
        focused={tabsFocused}
        tabs={tabs}
        onActivate={onActivateTab}
        onFocus={onFocusTab}
      />
      <Box border id="region:workbench" flexGrow={1} minHeight={0} borderStyle="single">
        {workbenchError === null ? null : <Text fg={theme.colors.error}>{workbenchError}</Text>}
        {surface === undefined || snapshot === null ? (
          <Text fg={theme.colors.mutedForeground}>Select an item with an execution surface</Text>
        ) : (
          <SurfaceView
            focusedPaneId={focusedPaneId}
            snapshot={snapshot}
            stream={stream}
            surface={surface}
            terminals={terminals}
            undersized={undersized}
            workbenchFocused={workbenchFocused}
            onFocusPane={onFocusPane}
            onTerminalReady={onTerminalReady}
          />
        )}
      </Box>
    </Box>
  );
}

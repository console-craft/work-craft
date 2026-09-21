import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import type { TerminalBuffer } from "../client/use-work-craft.ts";
import { SurfaceView } from "./surface-view.tsx";
import { TabBar } from "./tab-bar.tsx";

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
    <Box flexDirection="column" flexGrow={1} minWidth={0}>
      <TabBar
        activeId={activeTabId}
        cursorId={tabCursorId}
        error={tabError}
        focused={tabsFocused}
        tabs={tabs}
        onActivate={onActivateTab}
        onFocus={onFocusTab}
      />
      <Box
        border
        id="region:workbench"
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        borderStyle="single"
      >
        {workbenchError === null ? null : <text fg={theme.colors.error}>{workbenchError}</text>}
        {surface === undefined || snapshot === null ? (
          <text fg={theme.colors.mutedForeground}>Select an item with an execution surface</text>
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

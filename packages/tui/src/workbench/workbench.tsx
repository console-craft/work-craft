import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import type { ReactNode } from "react";

import type { TerminalOutputs } from "@/client/terminal-output";
import { EmptyState, EmptyStateDescription, EmptyStateTitle } from "@/ui/components/empty-state";
import { Box } from "@/ui/primitives/box.tsx";
import { WORKBENCH_PADDING_X } from "@/workbench/layout.ts";
import { SurfaceView } from "@/workbench/surface-view.tsx";
import { TabBar } from "@/workbench/tab-bar.tsx";
import type { TerminalPaneProps } from "@/workbench/terminal-pane";

export type WorkbenchProps = Pick<
  TerminalPaneProps,
  "stamp" | "canRespond" | "inputEvent" | "onMouseInput" | "onResync"
> & {
  connected: boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  canReactivate(paneId: string): boolean;
  onReactivatePane(paneId: string): void;
  snapshot: Omit<Snapshot, "terminalHistories"> | null;
  stream: StreamConnection | null;
  outputs: TerminalOutputs;
  surface: Snapshot["surfaces"][number] | undefined;
  tabs: Snapshot["tabs"];
  activeTabId: string | null;
  tabCursorId: string | null;
  tabsFocused: boolean;
  workbenchFocused: boolean;
  focusedPaneId: string | null;
  undersized: boolean;
  failed?: boolean;
  inputEnabled?: boolean;
  entryEnabled?: boolean;
  canReceiveInput?(paneId?: string): boolean;
  onSourceFailure?(source: { paneId: string; message: string }): void;
  onFocusTab(id: string): void;
  onActivateTab(id: string): void;
  onEnterTab(id: string): void;
  onTabScrollInteraction(): void;
  onFocusPane(id: string): void;
  onTerminalReady(id: string, terminal: EmbeddedTerminalRenderable | null): void;
};

export function Workbench({
  connected,
  reactivatingPaneIds,
  canReactivate,
  onReactivatePane,
  stamp,
  canRespond,
  inputEvent,
  onMouseInput,
  onResync,
  inputEnabled,
  entryEnabled,
  canReceiveInput,
  activeTabId,
  focusedPaneId,
  snapshot,
  stream,
  surface,
  tabCursorId,
  tabs,
  tabsFocused,
  outputs,
  undersized,
  failed,
  onSourceFailure,
  workbenchFocused,
  onActivateTab,
  onEnterTab,
  onTabScrollInteraction,
  onFocusPane,
  onFocusTab,
  onTerminalReady,
}: WorkbenchProps): ReactNode {
  return (
    <Box flexGrow={1} minWidth={0} minHeight={0} height="100%" overflow="hidden">
      <TabBar
        activeId={activeTabId}
        cursorId={tabCursorId}
        failed={failed}
        inputEnabled={inputEnabled}
        entryEnabled={entryEnabled}
        canReceiveInput={canReceiveInput}
        focused={tabsFocused}
        tabs={tabs}
        onActivate={onActivateTab}
        onEnter={onEnterTab}
        onScrollInteraction={onTabScrollInteraction}
        onFocus={onFocusTab}
      />
      <Box id="region:workbench" flexGrow={1} minHeight={0} paddingX={WORKBENCH_PADDING_X}>
        {surface === undefined || snapshot === null ? (
          <EmptyState gap={0} flexGrow={1} minHeight={0}>
            <EmptyStateTitle>No execution surface</EmptyStateTitle>
            <EmptyStateDescription>Select an item with an execution surface</EmptyStateDescription>
          </EmptyState>
        ) : (
          <SurfaceView
            connected={connected}
            reactivatingPaneIds={reactivatingPaneIds}
            canReactivate={canReactivate}
            onReactivatePane={onReactivatePane}
            focusedPaneId={focusedPaneId}
            inputEnabled={inputEnabled}
            canReceiveInput={canReceiveInput}
            activeTabId={activeTabId}
            stamp={stamp}
            canRespond={canRespond}
            inputEvent={inputEvent}
            onMouseInput={onMouseInput}
            onResync={onResync}
            snapshot={snapshot}
            stream={stream}
            surface={surface}
            outputs={outputs}
            undersized={undersized}
            workbenchFocused={workbenchFocused}
            onFocusPane={onFocusPane}
            onTerminalReady={onTerminalReady}
            onSourceFailure={onSourceFailure}
          />
        )}
      </Box>
    </Box>
  );
}

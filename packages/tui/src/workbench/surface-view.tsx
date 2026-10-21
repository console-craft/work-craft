import type { BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core";
import { projectPaneLayout, type Snapshot, type StreamConnection } from "@work-craft/server/client";
import { useEffect, useState } from "react";

import type { TerminalBuffer } from "@/client/terminal-buffer.ts";
import type { TerminalOutputs } from "@/client/terminal-output";
import { EmptyState, EmptyStateDescription, EmptyStateTitle } from "@/ui/components/empty-state";
import { Box } from "@/ui/primitives/box.tsx";
import { Divider } from "@/ui/primitives/divider.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theming/theme-provider.tsx";
import { hasTerminalViewport, paneIds, terminalRect } from "@/workbench/layout.ts";
import { selectedTab } from "@/workbench/model";
import { paneNotice } from "@/workbench/pane-state.ts";
import { TerminalPane, type TerminalPaneProps } from "@/workbench/terminal-pane.tsx";

export function terminalPaneKey(
  paneId: string,
  buffer: Pick<TerminalBuffer, "epoch" | "historyCursor"> | undefined,
): string {
  return `${paneId}:${buffer?.epoch ?? "pending"}:${buffer?.historyCursor ?? 0}`;
}

export type SurfaceViewProps = Pick<
  TerminalPaneProps,
  "stamp" | "canRespond" | "inputEvent" | "onMouseInput" | "onResync"
> & {
  activeTabId: string | null;
  connected: boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  canReactivate(paneId: string): boolean;
  onReactivatePane(paneId: string): void;
  snapshot: Snapshot;
  stream: StreamConnection | null;
  surface: Snapshot["surfaces"][number];
  outputs: TerminalOutputs;
  focusedPaneId: string | null;
  workbenchFocused: boolean;
  undersized: boolean;
  onFocusPane(paneId: string): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
  onSourceFailure?(source: { paneId: string; message: string }): void;
  inputEnabled?: boolean;
  canReceiveInput?(paneId?: string): boolean;
};

export function SurfaceView({
  connected,
  reactivatingPaneIds,
  canReactivate,
  onReactivatePane,
  activeTabId,
  stamp,
  canRespond,
  inputEvent,
  onMouseInput,
  onResync,
  inputEnabled = true,
  canReceiveInput,
  focusedPaneId,
  onFocusPane,
  onTerminalReady,
  snapshot,
  stream,
  surface,
  outputs,
  undersized,
  workbenchFocused,
  onSourceFailure,
}: SurfaceViewProps) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  function measure(this: BoxRenderable): void {
    // Native renderables clamp zero to one; project the actual available Yoga area.
    const { width, height } = this.getLayout();
    setSize((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  }
  const activeTab = selectedTab(
    snapshot.tabs.filter(({ surfaceId }) => surfaceId === surface.id),
    activeTabId,
  );
  useEffect(() => {
    for (const paneId of paneIds(activeTab?.layout ?? null)) {
      if (!snapshot.panes.some((pane) => pane.id === paneId)) {
        onSourceFailure?.({ paneId, message: "Layout references a missing pane" });
      }
    }
  }, [activeTab, snapshot.panes, onSourceFailure]);
  const geometry = projectPaneLayout(activeTab?.layout ?? null, { x: 0, y: 0, ...size });

  return (
    <Box
      flexDirection="row"
      flexGrow={1}
      minHeight={0}
      minWidth={0}
      width="100%"
      height="100%"
      onSizeChange={measure}
    >
      {activeTab?.layout == null ? (
        <EmptyState gap={0} flexGrow={1} minHeight={0}>
          <EmptyStateTitle>No terminal panes</EmptyStateTitle>
          <EmptyStateDescription>Create a terminal tab to get started</EmptyStateDescription>
        </EmptyState>
      ) : (
        <Box visible={!undersized} width="100%" height="100%">
          {geometry.panes.map(({ paneId, rect }) => {
            const pane = snapshot.panes.find(({ id }) => id === paneId);
            const output = outputs.pane(paneId);
            const buffer = output.read();
            const viewport = terminalRect(
              rect,
              pane !== undefined && paneNotice(pane.processStatus, connected) !== null,
            );
            const usable = !undersized && hasTerminalViewport(viewport);
            return (
              <Box
                key={paneId}
                position="absolute"
                left={rect.x}
                top={rect.y}
                width={rect.width}
                height={rect.height}
                visible={rect.width > 0 && rect.height > 0}
                overflow="hidden"
              >
                {pane === undefined ? (
                  <Text fg={theme.colors.error}>! Missing pane</Text>
                ) : (
                  <TerminalPane
                    bounds={rect}
                    connected={connected}
                    reactivatingPaneIds={reactivatingPaneIds}
                    canReactivate={canReactivate}
                    onReactivatePane={onReactivatePane}
                    key={terminalPaneKey(paneId, buffer)}
                    output={output}
                    focused={workbenchFocused && paneId === focusedPaneId}
                    pane={pane}
                    size={snapshot.geometry.panes.find((entry) => entry.paneId === paneId)!.size}
                    stamp={stamp}
                    canRespond={canRespond}
                    inputEvent={inputEvent}
                    onMouseInput={onMouseInput}
                    onResync={onResync}
                    stream={stream}
                    inputEnabled={inputEnabled && usable}
                    canReceiveInput={canReceiveInput}
                    onFocus={() => onFocusPane(paneId)}
                    onTerminalReady={onTerminalReady}
                  />
                )}
              </Box>
            );
          })}
          {geometry.dividers.map(({ id, orientation, rect }) => (
            <Divider
              key={id}
              orientation={orientation}
              position="absolute"
              left={rect.x}
              top={rect.y}
              width={rect.width}
              height={rect.height}
              visible={rect.width > 0 && rect.height > 0 && orientation !== "horizontal"}
            />
          ))}
        </Box>
      )}
      {undersized ? (
        <EmptyState gap={0} flexGrow={1} minHeight={0}>
          <EmptyStateTitle>Workbench too small.</EmptyStateTitle>
          <EmptyStateDescription>Resize terminal or use leader+b.</EmptyStateDescription>
        </EmptyState>
      ) : null}
    </Box>
  );
}

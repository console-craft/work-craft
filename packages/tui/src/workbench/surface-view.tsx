import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";

import type { TerminalBuffer } from "@/client/use-work-craft.ts";
import { Box } from "@/ui/primitives/box.tsx";
import { Divider } from "@/ui/primitives/divider.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";
import { type ProjectedLayout, projectLayout } from "@/workbench/layout.ts";
import { TerminalPane } from "@/workbench/terminal-pane.tsx";

export function terminalPaneKey(
  paneId: string,
  buffer: Pick<TerminalBuffer, "epoch" | "historyCursor"> | undefined,
): string {
  return `${paneId}:${buffer?.epoch ?? "pending"}:${buffer?.historyCursor ?? 0}`;
}

export type SurfaceViewProps = {
  snapshot: Snapshot;
  stream: StreamConnection | null;
  surface: Snapshot["surfaces"][number];
  terminals: ReadonlyMap<string, TerminalBuffer>;
  focusedPaneId: string | null;
  workbenchFocused: boolean;
  undersized: boolean;
  onFocusPane(paneId: string): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
};

type LayoutViewProps = Pick<SurfaceViewProps, "snapshot" | "stream" | "terminals"> & {
  focusedPaneId: string | null;
  layout: ProjectedLayout;
  resizeEnabled: boolean;
  workbenchFocused: boolean;
  onFocusPane(paneId: string): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
};

function LayoutView({
  focusedPaneId,
  layout,
  resizeEnabled,
  snapshot,
  stream,
  terminals,
  workbenchFocused,
  onFocusPane,
  onTerminalReady,
}: LayoutViewProps) {
  const theme = useTheme();
  if ("paneId" in layout) {
    const pane = snapshot.panes.find(({ id }) => id === layout.paneId);
    const buffer = terminals.get(layout.paneId);
    return pane === undefined ? (
      <Text fg={theme.colors.error}>Missing pane: {layout.paneId}</Text>
    ) : (
      <TerminalPane
        key={terminalPaneKey(pane.id, buffer)}
        buffer={buffer}
        focused={workbenchFocused && pane.id === focusedPaneId}
        pane={pane}
        resizeEnabled={resizeEnabled}
        stream={stream}
        onFocus={() => onFocusPane(pane.id)}
        onTerminalReady={onTerminalReady}
      />
    );
  }
  return (
    <Box flexDirection={layout.direction} width="100%" height="100%">
      <Box flexDirection="row" flexBasis={0} flexGrow={layout.ratio} minWidth={0} minHeight={0}>
        <LayoutView
          {...{
            focusedPaneId,
            resizeEnabled,
            snapshot,
            stream,
            terminals,
            workbenchFocused,
            onFocusPane,
            onTerminalReady,
          }}
          layout={layout.children[0]}
        />
      </Box>
      <Divider orientation={layout.direction === "row" ? "vertical" : "horizontal"} />
      <Box flexDirection="row" flexBasis={0} flexGrow={1 - layout.ratio} minWidth={0} minHeight={0}>
        <LayoutView
          {...{
            focusedPaneId,
            resizeEnabled,
            snapshot,
            stream,
            terminals,
            workbenchFocused,
            onFocusPane,
            onTerminalReady,
          }}
          layout={layout.children[1]}
        />
      </Box>
    </Box>
  );
}

export function SurfaceView({
  focusedPaneId,
  onFocusPane,
  onTerminalReady,
  snapshot,
  stream,
  surface,
  terminals,
  undersized,
  workbenchFocused,
}: SurfaceViewProps) {
  const theme = useTheme();
  const tabs = snapshot.tabs
    .filter(({ surfaceId }) => surfaceId === surface.id)
    .sort((a, b) => a.position - b.position);
  const activeTab = tabs.find(({ id }) => id === surface.activeTabId);
  const layout =
    activeTab?.layout === null || activeTab === undefined
      ? undefined
      : projectLayout(activeTab.layout);

  return (
    <Box flexDirection="row" flexGrow={1} width="100%" height="100%">
      {layout === undefined ? (
        <Text fg={theme.colors.mutedForeground}>No terminal panes</Text>
      ) : (
        <Box flexDirection="row" visible={!undersized} width="100%" height="100%">
          <LayoutView
            focusedPaneId={focusedPaneId}
            layout={layout}
            resizeEnabled={!undersized}
            snapshot={snapshot}
            stream={stream}
            terminals={terminals}
            workbenchFocused={workbenchFocused}
            onFocusPane={onFocusPane}
            onTerminalReady={onTerminalReady}
          />
        </Box>
      )}
      {undersized ? <Text>Workbench too small. Resize terminal or use leader+b.</Text> : null}
    </Box>
  );
}

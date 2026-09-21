import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { LayoutNode, Snapshot, StreamConnection } from "@work-craft/server/client";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import { TerminalPane } from "./terminal-pane.tsx";
import type { TerminalBuffer } from "./client/use-work-craft.ts";

export type ProjectedLayout =
  | { paneId: string }
  | {
      direction: "row" | "column";
      ratio: number;
      children: [ProjectedLayout, ProjectedLayout];
    };

export function projectLayout(layout: LayoutNode): ProjectedLayout {
  if (layout.type === "pane") {
    return { paneId: layout.paneId };
  }
  return {
    direction: layout.direction === "vertical" ? "row" : "column",
    ratio: layout.ratio,
    children: [projectLayout(layout.first), projectLayout(layout.second)],
  };
}

export function terminalPaneKey(
  paneId: string,
  buffer: Pick<TerminalBuffer, "epoch" | "historyCursor"> | undefined,
): string {
  return `${paneId}:${buffer?.epoch ?? "pending"}:${buffer?.historyCursor ?? 0}`;
}

export function adjacentTab<T extends { id: string }>(
  tabs: readonly T[],
  activeTabId: string,
  offset: -1 | 1,
): T | undefined {
  const index = tabs.findIndex(({ id }) => id === activeTabId);
  return index < 0 ? undefined : tabs[index + offset];
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

export function paneIds(layout: ProjectedLayout): string[] {
  return "paneId" in layout ? [layout.paneId] : layout.children.flatMap(paneIds);
}

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
      <text fg={theme.colors.error}>Missing pane: {layout.paneId}</text>
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
  const firstSize = `${layout.ratio * 100}%` as `${number}%`;
  const secondSize = `${(1 - layout.ratio) * 100}%` as `${number}%`;
  const size = layout.direction === "row" ? "width" : "height";
  return (
    <Box flexDirection={layout.direction} width="100%" height="100%">
      <Box {...{ [size]: firstSize }}>
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
      <Box {...{ [size]: secondSize }}>
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
    <Box flexGrow={1} width="100%" height="100%">
      {layout === undefined ? (
        <text fg={theme.colors.mutedForeground}>No terminal panes</text>
      ) : (
        <Box visible={!undersized} width="100%" height="100%">
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
      {undersized ? <text>Workbench too small. Resize terminal or use leader+b.</text> : null}
    </Box>
  );
}

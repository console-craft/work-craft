import { useKeyboard } from "@opentui/react";
import type { Command, LayoutNode, Snapshot, StreamConnection } from "@work-craft/server/client";
import { useState } from "react";
import { TerminalPane } from "./terminal-pane.tsx";
import type { TerminalBuffer } from "./use-work-craft.ts";

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

export function tabSelectionCommand(
  key: "[" | "]",
  surfaceId: string,
  tabs: { id: string }[],
  activeTabId: string,
): Extract<Command, { type: "surface.selectTab" }> | undefined {
  const activeIndex = tabs.findIndex(({ id }) => id === activeTabId);
  if (activeIndex === -1) {
    return undefined;
  }
  const offset = key === "[" ? -1 : 1;
  const index = (activeIndex + offset + tabs.length) % tabs.length;
  return { type: "surface.selectTab", surfaceId, tabId: tabs[index]!.id };
}

type SurfaceViewProps = {
  controlsEnabled: boolean;
  snapshot: Snapshot;
  stream: StreamConnection | null;
  surface: Snapshot["surfaces"][number];
  terminals: ReadonlyMap<string, TerminalBuffer>;
  onCommand(command: Command): void;
};

type LayoutViewProps = Pick<SurfaceViewProps, "snapshot" | "stream" | "terminals"> & {
  activePaneId: string | undefined;
  layout: ProjectedLayout;
  onActivate(paneId: string): void;
};

function paneIds(layout: ProjectedLayout): string[] {
  return "paneId" in layout ? [layout.paneId] : layout.children.flatMap(paneIds);
}

function LayoutView({
  activePaneId,
  layout,
  snapshot,
  stream,
  terminals,
  onActivate,
}: LayoutViewProps) {
  if ("paneId" in layout) {
    const pane = snapshot.panes.find(({ id }) => id === layout.paneId);
    const buffer = terminals.get(layout.paneId);
    return pane === undefined ? (
      <text fg="#EF4444">Missing pane: {layout.paneId}</text>
    ) : (
      <TerminalPane
        key={terminalPaneKey(pane.id, buffer)}
        active={pane.id === activePaneId}
        buffer={buffer}
        pane={pane}
        stream={stream}
        onActivate={() => onActivate(pane.id)}
      />
    );
  }
  const firstSize = `${layout.ratio * 100}%` as `${number}%`;
  const secondSize = `${(1 - layout.ratio) * 100}%` as `${number}%`;
  const size = layout.direction === "row" ? "width" : "height";
  return (
    <box flexDirection={layout.direction} width="100%" height="100%">
      <box {...{ [size]: firstSize }}>
        <LayoutView
          {...{ activePaneId, snapshot, stream, terminals, onActivate }}
          layout={layout.children[0]}
        />
      </box>
      <box {...{ [size]: secondSize }}>
        <LayoutView
          {...{ activePaneId, snapshot, stream, terminals, onActivate }}
          layout={layout.children[1]}
        />
      </box>
    </box>
  );
}

export function SurfaceView({
  controlsEnabled,
  snapshot,
  stream,
  surface,
  terminals,
  onCommand,
}: SurfaceViewProps) {
  const tabs = snapshot.tabs
    .filter(({ surfaceId }) => surfaceId === surface.id)
    .sort((a, b) => a.position - b.position);
  const activeTab = tabs.find(({ id }) => id === surface.activeTabId);
  const layout =
    activeTab?.layout === null || activeTab === undefined
      ? undefined
      : projectLayout(activeTab.layout);
  const ids = layout === undefined ? [] : paneIds(layout);
  const [selectedPaneId, setSelectedPaneId] = useState<string>();
  const activePaneId = ids.includes(selectedPaneId ?? "") ? selectedPaneId : ids[0];

  useKeyboard((key) => {
    if (!controlsEnabled || activeTab === undefined) {
      return;
    }
    let command: Command | undefined;
    if (key.name === "[" || key.name === "]") {
      command = tabSelectionCommand(key.name, surface.id, tabs, activeTab.id);
    } else if (key.name === "t") {
      command = { type: "tab.create", surfaceId: surface.id, title: "Shell" };
    } else if ((key.name === "\\" || key.name === "-") && activePaneId !== undefined) {
      command = {
        type: "pane.split",
        paneId: activePaneId,
        direction: key.name === "\\" ? "vertical" : "horizontal",
      };
    } else if (key.name === "r" && activePaneId !== undefined) {
      const status = snapshot.panes.find(({ id }) => id === activePaneId)?.processStatus;
      if (status === "failed" || status === "exited") {
        command = { type: "process.restart", paneId: activePaneId };
      }
    }
    if (command !== undefined) {
      key.preventDefault();
      key.stopPropagation();
      onCommand(command);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <text>
        {tabs
          .map(
            (tab) =>
              `${tab.id === activeTab?.id ? "[" : " "}${tab.title}${tab.id === activeTab?.id ? "]" : " "}`,
          )
          .join(" ")}
      </text>
      {layout === undefined ? (
        <text fg="#9CA3AF">No terminal panes</text>
      ) : (
        <LayoutView
          activePaneId={activePaneId}
          layout={layout}
          snapshot={snapshot}
          stream={stream}
          terminals={terminals}
          onActivate={setSelectedPaneId}
        />
      )}
    </box>
  );
}

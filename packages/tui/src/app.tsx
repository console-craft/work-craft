import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import type { CategoryKind, Command, CommandResponse } from "@work-craft/server/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { CreatePrompt, type CreateKind } from "./create-prompt.tsx";
import {
  buildNavigation,
  flattenNavigation,
  type NavigationEntry,
  type NavigationNode,
} from "./navigation.ts";
import { NavigationPane } from "./navigation-pane.tsx";
import { SessionChooser } from "./session-chooser.tsx";
import { adjacentTab, paneIds, projectLayout, SurfaceView } from "./surface-view.tsx";
import { useWorkCraft } from "./use-work-craft.ts";

function ancestor(
  entry: NavigationEntry | undefined,
  kind: NavigationNode["kind"],
): NavigationNode | undefined {
  return entry?.path.findLast((node) => node.kind === kind);
}

function createCommand(
  kind: CreateKind,
  name: string,
  sessionId: string | undefined,
  entry?: NavigationEntry,
): Command | null {
  const workspace = ancestor(entry, "workspace");
  const category = ancestor(entry, "category");
  const project = ancestor(entry, "project");
  switch (kind) {
    case "session":
      return { type: "session.create", name };
    case "workspace":
      return sessionId === undefined ? null : { type: "workspace.create", sessionId, name };
    case "project":
      return workspace === undefined || category === undefined
        ? null
        : {
            type: "project.create",
            workspaceId: workspace.id,
            category: category.id as CategoryKind,
            name,
          };
    case "item":
      return project === undefined
        ? null
        : { type: "item.create", projectId: project.id, kind: "generic", title: name };
  }
}

function canCreate(kind: CreateKind, entry: NavigationEntry | undefined): boolean {
  if (kind === "workspace") {
    return true;
  }
  const required = kind === "project" ? "category" : "project";
  return ancestor(entry, required) !== undefined;
}

function statusVariant(status: string): BadgeVariant {
  return status === "connected" || status === "running"
    ? "success"
    : status === "connecting" || status === "starting"
      ? "warning"
      : "error";
}

export function App() {
  const { snapshot, status, command, stream, terminals } = useWorkCraft();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prompt, setPrompt] = useState<CreateKind | null>(null);
  const [openedItemId, setOpenedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chooserRequested, setChooserRequested] = useState(false);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const sessions = [...(snapshot?.sessions ?? [])].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const selectedSession = sessions.find(({ id }) => id === activeSessionId);
  const automaticSession =
    activeSessionId === null && !chooserRequested && sessions.length === 1
      ? sessions[0]
      : undefined;
  const activeSession = selectedSession ?? automaticSession;
  const choosingSession = chooserRequested || activeSession === undefined;

  useEffect(() => {
    if (automaticSession !== undefined) {
      setActiveSessionId(automaticSession.id);
    }
  }, [automaticSession]);

  const entries =
    snapshot === null || activeSession === undefined
      ? []
      : flattenNavigation(buildNavigation(snapshot, activeSession.id));
  const index = Math.max(0, Math.min(selectedIndex, entries.length - 1));
  const selected = entries[index];
  const surface = snapshot?.surfaces.find((value) => value.itemId === openedItemId);
  const surfaceTabs = (snapshot?.tabs ?? [])
    .filter(({ surfaceId }) => surfaceId === surface?.id)
    .sort((a, b) => a.position - b.position);
  const activeSurfaceTab = surfaceTabs.find(({ id }) => id === surface?.activeTabId);
  const surfaceLayout =
    activeSurfaceTab?.layout === null || activeSurfaceTab === undefined
      ? undefined
      : projectLayout(activeSurfaceTab.layout);
  const surfacePaneIds = surfaceLayout === undefined ? [] : paneIds(surfaceLayout);
  const focusedPaneId = surfacePaneIds.includes(selectedPaneId ?? "")
    ? selectedPaneId
    : (surfacePaneIds[0] ?? null);

  async function run(next: Command, itemId?: string): Promise<CommandResponse | undefined> {
    try {
      const response = await command(next);
      setError(null);
      if (itemId !== undefined || response.result.itemId !== undefined) {
        setOpenedItemId(itemId ?? response.result.itemId ?? null);
      }
      return response;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (prompt !== null) {
        key.preventDefault();
        setPrompt(null);
      } else if (openedItemId !== null) {
        key.preventDefault();
        setOpenedItemId(null);
      }
      return;
    }
    if (prompt !== null) {
      return;
    }
    if (openedItemId !== null) {
      if (surface === undefined || activeSurfaceTab === undefined) {
        return;
      }
      let next: Command | undefined;
      if (key.name === "[" || key.name === "]") {
        const tab = adjacentTab(surfaceTabs, activeSurfaceTab.id, key.name === "[" ? -1 : 1);
        if (tab !== undefined) {
          next = { type: "surface.selectTab", surfaceId: surface.id, tabId: tab.id };
        }
      } else if (key.name === "t") {
        next = { type: "tab.create", surfaceId: surface.id, title: "Shell" };
      } else if ((key.name === "\\" || key.name === "-") && focusedPaneId !== null) {
        next = {
          type: "pane.split",
          paneId: focusedPaneId,
          direction: key.name === "\\" ? "vertical" : "horizontal",
        };
      } else if (key.name === "r" && focusedPaneId !== null) {
        const pane = snapshot?.panes.find(({ id }) => id === focusedPaneId);
        if (pane?.processStatus === "failed" || pane?.processStatus === "exited") {
          next = { type: "process.restart", paneId: focusedPaneId };
        }
      }
      if (next !== undefined) {
        key.preventDefault();
        key.stopPropagation();
        void run(next);
      }
      return;
    }
    if (key.name === "s") {
      setChooserRequested(true);
      return;
    }
    if (choosingSession) {
      return;
    }
    if (key.name === "up") {
      setSelectedIndex(Math.max(0, index - 1));
    } else if (key.name === "down" && entries.length > 0) {
      setSelectedIndex(Math.min(entries.length - 1, index + 1));
    } else if (key.name === "return" && selected?.node.kind === "item") {
      void run({ type: "surface.ensure", itemId: selected.node.id }, selected.node.id);
    } else if (key.name === "o" && selected?.node.kind === "project") {
      void run({ type: "surface.ensureHere", projectId: selected.node.id });
    } else {
      const kind = { w: "workspace", p: "project", i: "item" }[key.name] as CreateKind | undefined;
      if (kind !== undefined && canCreate(kind, selected)) {
        setPrompt(kind);
      }
    }
  });

  return (
    <box flexDirection="column" padding={1} width="100%" height="100%">
      <box justifyContent="space-between">
        <text>Work Craft</text>
        <text>{`Session: ${choosingSession ? "choose" : (activeSession?.name ?? "choose")}`}</text>
        <Badge variant={statusVariant(status)}>{status}</Badge>
      </box>
      {error === null ? null : <text fg="#EF4444">{error}</text>}
      {prompt !== null && (!choosingSession || prompt === "session") ? (
        <CreatePrompt
          kind={prompt}
          onSubmit={(name) => {
            const kind = prompt;
            const next = createCommand(kind, name, activeSession?.id, selected);
            setPrompt(null);
            if (next !== null) {
              void run(next).then((response) => {
                if (kind === "session" && response !== undefined) {
                  setActiveSessionId(response.result.id);
                  setChooserRequested(false);
                  setOpenedItemId(null);
                }
              });
            }
          }}
        />
      ) : snapshot === null ? (
        <text>Connecting to daemon...</text>
      ) : choosingSession ? (
        <SessionChooser
          sessions={sessions}
          onSelect={(sessionId) => {
            setActiveSessionId(sessionId);
            setChooserRequested(false);
            setPrompt(null);
            setOpenedItemId(null);
          }}
          onCreate={() => setPrompt("session")}
        />
      ) : openedItemId !== null ? (
        surface === undefined ? (
          <text>Opening surface...</text>
        ) : (
          <box flexDirection="column" flexGrow={1}>
            <text>
              {surfaceTabs
                .map(
                  (tab) =>
                    `${tab.id === activeSurfaceTab?.id ? "[" : " "}${tab.title}${tab.id === activeSurfaceTab?.id ? "]" : " "}`,
                )
                .join(" ")}
            </text>
            <SurfaceView
              focusedPaneId={focusedPaneId}
              snapshot={snapshot}
              stream={stream}
              surface={surface}
              terminals={terminals}
              undersized={false}
              workbenchFocused={true}
              onFocusPane={setSelectedPaneId}
              onTerminalReady={() => {}}
            />
          </box>
        )
      ) : (
        <NavigationPane entries={entries} selectedIndex={index} />
      )}
    </box>
  );
}

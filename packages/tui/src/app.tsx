import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { CategoryKind, Command } from "@work-craft/server/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { CreatePrompt, type CreateKind } from "./create-prompt.tsx";
import {
  buildNavigation,
  flattenNavigation,
  type NavigationEntry,
  type NavigationNode,
} from "./navigation.ts";
import { NavigationPane } from "./navigation-pane.tsx";
import { SurfaceView } from "./surface-view.tsx";
import { useWorkCraft } from "./use-work-craft.ts";

function ancestor(
  entry: NavigationEntry | undefined,
  kind: NavigationNode["kind"],
): NavigationNode | undefined {
  return entry?.path.findLast((node) => node.kind === kind);
}

function createCommand(kind: CreateKind, name: string, entry?: NavigationEntry): Command | null {
  const session = ancestor(entry, "session");
  const workspace = ancestor(entry, "workspace");
  const category = ancestor(entry, "category");
  const project = ancestor(entry, "project");
  switch (kind) {
    case "session":
      return { type: "session.create", name };
    case "workspace":
      return session === undefined
        ? null
        : { type: "workspace.create", sessionId: session.id, name };
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
  if (kind === "session") {
    return true;
  }
  const required = kind === "workspace" ? "session" : kind === "project" ? "category" : "project";
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
  const entries = snapshot === null ? [] : flattenNavigation(buildNavigation(snapshot));
  const index = Math.max(0, Math.min(selectedIndex, entries.length - 1));
  const selected = entries[index];

  async function run(next: Command, itemId?: string): Promise<void> {
    try {
      const response = await command(next);
      setError(null);
      if (itemId !== undefined || response.result.itemId !== undefined) {
        setOpenedItemId(itemId ?? response.result.itemId ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
    if (prompt !== null || openedItemId !== null) {
      return;
    }
    if (key.name === "up") {
      setSelectedIndex(Math.max(0, index - 1));
    } else if (key.name === "down" && entries.length > 0) {
      setSelectedIndex(Math.min(entries.length - 1, index + 1));
    } else if (key.name === "return" && selected?.node.kind === "item") {
      void run({ type: "surface.open", itemId: selected.node.id }, selected.node.id);
    } else if (key.name === "o" && selected?.node.kind === "project") {
      void run({ type: "surface.openHere", projectId: selected.node.id });
    } else {
      const kind = { s: "session", w: "workspace", p: "project", i: "item" }[key.name] as
        | CreateKind
        | undefined;
      if (kind !== undefined && canCreate(kind, selected)) {
        setPrompt(kind);
      }
    }
  });

  const surface = snapshot?.surfaces.find((value) => value.itemId === openedItemId);
  return (
    <box flexDirection="column" padding={1} width="100%" height="100%">
      <box justifyContent="space-between">
        <text>Work Craft</text>
        <Badge variant={statusVariant(status)}>{status}</Badge>
      </box>
      {error === null ? null : <text fg="#EF4444">{error}</text>}
      {prompt !== null ? (
        <CreatePrompt
          kind={prompt}
          onSubmit={(name) => {
            const next = createCommand(prompt, name, selected);
            setPrompt(null);
            if (next !== null) {
              void run(next);
            }
          }}
        />
      ) : openedItemId !== null ? (
        snapshot === null || surface === undefined ? (
          <text>Opening surface...</text>
        ) : (
          <SurfaceView
            controlsEnabled={prompt === null}
            snapshot={snapshot}
            stream={stream}
            surface={surface}
            terminals={terminals}
            onCommand={(next) => void run(next)}
          />
        )
      ) : snapshot === null ? (
        <text>Connecting to daemon...</text>
      ) : (
        <NavigationPane entries={entries} selectedIndex={index} />
      )}
    </box>
  );
}

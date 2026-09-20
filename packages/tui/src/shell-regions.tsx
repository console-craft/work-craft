import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import type { CommandHint, StatusMode } from "./command-router.ts";
import { ellipsize } from "./shell-layout.ts";
import type { ConnectionStatus } from "./use-work-craft.ts";

export type WorkspaceStripProps = {
  workspaces: readonly { id: string; name: string }[];
  visibleIds: readonly string[];
  activeId: string | null;
  cursorId: string | null;
  focused: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  width: number;
  onActivate(id: string): void;
  onFocus(id: string): void;
};

export function WorkspaceStrip({
  activeId,
  cursorId,
  focused,
  hasNext,
  hasPrevious,
  visibleIds,
  width,
  workspaces,
  onActivate,
  onFocus,
}: WorkspaceStripProps) {
  return (
    <box id="region:workspace" flexDirection="row" width={width} overflow="hidden">
      {hasPrevious ? <text>{"<"}</text> : null}
      {visibleIds.map((id) => {
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (workspace === undefined) {
          return null;
        }
        const cursor = focused && id === cursorId;
        const active = id === activeId;
        const label =
          visibleIds.length === 1
            ? ellipsize(workspace.name, width - Number(hasPrevious) - Number(hasNext) - 3)
            : workspace.name;
        return (
          <text
            id={`workspace:${id}`}
            key={id}
            fg={cursor ? "#FFFFFF" : active ? "#60A5FA" : "#9CA3AF"}
            onMouseDown={() => {
              onFocus(id);
              onActivate(id);
            }}
          >
            {` ${cursor ? ">" : active ? "*" : " "}${label} `}
          </text>
        );
      })}
      {hasNext ? <text>{">"}</text> : null}
    </box>
  );
}

const CATEGORY_ICONS: Record<CategoryKind, string> = {
  inbox: "I",
  today: "T",
  design: "D",
  implementation: "M",
  collaboration: "C",
  operations: "O",
};

export type CategoryRailProps = {
  categories: Snapshot["categories"];
  active: CategoryKind;
  cursor: CategoryKind;
  focused: boolean;
  onActivate(kind: CategoryKind): void;
  onFocus(kind: CategoryKind): void;
};

export function CategoryRail({
  active,
  categories,
  cursor,
  focused,
  onActivate,
  onFocus,
}: CategoryRailProps) {
  return (
    <box id="region:category" flexDirection="column" width={5}>
      {categories.map((category) => {
        const selected = focused && category.kind === cursor;
        return (
          <text
            id={`category:${category.kind}`}
            key={category.kind}
            fg={selected ? "#FFFFFF" : category.kind === active ? "#60A5FA" : "#9CA3AF"}
            onMouseDown={() => {
              onFocus(category.kind);
              onActivate(category.kind);
            }}
          >
            {`${selected ? ">" : category.kind === active ? "*" : " "} ${CATEGORY_ICONS[category.kind]}`}
          </text>
        );
      })}
    </box>
  );
}

export type TabStripProps = {
  tabs: Snapshot["tabs"];
  activeId: string | null;
  cursorId: string | null;
  focused: boolean;
  error: string | null;
  onActivate(id: string): void;
  onFocus(id: string): void;
};

export function TabStrip({
  activeId,
  cursorId,
  error,
  focused,
  tabs,
  onActivate,
  onFocus,
}: TabStripProps) {
  return (
    <box id="region:tabs" flexDirection="row" height={1} overflow="hidden">
      {tabs.map((tab) => {
        const cursor = focused && tab.id === cursorId;
        return (
          <text
            id={`tab:${tab.id}`}
            key={tab.id}
            fg={cursor ? "#FFFFFF" : tab.id === activeId ? "#60A5FA" : "#9CA3AF"}
            onMouseDown={() => {
              onFocus(tab.id);
              onActivate(tab.id);
            }}
          >
            {` ${cursor ? ">" : tab.id === activeId ? "*" : " "}${tab.title} `}
          </text>
        );
      })}
      {error === null ? null : (
        <text id="tab-error" fg="#EF4444">
          {` ${error}`}
        </text>
      )}
    </box>
  );
}

const CONNECTION_COLORS: Record<ConnectionStatus, string> = {
  connected: "#22C55E",
  connecting: "#EAB308",
  disconnected: "#EF4444",
};

export type SessionSwitcherProps = {
  name: string | null;
  status: ConnectionStatus;
  focused: boolean;
  width: number;
  onOpen(): void;
};

export function SessionSwitcher({ focused, name, status, width, onOpen }: SessionSwitcherProps) {
  const label = ellipsize(name ?? "choose", width - 12);
  return (
    <box id="region:session" flexDirection="row" flexShrink={0} width={width} onMouseDown={onOpen}>
      <text fg={focused ? "#FFFFFF" : "#9CA3AF"}>{` Session: ${label} `}</text>
      <text id="connection-status" fg={CONNECTION_COLORS[status]}>
        ●
      </text>
    </box>
  );
}

export type StatusBarProps =
  | { mode: "HINTS" | "LEADER" | "ERROR"; hints: readonly CommandHint[]; text?: string }
  | { mode: "INFO"; text: string; hints?: never };

export function StatusBar(props: StatusBarProps) {
  const content =
    props.mode === "INFO"
      ? props.text
      : (props.text ?? props.hints.map(({ keys, label }) => `${keys} ${label}`).join("  "));
  return (
    <box id="status" height={1} flexDirection="row">
      <text
        fg={props.mode === "ERROR" ? "#EF4444" : props.mode === "LEADER" ? "#EAB308" : "#60A5FA"}
      >{`${props.mode}  `}</text>
      <text>{content}</text>
    </box>
  );
}

export function statusModeFor(leaderActive: boolean, compactNavigatorFocused: boolean): StatusMode {
  return leaderActive ? "LEADER" : compactNavigatorFocused ? "INFO" : "HINTS";
}

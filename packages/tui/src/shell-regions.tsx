import type { CategoryKind, Snapshot } from "@work-craft/server/client";
import { Badge } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import type { CommandHint, StatusMode } from "./input/command-router.ts";
import { ellipsize } from "./shell-layout.ts";
import type { ConnectionStatus } from "./client/use-work-craft.ts";

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
  const theme = useTheme();
  return (
    <Box id="region:workspace" flexDirection="row" width={width} overflow="hidden">
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
            fg={
              cursor
                ? theme.colors.foreground
                : active
                  ? theme.colors.primary
                  : theme.colors.mutedForeground
            }
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
    </Box>
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
  const theme = useTheme();
  return (
    <Box id="region:category" flexDirection="column" width={5}>
      {categories.map((category) => {
        const selected = focused && category.kind === cursor;
        return (
          <text
            id={`category:${category.kind}`}
            key={category.kind}
            fg={
              selected
                ? theme.colors.foreground
                : category.kind === active
                  ? theme.colors.primary
                  : theme.colors.mutedForeground
            }
            onMouseDown={() => {
              onFocus(category.kind);
              onActivate(category.kind);
            }}
          >
            {`${selected ? ">" : category.kind === active ? "*" : " "} ${CATEGORY_ICONS[category.kind]}`}
          </text>
        );
      })}
    </Box>
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
  const theme = useTheme();
  return (
    <Box id="region:tabs" flexDirection="row" height={1}>
      <Box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden">
        {tabs.map((tab) => {
          const cursor = focused && tab.id === cursorId;
          return (
            <text
              id={`tab:${tab.id}`}
              key={tab.id}
              fg={
                cursor
                  ? theme.colors.foreground
                  : tab.id === activeId
                    ? theme.colors.primary
                    : theme.colors.mutedForeground
              }
              onMouseDown={() => {
                onFocus(tab.id);
                onActivate(tab.id);
              }}
            >
              {` ${cursor ? ">" : tab.id === activeId ? "*" : " "}${tab.title} `}
            </text>
          );
        })}
      </Box>
      {error === null ? null : (
        <text id="tab-error" flexShrink={0} fg={theme.colors.error}>
          {` ${error}`}
        </text>
      )}
    </Box>
  );
}

export type SessionSwitcherProps = {
  name: string | null;
  status: ConnectionStatus;
  focused: boolean;
  width: number;
  onOpen(): void;
};

export function SessionSwitcher({ focused, name, status, width, onOpen }: SessionSwitcherProps) {
  const theme = useTheme();
  const label = ellipsize(name ?? "choose", width - 12);
  const statusColor: Record<ConnectionStatus, string> = {
    connected: theme.colors.success,
    connecting: theme.colors.warning,
    disconnected: theme.colors.error,
  };
  return (
    <Box id="region:session" flexDirection="row" flexShrink={0} width={width} onMouseDown={onOpen}>
      <text fg={focused ? theme.colors.foreground : theme.colors.mutedForeground}>
        {` Session: ${label} `}
      </text>
      <text id="connection-status" fg={statusColor[status]}>
        ●
      </text>
    </Box>
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
    <Box id="status" height={1} flexDirection="row">
      <Badge
        bordered={false}
        variant={
          props.mode === "ERROR"
            ? "error"
            : props.mode === "LEADER"
              ? "warning"
              : props.mode === "INFO"
                ? "info"
                : "default"
        }
      >
        {`${props.mode}  `}
      </Badge>
      <text>{content}</text>
    </Box>
  );
}

export function statusModeFor(leaderActive: boolean, compactNavigatorFocused: boolean): StatusMode {
  return leaderActive ? "LEADER" : compactNavigatorFocused ? "INFO" : "HINTS";
}

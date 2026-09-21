import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import { ellipsize } from "./layout.ts";

export type WorkspaceBarProps = {
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

export function WorkspaceBar({
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
}: WorkspaceBarProps): ReactNode {
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

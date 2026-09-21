import type { Snapshot } from "@work-craft/server/client";
import { Box } from "@/components/ui/box";
import { Panel } from "@/components/ui/panel";
import { useTheme } from "@/hooks/use-theme";

export type SessionChooserProps = {
  sessions: Snapshot["sessions"];
  cursorId: string | null;
  onFocus(sessionId: string): void;
  onSelect(sessionId: string): void;
  onCreate(): void;
};

export function SessionChooser({
  cursorId,
  sessions,
  onFocus,
  onSelect,
  onCreate,
}: SessionChooserProps) {
  const theme = useTheme();
  const ordered = [...sessions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return (
    <Panel title="Sessions">
      <Box flexDirection="column">
        {ordered.length === 0 ? (
          <text>No sessions. Press n to create one.</text>
        ) : (
          <>
            {ordered.map((session) => (
              <text
                id={`session:${session.id}`}
                key={session.id}
                fg={
                  session.id === cursorId ? theme.colors.foreground : theme.colors.mutedForeground
                }
                onMouseDown={() => {
                  onFocus(session.id);
                  onSelect(session.id);
                }}
              >
                {`${session.id === cursorId ? ">" : " "} ${session.name}`}
              </text>
            ))}
            <text id="session:create" onMouseDown={onCreate}>
              n: new session
            </text>
          </>
        )}
      </Box>
    </Panel>
  );
}

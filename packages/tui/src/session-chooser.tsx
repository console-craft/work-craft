import type { Snapshot } from "@work-craft/server/client";
import { Panel } from "@/components/ui/panel";

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
  const ordered = [...sessions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return (
    <Panel title="Sessions">
      <box flexDirection="column">
        {ordered.length === 0 ? (
          <text>No sessions. Press n to create one.</text>
        ) : (
          <>
            {ordered.map((session) => (
              <text
                id={`session:${session.id}`}
                key={session.id}
                fg={session.id === cursorId ? "#FFFFFF" : "#9CA3AF"}
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
      </box>
    </Panel>
  );
}

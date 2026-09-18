import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { Snapshot } from "@work-craft/server/client";
import { Panel } from "@/components/ui/panel";

export type SessionChooserProps = {
  sessions: Snapshot["sessions"];
  onSelect(sessionId: string): void;
  onCreate(): void;
};

export function SessionChooser({ sessions, onSelect, onCreate }: SessionChooserProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ordered = [...sessions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const index = Math.max(0, Math.min(selectedIndex, ordered.length - 1));

  useKeyboard((key) => {
    if (key.name === "up") {
      setSelectedIndex(Math.max(0, index - 1));
    } else if (key.name === "down" && ordered.length > 0) {
      setSelectedIndex(Math.min(ordered.length - 1, index + 1));
    } else if (key.name === "return" && ordered[index] !== undefined) {
      onSelect(ordered[index].id);
    } else if (key.name === "n") {
      onCreate();
    }
  });

  return (
    <Panel title="Sessions">
      <box flexDirection="column">
        {ordered.length === 0 ? (
          <text>No sessions. Press n to create one.</text>
        ) : (
          <>
            {ordered.map((session, sessionIndex) => (
              <text key={session.id} fg={sessionIndex === index ? "#FFFFFF" : "#9CA3AF"}>
                {`${sessionIndex === index ? ">" : " "} ${session.name}`}
              </text>
            ))}
            <text>n: new session</text>
          </>
        )}
      </box>
    </Panel>
  );
}

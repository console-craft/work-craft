import { MouseButton, type MouseEvent, type SelectRenderable } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";

import { Button } from "@/ui/controls/button.tsx";
import { Select } from "@/ui/controls/select.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import { Divider } from "@/ui/primitives/divider.tsx";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

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

  function handleMouseDown(this: SelectRenderable, event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT || event.defaultPrevented) {
      return;
    }
    // ponytail: mirror OpenTUI's centered one-line viewport until Select exposes
    // public row hit-testing; descriptions and item spacing must stay disabled.
    const rows = Math.max(1, this.height);
    const offset = Math.max(
      0,
      Math.min(this.getSelectedIndex() - Math.floor(rows / 2), ordered.length - rows),
    );
    const session = ordered[offset + event.y - this.screenY];
    if (session !== undefined) {
      onFocus(session.id);
      onSelect(session.id);
    }
  }

  return (
    <Box border width="100%" height="100%">
      <Box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <Text fg={theme.colors.primary}>
          <b>Sessions</b>
        </Text>
      </Box>
      <Divider />
      <Box paddingLeft={1} paddingRight={1} flexGrow={1} minHeight={0}>
        {ordered.length === 0 ? (
          <Text>No sessions. Press n to create one.</Text>
        ) : (
          <Stack height="95%">
            <Select
              id="session:list"
              focused
              flexGrow={1}
              minHeight={0}
              showDescription={false}
              showScrollIndicator
              options={ordered.map(({ id, name }) => ({ name, description: "", value: id }))}
              selectedIndex={Math.max(
                0,
                ordered.findIndex(({ id }) => id === cursorId),
              )}
              onChange={(index) => {
                const session = ordered[index];
                if (session !== undefined) {
                  onFocus(session.id);
                }
              }}
              onSelect={(index) => {
                const session = ordered[index];
                if (session !== undefined) {
                  onSelect(session.id);
                }
              }}
              onMouseDown={handleMouseDown}
            />
            <Button
              id="session:create"
              variant="primary"
              alignSelf="flex-start"
              paddingX={1}
              flexShrink={0}
              onPress={onCreate}
            >
              New session
            </Button>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

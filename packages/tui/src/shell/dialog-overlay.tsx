import { type MouseEvent, parseColor, RGBA } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";

import { CreatePrompt } from "@/shell/create-prompt.tsx";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import type { DialogState } from "@/shell/state.ts";
import { Box } from "@/ui/primitives/box.tsx";
import { Center } from "@/ui/primitives/center.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

export type DialogOverlayProps = {
  dialog: Exclude<DialogState, null>;
  width: number;
  height: number;
  sessions: Snapshot["sessions"];
  sessionCursorId: string | null;
  promptValue: string;
  error: string | null;
  onCreateSession(): void;
  onFocusSession(id: string): void;
  onSelectSession(id: string): void;
  onPromptChange(value: string): void;
  onPromptSubmit(value: string): void;
};

export function DialogOverlay({
  dialog,
  error,
  height,
  promptValue,
  sessionCursorId,
  sessions,
  width,
  onCreateSession,
  onFocusSession,
  onPromptChange,
  onPromptSubmit,
  onSelectSession,
}: DialogOverlayProps): ReactNode {
  const theme = useTheme();
  const overlayColor = RGBA.clone(parseColor(theme.colors.background));
  overlayColor.a = 0.5;

  return (
    <Center
      id="dialog-overlay"
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={1}
      bg={overlayColor}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Box id="dialog" flexDirection="row" width="60%" height="60%" bg="background">
        {dialog.kind === "sessions" ? (
          <SessionChooser
            cursorId={sessionCursorId}
            sessions={sessions}
            onCreate={onCreateSession}
            onFocus={onFocusSession}
            onSelect={onSelectSession}
          />
        ) : (
          <CreatePrompt
            error={error}
            kind={dialog.createKind}
            value={promptValue}
            onChange={onPromptChange}
            onSubmit={onPromptSubmit}
          />
        )}
      </Box>
    </Center>
  );
}

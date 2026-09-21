import { RGBA, type MouseEvent } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";
import { Box } from "@/components/ui/box";
import { useTheme } from "@/hooks/use-theme";
import { CreatePrompt } from "./create-prompt.tsx";
import { SessionChooser } from "./session-chooser.tsx";
import type { DialogState } from "./state.ts";

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
  const overlayColor = RGBA.fromHex(theme.colors.background);
  overlayColor.a = 0.5;

  return (
    <Box
      id="dialog-overlay"
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={1}
      backgroundColor={overlayColor}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Box
        id="dialog"
        position="absolute"
        left="20%"
        top="20%"
        width="60%"
        height="60%"
        backgroundColor={theme.colors.background}
      >
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
    </Box>
  );
}

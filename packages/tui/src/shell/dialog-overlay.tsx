import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";

import { ArchivePrompt } from "@/shell/archive-prompt.tsx";
import { CreatePrompt } from "@/shell/create-prompt.tsx";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import type { DialogState } from "@/shell/state.ts";
import { Dialog, DialogContent } from "@/ui/components/dialog";

export type DialogOverlayProps = {
  dialog: Exclude<DialogState, null>;
  canCancel: boolean;
  sessions: Snapshot["sessions"];
  promptValue: string;
  error: string | null;
  onCreateSession(): void;
  onCancel(): void;
  onSelectSession(id: string): void;
  onPromptChange(value: string): void;
  onPromptSubmit(value: string): void;
  onArchive?(): void;
  visible?: boolean;
  canRestoreFocus?(): boolean;
};

export function DialogOverlay({
  dialog,
  error,
  canCancel,
  promptValue,
  sessions,
  onCreateSession,
  onCancel,
  onPromptChange,
  onPromptSubmit,
  onSelectSession,
  onArchive,
  visible = true,
  canRestoreFocus,
}: DialogOverlayProps): ReactNode {
  return (
    <Dialog
      open
      closeOnBackdropClick={canCancel}
      onOpenChange={(open) => {
        if (!open && canCancel) {
          onCancel();
        }
      }}
    >
      <DialogContent
        canRestoreFocus={canRestoreFocus}
        visible={visible}
        id="dialog"
        overlayMargins={{ bottom: 1 }}
        key={dialog.kind === "create" ? `create:${dialog.createKind}` : dialog.kind}
        maxHeight="100%"
        initialFocusId={
          dialog.kind === "sessions"
            ? sessions.length === 0
              ? "session:create"
              : "session:search"
            : dialog.kind === "archive"
              ? "archive:confirm"
              : dialog.createKind === "directory"
                ? "create:path"
                : dialog.createKind.startsWith("generic-")
                  ? "create:title"
                  : "create:name"
        }
        width="50%"
        minWidth={80}
        maxWidth={100}
      >
        {dialog.kind === "sessions" ? (
          <SessionChooser
            canCancel={canCancel}
            sessions={sessions}
            onCreate={onCreateSession}
            onSelect={onSelectSession}
          />
        ) : dialog.kind === "archive" ? (
          <ArchivePrompt title={dialog.title} path={dialog.path} onConfirm={() => onArchive?.()} />
        ) : (
          <CreatePrompt
            error={error}
            kind={dialog.createKind}
            value={promptValue}
            onChange={onPromptChange}
            onSubmit={onPromptSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

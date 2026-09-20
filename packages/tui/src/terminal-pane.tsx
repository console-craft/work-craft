import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import { useEffect, useRef } from "react";
import type { TerminalBuffer } from "./use-work-craft.ts";

export type TerminalPaneProps = {
  buffer: TerminalBuffer | undefined;
  focused: boolean;
  pane: Snapshot["panes"][number];
  resizeEnabled: boolean;
  stream: StreamConnection | null;
  onFocus(): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
};

export function TerminalPane({
  buffer,
  focused,
  pane,
  resizeEnabled,
  stream,
  onFocus,
  onTerminalReady,
}: TerminalPaneProps) {
  const terminal = useRef<EmbeddedTerminalRenderable>(null);
  const rendered = useRef({ paneId: "", epoch: "", cursor: 0 });

  useEffect(() => {
    const target = terminal.current;
    if (target === null || buffer === undefined) {
      return;
    }
    if (rendered.current.paneId !== pane.id || rendered.current.epoch !== buffer.epoch) {
      target.write(buffer.history);
      rendered.current = {
        paneId: pane.id,
        epoch: buffer.epoch,
        cursor: buffer.historyCursor,
      };
    }
    for (const chunk of buffer.chunks) {
      if (chunk.cursor > rendered.current.cursor) {
        target.write(chunk.data);
        rendered.current.cursor = chunk.cursor;
      }
    }
  }, [buffer, pane.id]);

  useEffect(() => {
    if (focused) {
      terminal.current?.focus();
    } else {
      terminal.current?.blur();
    }
  }, [focused]);

  useEffect(() => {
    onTerminalReady(pane.id, terminal.current);
    return () => onTerminalReady(pane.id, null);
  }, [onTerminalReady, pane.id]);

  const showStatus = pane.processStatus === "failed" || pane.processStatus === "interrupted";
  return (
    <box flexDirection="column" width="100%" height="100%">
      {showStatus ? (
        <text fg="#EF4444">
          {pane.processStatus}
          {pane.errorText === null ? "" : `: ${pane.errorText}`}
        </text>
      ) : null}
      <terminal
        id={`terminal:${pane.id}`}
        ref={terminal}
        flexGrow={1}
        width="100%"
        onData={(data) => stream?.sendInput(pane.id, data)}
        onMouseDown={() => {
          onFocus();
          terminal.current?.focus();
        }}
        onTerminalResize={(cols, rows) => {
          if (resizeEnabled && cols >= 20 && rows >= 5) {
            stream?.resize(pane.id, cols, rows);
          }
        }}
      />
    </box>
  );
}

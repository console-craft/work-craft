import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import { useEffect, useRef } from "react";
import type { TerminalBuffer } from "./use-work-craft.ts";

export type TerminalPaneProps = {
  active: boolean;
  buffer: TerminalBuffer | undefined;
  pane: Snapshot["panes"][number];
  stream: StreamConnection | null;
  onActivate(): void;
};

export function TerminalPane({ active, buffer, pane, stream, onActivate }: TerminalPaneProps) {
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
    if (active) {
      terminal.current?.focus();
    }
  }, [active]);

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
        ref={terminal}
        flexGrow={1}
        width="100%"
        onData={(data) => stream?.sendInput(pane.id, data)}
        onMouseDown={() => {
          onActivate();
          terminal.current?.focus();
        }}
        onTerminalResize={(cols, rows) => {
          if (Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0) {
            stream?.resize(pane.id, cols, rows);
          }
        }}
      />
    </box>
  );
}

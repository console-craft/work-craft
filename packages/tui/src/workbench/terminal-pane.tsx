import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { Snapshot, StreamConnection } from "@work-craft/server/client";
import { useEffect, useLayoutEffect, useRef } from "react";

import type { TerminalBuffer } from "@/client/use-work-craft.ts";
import { Alert, AlertContent, AlertTitle } from "@/ui/components/alert.tsx";
import { Button } from "@/ui/controls/button.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import {
  PANE_ALERT_HEIGHT,
  PANE_RECOVERY_HEIGHT,
  PANE_TOP_BORDER_HEIGHT,
  type PaneRect,
  terminalRect,
} from "@/workbench/layout.ts";
import { paneNotice } from "@/workbench/pane-state.ts";

export type TerminalPaneProps = {
  bounds: PaneRect;
  connected: boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  canReactivate(paneId: string): boolean;
  onReactivatePane(paneId: string): void;
  buffer: TerminalBuffer | undefined;
  focused: boolean;
  pane: Snapshot["panes"][number];
  resizeEnabled: boolean;
  stream: StreamConnection | null;
  inputEnabled?: boolean;
  canReceiveInput?(paneId?: string): boolean;
  canResize?(): boolean;
  onFocus(): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
};

export function TerminalPane({
  bounds,
  connected,
  reactivatingPaneIds,
  canReactivate,
  onReactivatePane,
  buffer,
  focused,
  pane,
  resizeEnabled,
  stream,
  onFocus,
  onTerminalReady,
  inputEnabled = true,
  canReceiveInput = () => true,
  canResize = () => true,
}: TerminalPaneProps) {
  const notice = paneNotice(pane.processStatus, connected);
  const viewport = terminalRect(bounds, notice !== null);
  const terminal = useRef<EmbeddedTerminalRenderable>(null);
  const resizePending = useRef(false);
  const rendered = useRef({ paneId: "", epoch: "", cursor: 0 });
  const running = pane.processStatus === "running";
  function acceptsInput(): boolean {
    return (
      connected &&
      running &&
      inputEnabled &&
      viewport.width >= 20 &&
      viewport.height >= 5 &&
      canReceiveInput(pane.id)
    );
  }
  function acceptsReactivation(): boolean {
    return (
      connected &&
      !reactivatingPaneIds.has(pane.id) &&
      bounds.width >= 20 &&
      bounds.height >= PANE_RECOVERY_HEIGHT &&
      canReactivate(pane.id)
    );
  }

  function resizeTerminal(cols: number, rows: number): void {
    resizePending.current = true;
    if (acceptsInput() && resizeEnabled && canResize() && stream && cols >= 20 && rows >= 5) {
      stream.resize(pane.id, cols, rows);
      resizePending.current = false;
    }
  }

  useLayoutEffect(() => {
    // Uncovering a retained terminal does not emit another native resize event.
    if (resizePending.current && terminal.current) {
      resizeTerminal(terminal.current.width, terminal.current.height);
    }
  });

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

  useLayoutEffect(() => {
    const eligible = acceptsInput();
    // OpenTUI's blur is a no-op after focusable becomes false.
    if (!focused || !eligible) {
      terminal.current?.blur();
    }
    if (terminal.current) {
      terminal.current.focusable = eligible;
    }
    if (focused && eligible) {
      terminal.current?.focus();
    }
  }, [focused, connected, inputEnabled, running, canReceiveInput]);

  useEffect(() => {
    onTerminalReady(pane.id, terminal.current);
    return () => onTerminalReady(pane.id, null);
  }, [onTerminalReady, pane.id]);

  return (
    <Box
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
      borderColor={focused ? "primary" : notice ? "warning" : "mutedForeground"}
      borderStyle="double"
      border={["top"]}
    >
      {/* Native creation needs nonzero emulator dimensions before the host is measured. */}
      <terminal
        id={`terminal:${pane.id}`}
        ref={terminal}
        cols={80}
        rows={24}
        height={viewport.height}
        flexShrink={0}
        minHeight={0}
        width="100%"
        visible={viewport.width > 0 && viewport.height > 0}
        transparentBackground
        onData={(data) => {
          if (acceptsInput()) {
            stream?.sendInput(pane.id, data);
          }
        }}
        onMouseDown={() => {
          onFocus();
          if (acceptsInput()) {
            terminal.current?.focus();
          }
        }}
        onTerminalResize={resizeTerminal}
      />
      {notice !== null ? (
        <Alert
          id={`pane-alert:${pane.id}`}
          status={notice.status}
          height={PANE_ALERT_HEIGHT}
          visible={bounds.width >= 4 && bounds.height >= PANE_TOP_BORDER_HEIGHT + 2}
          maxHeight={Math.max(0, bounds.height - PANE_TOP_BORDER_HEIGHT)}
          width="100%"
          minWidth={0}
          flexShrink={0}
          overflow="hidden"
        >
          <AlertContent minWidth={0} height={1} overflow="hidden">
            <Box flexDirection="row" width="100%" height={1} gap={1} minWidth={0}>
              <AlertTitle
                height={1}
                minWidth={0}
                flexGrow={1}
                flexShrink={1}
                wrapMode="none"
                overflow="hidden"
              >
                {notice.title}
              </AlertTitle>
              {notice.reactivate ? (
                <Button
                  variant="secondary"
                  fg="background"
                  bg="warning"
                  id={`reactivate:${pane.id}`}
                  height={1}
                  width={12}
                  flexShrink={0}
                  disabled={!acceptsReactivation()}
                  onPress={() => {
                    if (acceptsReactivation()) {
                      onReactivatePane(pane.id);
                    }
                  }}
                >
                  Reactivate
                </Button>
              ) : null}
            </Box>
          </AlertContent>
        </Alert>
      ) : null}
    </Box>
  );
}

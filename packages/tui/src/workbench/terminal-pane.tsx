import type { EmbeddedTerminalRenderable } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import type {
  InputStamp,
  PaneRect,
  Snapshot,
  StreamConnection,
  TerminalInputContext,
  TerminalSize,
} from "@work-craft/server/client";
import { useCallback } from "react";

import type { PaneOutput } from "@/client/terminal-output";
import { Alert, AlertContent, AlertTitle } from "@/ui/components/alert.tsx";
import { Button } from "@/ui/controls/button.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import {
  hasRecoveryViewport,
  hasTerminalViewport,
  PANE_ALERT_HEIGHT,
  PANE_TOP_BORDER_HEIGHT,
  terminalRect,
} from "@/workbench/layout.ts";
import { paneNotice } from "@/workbench/pane-state.ts";
import { TerminalViewport } from "@/workbench/terminal-viewport";

export type TerminalPaneProps = {
  bounds: PaneRect;
  connected: boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  canReactivate(paneId: string): boolean;
  onReactivatePane(paneId: string): void;
  output: PaneOutput;
  focused: boolean;
  pane: Snapshot["panes"][number];
  size: TerminalSize;
  stamp: InputStamp | null;
  canRespond(paneId: string, stamp: InputStamp): boolean;
  inputEvent(): Pick<
    Extract<TerminalInputContext, { source: "input" }>,
    "kind" | "activitySequence"
  >;
  onMouseInput(event: MouseEvent): void;
  onResync(): void;
  stream: StreamConnection | null;
  inputEnabled?: boolean;
  canReceiveInput?(paneId?: string): boolean;
  onFocus(): void;
  onTerminalReady(paneId: string, terminal: EmbeddedTerminalRenderable | null): void;
};

export function TerminalPane({
  bounds,
  connected,
  reactivatingPaneIds,
  canReactivate,
  onReactivatePane,
  output,
  focused,
  pane,
  size,
  stamp,
  canRespond,
  inputEvent,
  onMouseInput,
  onResync,
  stream,
  onFocus,
  onTerminalReady,
  inputEnabled = true,
  canReceiveInput = () => true,
}: TerminalPaneProps) {
  const notice = paneNotice(pane.processStatus, connected);
  const viewport = terminalRect(bounds, notice !== null);
  const reportReady = useCallback(
    (node: EmbeddedTerminalRenderable | null) => onTerminalReady(pane.id, node),
    [pane.id, onTerminalReady],
  );
  const running = pane.processStatus === "running";
  function acceptsInput(): boolean {
    return (
      connected &&
      running &&
      inputEnabled &&
      hasTerminalViewport(viewport) &&
      canReceiveInput(pane.id)
    );
  }
  function acceptsReactivation(): boolean {
    return (
      connected &&
      !reactivatingPaneIds.has(pane.id) &&
      hasRecoveryViewport(bounds) &&
      canReactivate(pane.id)
    );
  }

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
      <Box height={viewport.height} width="100%" flexShrink={0} minHeight={0} overflow="hidden">
        <TerminalViewport
          paneId={pane.id}
          output={output}
          size={size}
          focused={focused}
          inputEnabled={inputEnabled}
          canInput={acceptsInput}
          canRespond={(stamp) => connected && running && canRespond(pane.id, stamp)}
          onReady={reportReady}
          onFocus={onFocus}
          onMouseInput={onMouseInput}
          onResync={onResync}
          onData={(bytes, source, responseStamp) => {
            if (!stamp || !stream) {
              return;
            }
            if (source === "response") {
              if (responseStamp && canRespond(pane.id, responseStamp)) {
                stream.sendInput(pane.id, bytes, { ...responseStamp, source });
              }
            } else if (acceptsInput()) {
              stream.sendInput(pane.id, bytes, { ...stamp, source, ...inputEvent() });
            }
          }}
        />
      </Box>
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

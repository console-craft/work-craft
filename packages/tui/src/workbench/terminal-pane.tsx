import type { Renderable } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import type {
  InputStamp,
  PaneRect,
  Snapshot,
  StreamConnection,
  TerminalInputContext,
  TerminalSize,
} from "@work-craft/server/client";
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { TerminalBuffer } from "@/client/terminal-buffer";
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
  preservePresentation?: boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  canReactivate(paneId: string): boolean;
  onReactivatePane(paneId: string): void;
  output: PaneOutput;
  runtimeIdentity?: { epoch: string; runtimeGeneration: number };
  focused: boolean;
  pane: Snapshot["panes"][number];
  size: TerminalSize;
  stamp: InputStamp | null;
  inputEvent(): Pick<
    Extract<TerminalInputContext, { source: "input" }>,
    "kind" | "activitySequence"
  >;
  onMouseInput(event: MouseEvent): void;
  onError?(message: string): void;
  stream: StreamConnection | null;
  inputEnabled?: boolean;
  canReceiveInput?(paneId?: string): boolean;
  onFocus(): void;
  onTerminalReady(paneId: string, terminal: Renderable | null): void;
};

export function TerminalPane({
  bounds,
  connected,
  preservePresentation = false,
  reactivatingPaneIds,
  canReactivate,
  onReactivatePane,
  output,
  runtimeIdentity,
  focused,
  pane,
  size,
  stamp,
  inputEvent,
  onMouseInput,
  onError,
  stream,
  onFocus,
  onTerminalReady,
  inputEnabled = true,
  canReceiveInput = () => true,
}: TerminalPaneProps) {
  const renderedIdentity = useRef(terminalPaneKey(pane.id, output.read()));
  // Runtime changes wait for their control commit; reset-only changes stay pane-local.
  const identity = useSyncExternalStore(output.subscribe, () => {
    const buffer = output.read();
    if (
      runtimeIdentity &&
      buffer &&
      (buffer.epoch !== runtimeIdentity.epoch ||
        buffer.runtimeGeneration !== runtimeIdentity.runtimeGeneration)
    ) {
      return renderedIdentity.current;
    }
    return terminalPaneKey(pane.id, buffer);
  });
  renderedIdentity.current = identity;
  const runtimeGeneration =
    runtimeIdentity?.runtimeGeneration ?? output.read()?.runtimeGeneration ?? 0;
  const notice = paneNotice(pane.processStatus, connected || preservePresentation);
  const viewport = terminalRect(bounds, notice !== null);
  const reportReady = useCallback(
    (node: Renderable | null) => onTerminalReady(pane.id, node),
    [pane.id, onTerminalReady],
  );
  const running = pane.processStatus === "running";
  function acceptsInput(): boolean {
    return (
      connected &&
      terminalPaneKey(pane.id, output.read()) === identity &&
      !output.read()?.recovering &&
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
          key={identity}
          paneId={pane.id}
          output={output}
          size={size}
          stream={stream}
          context={stamp ? { ...stamp, runtimeGeneration } : null}
          focused={focused}
          preservePresentation={preservePresentation}
          inputEnabled={inputEnabled}
          canInput={acceptsInput}
          captureInput={(input) => {
            if (!stamp || !stream || !acceptsInput()) {
              return null;
            }
            const event = { ...inputEvent() };
            return {
              valid: acceptsInput,
              send: (eventInput, signal) =>
                stream.sendSemantic(
                  pane.id,
                  eventInput,
                  {
                    ...stamp,
                    source: "input",
                    ...event,
                    kind: input.kind,
                    runtimeGeneration,
                  },
                  signal,
                ),
            };
          }}
          canConsume={() => terminalPaneKey(pane.id, output.read()) === identity}
          onReady={reportReady}
          onFocus={onFocus}
          onMouseInput={onMouseInput}
          onError={(message) => onError?.(message)}
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

export function terminalPaneKey(paneId: string, buffer: TerminalBuffer | undefined): string {
  return `${paneId}:${buffer?.epoch ?? "pending"}:${buffer?.runtimeGeneration ?? 0}:${buffer?.resetGeneration ?? 0}`;
}

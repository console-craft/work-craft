import {
  type BoxRenderable,
  CliRenderEvents,
  type EmbeddedTerminalRenderable,
  type MouseEvent,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type { InputStamp, TerminalSize } from "@work-craft/server/client";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { observeOutput, outputProbeEnabled } from "@/client/output-probe";
import type { TerminalBuffer } from "@/client/terminal-buffer";
import { type ReplayProgress, terminalReplaySteps } from "@/client/terminal-replay";
import { Box } from "@/ui/primitives/box";

export type TerminalViewportProps = {
  paneId: string;
  buffer: TerminalBuffer;
  size: TerminalSize;
  inputEnabled: boolean;
  focused: boolean;
  canInput(): boolean;
  canRespond(stamp: InputStamp): boolean;
  onData(bytes: Uint8Array, source: "input" | "response", responseStamp?: InputStamp): void;
  onReady(node: EmbeddedTerminalRenderable | null): void;
  onFocus(): void;
  onResync(): void;
  onMouseInput?(event: MouseEvent): void;
};

function sameSize(first: TerminalSize, second: TerminalSize): boolean {
  return first.cols === second.cols && first.rows === second.rows;
}

let nextProbeInstance = 0;

/** Native parsing uses the shared grid; only this outer viewport follows local geometry. */
export function TerminalViewport(props: TerminalViewportProps): ReactNode {
  const renderer = useRenderer();
  const latest = useRef(props);
  latest.current = props;
  // A down-specific prop would replace the native terminal's mouse-encoding handler.
  const onMouse = useRef((event: MouseEvent) => {
    latest.current.onMouseInput?.(event);
    if (event.type === "down" && event.button === 0) {
      latest.current.onFocus();
    }
  }).current;
  const bootstrap = useRef(props.buffer.initialSize ?? props.size).current;
  const terminal = useRef<EmbeddedTerminalRenderable>(null);
  const [grid, setGrid] = useState(bootstrap);
  const requestedGrid = useRef(grid);
  const actualGrid = useRef(bootstrap);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const inputReady = useRef(false);
  const progress = useRef<ReplayProgress | null>(null);
  const suppressResponse = useRef(false);
  const responseStamp = useRef<InputStamp | null>(null);
  const resizing = useRef(false);
  const resyncBuffer = useRef<TerminalBuffer | null>(null);
  const probeInstance = useRef(0);
  if (outputProbeEnabled && probeInstance.current === 0) {
    probeInstance.current = ++nextProbeInstance;
  }

  function readiness(value: boolean): void {
    inputReady.current = value;
    setReady(value);
  }

  function resync(): void {
    readiness(false);
    const current = latest.current;
    if (resyncBuffer.current !== current.buffer) {
      resyncBuffer.current = current.buffer;
      current.onResync();
    }
  }

  function drain(): void {
    const target = terminal.current;
    if (!target) {
      return;
    }
    const current = latest.current;
    const planned = outputProbeEnabled ? performance.now() : 0;
    const replay = terminalReplaySteps(current.buffer, progress.current);
    if (outputProbeEnabled) {
      observeOutput({
        stage: "native.plan",
        aggregateOnly: replay.steps.length === 0,
        paneId: current.paneId,
        cursor: progress.current?.cursor,
        generation: probeInstance.current,
        pending: replay.steps.length,
        durationMs: performance.now() - planned,
      });
    }
    if (replay.needsSnapshot) {
      resync();
      return;
    }
    for (const step of replay.steps) {
      if (step.type === "resize") {
        if (
          !sameSize(actualGrid.current, step.marker) ||
          target.screen().columns !== step.marker.cols ||
          target.screen().rows !== step.marker.rows
        ) {
          readiness(false);
          if (!sameSize(requestedGrid.current, step.marker)) {
            resizing.current = true;
            requestedGrid.current = { cols: step.marker.cols, rows: step.marker.rows };
            setGrid(requestedGrid.current);
          }
          return;
        }
        progress.current = { cursor: step.marker.cursor, gridSequence: step.marker.sequence };
      } else {
        suppressResponse.current = step.origin === "history";
        responseStamp.current = step.responseStamp ?? null;
        const written = outputProbeEnabled ? performance.now() : 0;
        if (outputProbeEnabled) {
          observeOutput({
            stage: "native.write.start",
            paneId: current.paneId,
            cursor: step.cursor,
            bytes: step.data.byteLength,
            generation: probeInstance.current,
          });
        }
        try {
          target.write(step.data);
        } finally {
          if (outputProbeEnabled) {
            observeOutput({
              stage: "native.write.end",
              paneId: current.paneId,
              cursor: step.cursor,
              bytes: step.data.byteLength,
              generation: probeInstance.current,
              durationMs: performance.now() - written,
            });
          }
          suppressResponse.current = false;
          responseStamp.current = null;
        }
        progress.current = {
          cursor: step.cursor,
          gridSequence: progress.current?.gridSequence ?? current.buffer.initialGridSequence,
        };
      }
    }
    if (!sameSize(actualGrid.current, current.size)) {
      resync();
      return;
    }
    readiness(true);
  }

  useLayoutEffect(() => {
    if (outputProbeEnabled) {
      observeOutput({
        stage: "native.create",
        cols: bootstrap.cols,
        rows: bootstrap.rows,
        paneId: props.paneId,
        generation: probeInstance.current,
      });
    }
    return () => {
      if (outputProbeEnabled) {
        observeOutput({
          stage: "native.destroy",
          paneId: props.paneId,
          generation: probeInstance.current,
        });
      }
    };
  }, []);
  useLayoutEffect(drain);
  useLayoutEffect(followCursor, [viewport.width, viewport.height]);
  useLayoutEffect(() => {
    renderer.on(CliRenderEvents.FRAME, drain);
    return () => {
      renderer.off(CliRenderEvents.FRAME, drain);
    };
  }, [renderer]);

  useLayoutEffect(() => {
    const target = terminal.current;
    if (!target) {
      return;
    }
    const eligible =
      ready &&
      props.inputEnabled &&
      viewport.width >= 20 &&
      viewport.height >= 5 &&
      props.canInput();
    target.focusable = eligible;
    if (!props.focused || !eligible) {
      target.blur();
    }
    if (props.focused && eligible) {
      target.focus();
    }
  }, [ready, props.focused, props.inputEnabled, props.canInput, viewport.width, viewport.height]);

  useEffect(() => {
    props.onReady(terminal.current);
    return () => props.onReady(null);
  }, [props.onReady]);

  function followCursor(): void {
    const screen = terminal.current?.screen();
    if (!screen || !(viewport.width > 0 && viewport.height > 0)) {
      return;
    }
    const x = Math.max(
      0,
      Math.min(screen.columns - viewport.width, screen.cursor.x - viewport.width + 1),
    );
    const y = Math.max(
      0,
      Math.min(screen.rows - viewport.height, screen.cursor.y - viewport.height + 1),
    );
    setOffset((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
  }

  return (
    <Box
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      overflow="hidden"
      onSizeChange={function (this: BoxRenderable) {
        const { width, height } = this.getLayout();
        setViewport((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      }}
    >
      <terminal
        id={`terminal:${props.paneId}`}
        ref={terminal}
        cols={bootstrap.cols}
        rows={bootstrap.rows}
        width={grid.cols}
        height={grid.rows}
        position="absolute"
        left={-offset.x}
        top={-offset.y}
        flexShrink={0}
        transparentBackground
        onTerminalResize={(cols, rows) => {
          const screen = terminal.current?.screen();
          if (!screen || screen.columns !== cols || screen.rows !== rows) {
            return;
          }
          actualGrid.current = { cols, rows };
          if (outputProbeEnabled) {
            observeOutput({
              stage: "native.resize",
              cols,
              rows,
              paneId: latest.current.paneId,
              generation: probeInstance.current,
              bytes: cols * rows,
            });
          }
          resizing.current = false;
          drain();
        }}
        onScreenChange={followCursor}
        onData={(bytes, source) => {
          const current = latest.current;
          if (source === "response") {
            const stamp = responseStamp.current;
            if (
              stamp &&
              !suppressResponse.current &&
              !resizing.current &&
              current.canRespond(stamp)
            ) {
              // shortcut: native mode 2048 advertises reports it never emits; remove when native resize reports work.
              const text = new TextDecoder().decode(bytes);
              const reply = text
                .replaceAll("\x1b[?2048;2$y", "\x1b[?2048;0$y")
                .replaceAll("\x1b[?2048;1$y", "\x1b[?2048;0$y");
              current.onData(
                reply === text ? bytes : new TextEncoder().encode(reply),
                source,
                stamp,
              );
            }
          } else if (inputReady.current && current.inputEnabled && current.canInput()) {
            current.onData(bytes, source);
          }
        }}
        onMouse={onMouse}
      />
    </Box>
  );
}

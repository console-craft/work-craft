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
import type { PaneOutput } from "@/client/terminal-output";
import type { ReplayProgress } from "@/client/terminal-replay";
import { Box } from "@/ui/primitives/box";
import { terminalDrainFor } from "@/workbench/terminal-drain";
import {
  createTerminalInput,
  type TerminalInput,
  type TerminalInputAdmission,
} from "@/workbench/terminal-input";

export type TerminalViewportProps = {
  paneId: string;
  output: PaneOutput;
  size: TerminalSize;
  inputEnabled: boolean;
  focused: boolean;
  /** Preserve native focus as a picture only; byte forwarding still checks live input gates. */
  preservePresentation?: boolean;
  canInput(): boolean;
  captureInput?(): TerminalInputAdmission | null;
  canConsume?(): boolean;
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
  const scheduler = terminalDrainFor(renderer);
  const latest = useRef(props);
  latest.current = props;
  // A down-specific prop would replace the native terminal's mouse-encoding handler.
  const onMouse = useRef((event: MouseEvent) => {
    latest.current.onMouseInput?.(event);
    if (event.type === "down" && event.button === 0) {
      latest.current.onFocus();
    }
  }).current;
  const bootstrap = useRef(props.output.read()?.initialSize ?? props.size).current;
  const terminal = useRef<EmbeddedTerminalRenderable>(null);
  const [grid, setGrid] = useState(bootstrap);
  const requestedGrid = useRef(grid);
  const actualGrid = useRef(bootstrap);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const inputReady = useRef(false);
  const input = useRef<TerminalInput | null>(null);
  const recoveringFocus = useRef(false);
  const progress = useRef<ReplayProgress | null>(null);
  const required = useRef<(ReplayProgress & { size: TerminalSize }) | null>(null);
  const suppressResponse = useRef(false);
  const responseStamp = useRef<InputStamp | null>(null);
  const resizing = useRef(false);
  const resyncBuffer = useRef<TerminalBuffer | null>(null);
  const lastScreenChange = useRef(-Infinity);
  const screenChangeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const probeInstance = useRef(0);
  if (outputProbeEnabled && probeInstance.current === 0) {
    probeInstance.current = ++nextProbeInstance;
  }

  function readiness(value: boolean): void {
    if (value) {
      recoveringFocus.current = false;
    }
    if (inputReady.current === value) {
      return;
    }
    inputReady.current = value;
    setReady(value);
  }

  function resync(): void {
    input.current?.clear();
    readiness(false);
    required.current = null;
    const current = latest.current;
    const buffer = current.output.read();
    if (buffer && resyncBuffer.current !== buffer) {
      resyncBuffer.current = buffer;
      current.onResync();
    }
  }

  function drain(): void {
    scheduler.request(latest.current.paneId, drainStep);
  }

  function pauseRecovery(): void {
    input.current?.clear();
    recoveringFocus.current ||= terminal.current?.focused ?? false;
    required.current = null;
    readiness(false);
  }

  function drainStep(): boolean {
    const target = terminal.current;
    if (!target) {
      return false;
    }
    const current = latest.current;
    if (current.canConsume?.() === false) {
      return false;
    }
    const buffer = current.output.read();
    if (!buffer) {
      readiness(false);
      return false;
    }
    if (buffer.recovering) {
      pauseRecovery();
      return false;
    }
    if (resyncBuffer.current === buffer) {
      return false;
    }
    if (input.current?.step(progress.current)) {
      return true;
    }
    if (!required.current || !sameSize(required.current.size, current.size)) {
      required.current = {
        cursor: buffer.chunks.at(-1)?.cursor ?? buffer.historyCursor,
        gridSequence: buffer.resizes.at(-1)?.sequence ?? buffer.initialGridSequence,
        size: current.size,
      };
      readiness(false);
    }
    const planned = outputProbeEnabled ? performance.now() : 0;
    const boundary = input.current?.frontier();
    const quantum = boundary
      ? Math.max(
          1,
          Math.min(8192, boundary.cursor - (progress.current?.cursor ?? buffer.historyStartCursor)),
        )
      : 8192;
    const step = current.output.next(progress.current, quantum);
    if (outputProbeEnabled) {
      observeOutput({
        stage: "native.plan",
        aggregateOnly: step === null,
        paneId: current.paneId,
        cursor: progress.current?.cursor,
        generation: probeInstance.current,
        pending: step === null ? 0 : 1,
        durationMs: performance.now() - planned,
      });
    }
    if (step === "recover") {
      resync();
      return false;
    }
    if (step !== null) {
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
          return false;
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
        } catch {
          resync();
          return false;
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
          gridSequence: progress.current?.gridSequence ?? buffer.initialGridSequence,
        };
      }
      current.output.consumed(progress.current!);
    }
    const next = current.output.next(progress.current, 8192);
    const frontier = required.current;
    if (
      progress.current &&
      progress.current.cursor >= frontier.cursor &&
      (progress.current.gridSequence ?? 0) >= (frontier.gridSequence ?? 0) &&
      sameSize(actualGrid.current, current.size) &&
      !(
        next &&
        next !== "recover" &&
        next.type === "bytes" &&
        next.cursor === progress.current.cursor
      )
    ) {
      readiness(true);
    }
    return next !== null || input.current?.frontier() !== undefined;
  }

  useLayoutEffect(() => {
    const target = terminal.current!;
    const bridge = createTerminalInput({
      request: drain,
      overflow: resync,
      capture() {
        const current = latest.current;
        const buffer = current.output.read();
        if (
          !buffer ||
          buffer.recovering ||
          resyncBuffer.current === buffer ||
          (!inputReady.current && !terminal.current?.focused) ||
          !current.inputEnabled ||
          !current.canInput()
        ) {
          return null;
        }
        const captured = current.captureInput?.();
        if (current.captureInput && !captured) {
          return null;
        }
        const identity = [buffer.epoch, buffer.runtimeGeneration, buffer.resetGeneration].join(":");
        return {
          frontier: {
            cursor: buffer.chunks.at(-1)?.cursor ?? buffer.historyCursor,
            gridSequence: buffer.resizes.at(-1)?.sequence ?? buffer.initialGridSequence,
          },
          valid() {
            const next = latest.current.output.read();
            return (
              !!next &&
              !next.recovering &&
              latest.current.inputEnabled &&
              latest.current.canInput() &&
              [next.epoch, next.runtimeGeneration, next.resetGeneration].join(":") === identity &&
              current.canInput() &&
              (captured?.valid() ?? true)
            );
          },
          send: captured?.send ?? ((bytes) => current.onData(bytes, "input")),
        };
      },
    });
    input.current = bridge;
    target.onInputAdmission = bridge.admit;
    return () => {
      bridge.close();
      target.onInputAdmission = undefined;
      input.current = null;
    };
  }, []);

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
  useLayoutEffect(() => {
    const unsubscribe = props.output.subscribe(() => {
      if (latest.current.output.read()?.recovering) {
        pauseRecovery();
      }
      drain();
    });
    return () => {
      unsubscribe();
      scheduler.remove(props.paneId);
      clearTimeout(screenChangeTimer.current);
    };
  }, [props.output, props.paneId, scheduler]);
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
    const retaining =
      target.focused &&
      (props.preservePresentation === true ||
        recoveringFocus.current ||
        props.output.read()?.recovering === true);
    const eligible =
      (ready || retaining || (target.focused && resyncBuffer.current !== props.output.read())) &&
      props.inputEnabled &&
      viewport.width >= 20 &&
      viewport.height >= 5 &&
      (props.canInput() || retaining);
    target.focusable = eligible;
    if (!props.focused || !eligible) {
      target.blur();
    }
    if (props.focused && eligible) {
      target.focus();
    }
  }, [
    ready,
    props.focused,
    props.inputEnabled,
    props.canInput,
    props.preservePresentation,
    viewport.width,
    viewport.height,
  ]);

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

  function screenChanged(): void {
    const delay = 33 - (performance.now() - lastScreenChange.current);
    if (delay <= 0) {
      clearTimeout(screenChangeTimer.current);
      screenChangeTimer.current = undefined;
      lastScreenChange.current = performance.now();
      followCursor();
    } else if (screenChangeTimer.current === undefined) {
      screenChangeTimer.current = setTimeout(() => {
        screenChangeTimer.current = undefined;
        screenChanged();
      }, delay);
    }
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
        onScreenChange={screenChanged}
        onMouse={onMouse}
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
          }
        }}
      />
    </Box>
  );
}

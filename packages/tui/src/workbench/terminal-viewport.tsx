import {
  type BoxRenderable,
  CliRenderEvents,
  type MouseEvent,
  type Renderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type {
  CompactMaterialFrame,
  SemanticTerminalInput,
  StreamConnection,
  TerminalProjectionContext,
  TerminalSize,
} from "@work-craft/server/client";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { observeOutput, outputProbeEnabled } from "@/client/output-probe";
import type { PaneOutput } from "@/client/terminal-output";
import { Box } from "@/ui/primitives/box";
import {
  createTerminalInput,
  type TerminalInput,
  type TerminalInputAdmission,
} from "@/workbench/terminal-input";
import type { TerminalMaterialRenderable } from "@/workbench/terminal-material";

export type TerminalViewportProps = {
  paneId: string;
  output: PaneOutput;
  size: TerminalSize;
  stream: StreamConnection | null;
  context: TerminalProjectionContext | null;
  inputEnabled: boolean;
  focused: boolean;
  preservePresentation?: boolean;
  canInput(): boolean;
  captureInput(input: SemanticTerminalInput): TerminalInputAdmission | null;
  canConsume?(): boolean;
  onReady(node: Renderable | null): void;
  onFocus(): void;
  onError(message: string): void;
  onMouseInput?(event: MouseEvent): void;
};

function scope(context: TerminalProjectionContext | null): string {
  return context
    ? JSON.stringify([
        context.epoch,
        context.attachmentGeneration,
        context.navigationGeneration,
        context.geometrySequence,
        context.runtimeGeneration,
      ])
    : "";
}

function emptyFrame(size: TerminalSize): CompactMaterialFrame {
  return {
    size,
    cursor: { x: 0, y: 0, visible: false, style: "block", blinking: false },
    styles: [{ fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 }],
    rows: Array.from({ length: size.rows }, () => [[size.cols, " ", 1, 0]]),
  };
}

/** Disposable material consumer: the daemon alone parses ANSI and answers child queries. */
export function TerminalViewport(props: TerminalViewportProps): ReactNode {
  const renderer = useRenderer();
  const latest = useRef(props);
  latest.current = props;
  const [bootstrap] = useState(() => emptyFrame(props.size));
  const terminal = useRef<TerminalMaterialRenderable>(null);
  const input = useRef<TerminalInput | null>(null);
  const frame = useRef(bootstrap);
  const viewport = useRef({ width: 0, height: 0 });
  const mounted = useRef(false);
  const pending = useRef<CompactMaterialFrame | null>(null);
  const receivedVersion = useRef(0);
  const presentedVersion = useRef(-1);
  const pendingVersion = useRef(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useRef(false);
  const failed = useRef(false);
  const inputReady = useRef(false);
  const lastRequest = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [measured, setMeasured] = useState({ width: 0, height: 0 });

  function readiness(value: boolean): void {
    if (inputReady.current !== value) {
      inputReady.current = value;
      setReady(value);
    }
  }
  function canAdmit(): boolean {
    const current = latest.current;
    return (
      !failed.current &&
      current.inputEnabled &&
      current.canInput() &&
      viewport.current.width >= 20 &&
      viewport.current.height >= 5
    );
  }
  const admit = useRef((event: SemanticTerminalInput) => {
    input.current?.admit(event);
  }).current;
  const accepts = useRef(() => canAdmit()).current;
  const onMouse = useRef((event: MouseEvent) => {
    latest.current.onMouseInput?.(event);
    if (event.type === "down" && event.button === 0) {
      latest.current.onFocus();
    }
  }).current;

  function followCursor(): void {
    const current = frame.current;
    const { width, height } = viewport.current;
    const x = Math.max(0, Math.min(current.size.cols - width, current.cursor.x - width + 1));
    const y = Math.max(0, Math.min(current.size.rows - height, current.cursor.y - height + 1));
    setOffset((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
  }

  function schedule(): void {
    refresh.current = true;
    if (!mounted.current || request.current || pending.current || timer.current !== undefined) {
      return;
    }
    const delay = Math.max(0, 33 - (performance.now() - lastRequest.current));
    if (delay === 0) {
      fetchFrame();
    } else {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fetchFrame();
      }, delay);
    }
  }

  function fetchFrame(): void {
    const current = latest.current;
    if (
      !mounted.current ||
      request.current ||
      pending.current ||
      !refresh.current ||
      !current.stream ||
      !current.context ||
      current.canConsume?.() === false
    ) {
      return;
    }
    refresh.current = false;
    const abort = new AbortController();
    request.current = abort;
    const capturedScope = scope(current.context);
    const version = receivedVersion.current;
    const stream = current.stream;
    lastRequest.current = performance.now();
    if (outputProbeEnabled) {
      observeOutput({ stage: "material.request", paneId: current.paneId });
    }
    void stream
      .requestMaterial(
        current.paneId,
        { ...current.context },
        terminal.current?.scrollOffset ?? 0,
        abort.signal,
      )
      .then((material) => {
        const next = latest.current;
        if (
          !mounted.current ||
          abort.signal.aborted ||
          stream !== next.stream ||
          capturedScope !== scope(next.context)
        ) {
          return;
        }
        if (
          material.paneId !== next.paneId ||
          scope(material.context) !== capturedScope ||
          material.frame.size.cols !== next.size.cols ||
          material.frame.size.rows !== next.size.rows
        ) {
          throw new Error("Material response scope/geometry mismatch");
        }
        terminal.current!.setFrame(material.frame);
        if (outputProbeEnabled) {
          observeOutput({ stage: "material.apply", paneId: current.paneId });
        }
        frame.current = material.frame;
        pending.current = material.frame;
        pendingVersion.current = version;
        failed.current = false;
        followCursor();
      })
      .catch((error) => {
        if (
          !mounted.current ||
          abort.signal.aborted ||
          stream !== latest.current.stream ||
          capturedScope !== scope(latest.current.context)
        ) {
          return;
        }
        failed.current = true;
        input.current?.clear();
        readiness(false);
        terminal.current!.focusable = false;
        latest.current.onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (request.current === abort) {
          request.current = null;
        }
        if (!pending.current && refresh.current && !failed.current) {
          schedule();
        }
      });
  }

  function presented(): void {
    const target = terminal.current;
    if (
      pending.current &&
      target?.hasRendered(pending.current) &&
      viewport.current.width >= 20 &&
      viewport.current.height >= 5
    ) {
      pending.current = null;
      presentedVersion.current = pendingVersion.current;
      readiness(true);
      void input.current?.flush();
      if (refresh.current) {
        schedule();
      }
    }
  }

  useLayoutEffect(() => {
    mounted.current = true;
    terminal.current!.focusable = false;
    const queue = createTerminalInput({
      ready: () => inputReady.current && !failed.current,
      capture(event) {
        const admission = canAdmit() ? latest.current.captureInput(event) : null;
        const required = receivedVersion.current;
        return admission
          ? { ...admission, ready: () => presentedVersion.current >= required }
          : null;
      },
      onResult(event, forwarded) {
        const target = terminal.current;
        if (!target || target.isDestroyed) {
          return;
        }
        const previous = target.scrollOffset;
        target.applyMouseResult(event, forwarded);
        if (forwarded && (event.kind === "key" || event.kind === "paste")) {
          target.scrollOffset = 0;
        }
        if (previous !== target.scrollOffset) {
          schedule();
        }
      },
      onError: (error) => latest.current.onError(error.message),
    });
    input.current = queue;
    renderer.on(CliRenderEvents.FRAME, presented);
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      request.current?.abort();
      queue.close();
      input.current = null;
      renderer.off(CliRenderEvents.FRAME, presented);
    };
  }, [renderer]);

  const identity = scope(props.context);
  useLayoutEffect(() => {
    request.current?.abort();
    request.current = null;
    pending.current = null;
    presentedVersion.current = -1;
    failed.current = false;
    readiness(false);
    input.current?.clear();
    clearTimeout(timer.current);
    timer.current = undefined;
    lastRequest.current = -Infinity;
    refresh.current = true;
    fetchFrame();
    return () => {
      request.current?.abort();
      clearTimeout(timer.current);
    };
  }, [props.stream, identity]);

  useLayoutEffect(
    () =>
      props.output.subscribe(() => {
        receivedVersion.current++;
        schedule();
      }),
    [props.output],
  );
  useLayoutEffect(followCursor, [measured.width, measured.height]);
  useLayoutEffect(() => {
    const target = terminal.current!;
    const eligible = canAdmit();
    const retaining =
      target.focused && props.focused && (eligible || props.preservePresentation === true);
    target.focusable = retaining || (ready && eligible);
    if (!props.focused || (!eligible && !retaining)) {
      input.current?.clear();
      target.blur();
    } else if (ready && eligible && !target.focused) {
      target.focus();
    }
  }, [
    ready,
    props.focused,
    props.inputEnabled,
    props.canInput,
    props.preservePresentation,
    measured.width,
    measured.height,
  ]);
  useLayoutEffect(() => {
    props.onReady(terminal.current);
    return () => props.onReady(null);
  }, [props.onReady]);

  return (
    <Box
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      overflow="hidden"
      onSizeChange={function (this: BoxRenderable) {
        const { width, height } = this.getLayout();
        viewport.current = { width, height };
        setMeasured((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      }}
    >
      <terminal
        id={`terminal:${props.paneId}`}
        ref={terminal}
        frame={bootstrap}
        onInput={admit}
        canInput={accepts}
        position="absolute"
        left={-offset.x}
        top={-offset.y}
        flexShrink={0}
        onMouse={onMouse}
      />
    </Box>
  );
}

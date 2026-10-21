import { sameResponseStamp, type TerminalBuffer } from "@/client/terminal-buffer";
import {
  type ReplayProgress,
  type TerminalReplayStep,
  terminalReplaySteps,
} from "@/client/terminal-replay";

const EMPTY = new Uint8Array();

/** One mounted native consumer; retained history belongs to the output registry, not this queue. */
export function createTerminalConsumer(): {
  update(buffer: TerminalBuffer | undefined): void;
  next(after: ReplayProgress | null, maxBytes: number): TerminalReplayStep | "recover" | null;
  consumed(frontier: ReplayProgress): void;
  release(): void;
  needsReset(next: TerminalBuffer): boolean;
  frontier(): ReplayProgress | null;
} {
  let buffer: TerminalBuffer | undefined;
  let active = false;
  let missing = false;
  let progress: ReplayProgress | null = null;
  let queuedCursor = 0;
  let queuedGrid: number | null = null;
  let steps: (TerminalReplayStep | undefined)[] = [];
  let head = 0;
  let pendingBytes = 0;
  let pendingMarkers = 0;
  let offered: TerminalReplayStep | undefined;

  function release(): void {
    active = false;
    steps = [];
    head = 0;
    pendingBytes = 0;
    pendingMarkers = 0;
    offered = undefined;
  }

  function isPrefix(step: TerminalReplayStep): boolean {
    return (
      step.type === "bytes" &&
      !!buffer &&
      buffer.historyPrefixBytes > 0 &&
      step.data.buffer === buffer.history.buffer &&
      step.data.byteOffset < buffer.history.byteOffset + buffer.historyPrefixBytes
    );
  }

  function append(next: TerminalReplayStep[], needsSnapshot: boolean): void {
    missing ||= needsSnapshot;
    for (const step of next) {
      pendingBytes += step.type === "bytes" && !isPrefix(step) ? step.data.byteLength : 0;
      pendingMarkers +=
        step.type === "resize" && step.marker.sequence !== (buffer?.initialGridSequence ?? 0)
          ? 1
          : 0;
      queuedCursor = step.type === "bytes" ? step.cursor : step.marker.cursor;
      if (step.type === "resize") {
        queuedGrid = step.marker.sequence;
      }
      const previous = steps.at(-1);
      if (
        step.type === "bytes" &&
        previous?.type === "bytes" &&
        !isPrefix(step) &&
        !isPrefix(previous) &&
        previous.cursor === step.cursor - step.data.byteLength &&
        previous.data.byteLength + step.data.byteLength <= 8192 &&
        previous.origin === step.origin &&
        sameResponseStamp(previous.responseStamp, step.responseStamp)
      ) {
        const data = new Uint8Array(previous.data.byteLength + step.data.byteLength);
        data.set(previous.data);
        data.set(step.data, previous.data.byteLength);
        steps[steps.length - 1] = { ...step, data };
      } else {
        steps.push(step);
      }
    }
    if (pendingBytes > 3 * 1024 * 1024 || pendingMarkers > 1024 || missing) {
      missing = true;
      steps = [];
      pendingBytes = 0;
      pendingMarkers = 0;
      offered = undefined;
      head = 0;
      return;
    }
  }

  return {
    release,
    frontier: () => (active ? progress : null),
    needsReset(next) {
      return (
        active &&
        progress !== null &&
        buffer?.epoch === next.epoch &&
        buffer.runtimeGeneration === next.runtimeGeneration &&
        (progress.cursor < next.historyStartCursor ||
          (progress.gridSequence ?? 0) < (next.initialGridSequence ?? 0))
      );
    },
    update(next) {
      if (next === buffer) {
        return;
      }
      const previous = buffer;
      buffer = next;
      if (!active) {
        return;
      }
      if (
        !next ||
        !previous ||
        next.epoch !== previous.epoch ||
        next.runtimeGeneration !== previous.runtimeGeneration ||
        next.resetGeneration !== previous.resetGeneration ||
        next.history !== previous.history ||
        next.historyCursor !== previous.historyCursor ||
        next.historyStartCursor !== previous.historyStartCursor ||
        next.historyPrefixBytes !== previous.historyPrefixBytes ||
        next.initialGridSequence !== previous.initialGridSequence ||
        next.initialSize !== previous.initialSize
      ) {
        release();
        return;
      }
      const chunks: TerminalBuffer["chunks"] = [];
      for (let index = next.chunks.length - 1; index >= 0; index--) {
        const chunk = next.chunks[index]!;
        if (chunk.cursor <= queuedCursor) {
          break;
        }
        chunks.push(chunk);
      }
      const markers: TerminalBuffer["resizes"] = [];
      for (let index = next.resizes.length - 1; index >= 0; index--) {
        const marker = next.resizes[index]!;
        if (marker.sequence <= (queuedGrid ?? 0)) {
          break;
        }
        markers.push(marker);
      }
      if (chunks.length === 0 && markers.length === 0) {
        return;
      }
      const delta = terminalReplaySteps(
        {
          ...next,
          history: EMPTY,
          historyCursor: queuedCursor,
          historyStartCursor: queuedCursor,
          historyPrefixBytes: 0,
          initialSize: null,
          initialGridSequence: queuedGrid,
          chunks: chunks.reverse(),
          resizes: markers.reverse(),
        },
        { cursor: queuedCursor, gridSequence: queuedGrid },
      );
      append(delta.steps, delta.needsSnapshot);
    },
    next(after, maxBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new RangeError("Native write quantum must be a positive integer");
      }
      if (!buffer || buffer.needsHistory) {
        return "recover";
      }
      if (
        !active ||
        after?.cursor !== progress?.cursor ||
        after?.gridSequence !== progress?.gridSequence
      ) {
        active = true;
        missing = false;
        progress = after;
        steps = [];
        head = 0;
        pendingBytes = 0;
        pendingMarkers = 0;
        offered = undefined;
        queuedCursor = after?.cursor ?? buffer.historyStartCursor;
        queuedGrid = after?.gridSequence ?? buffer.initialGridSequence;
        const initial = terminalReplaySteps(buffer, after);
        append(initial.steps, initial.needsSnapshot);
      }
      if (missing) {
        return "recover";
      }
      const step = steps[head];
      if (!step) {
        return null;
      }
      if (step.type === "resize") {
        offered = step;
      } else {
        const length = Math.min(step.data.byteLength, maxBytes, 8192);
        // Truncation prefixes are display instructions, not advances of the raw-byte cursor.
        const prefix = isPrefix(step);
        offered = {
          ...step,
          data: step.data.subarray(0, length),
          cursor: prefix ? step.cursor : step.cursor - step.data.byteLength + length,
        };
      }
      return offered;
    },
    consumed(frontier) {
      const step = steps[head];
      if (
        !offered ||
        !step ||
        frontier.cursor !== (offered.type === "resize" ? offered.marker.cursor : offered.cursor) ||
        frontier.gridSequence !==
          (offered.type === "resize"
            ? offered.marker.sequence
            : (progress?.gridSequence ?? buffer?.initialGridSequence))
      ) {
        throw new Error("Native consumption does not match its offered frontier");
      }
      if (step.type === "bytes" && offered.type === "bytes") {
        if (!isPrefix(step)) {
          pendingBytes -= offered.data.byteLength;
        }
        if (offered.data.byteLength < step.data.byteLength) {
          steps[head] = { ...step, data: step.data.subarray(offered.data.byteLength) };
        } else {
          steps[head++] = undefined;
        }
      } else {
        if (step.type === "resize" && step.marker.sequence !== (buffer?.initialGridSequence ?? 0)) {
          pendingMarkers--;
        }
        steps[head++] = undefined;
      }
      progress = frontier;
      offered = undefined;
      if (head >= 64 && head * 2 >= steps.length) {
        steps = steps.slice(head);
        head = 0;
      }
    },
  };
}

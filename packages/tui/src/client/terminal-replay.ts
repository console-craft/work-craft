import type { GridMarker, InputStamp } from "@work-craft/server/client";

import type { TerminalBuffer } from "@/client/terminal-buffer";

// shortcut: bounded burst headroom, replace with consumption-aware delivery in the output/lifecycle follow-up.
export const MAX_TERMINAL_LIVE_BYTES = 2 * 1024 * 1024;

export type TerminalReplayStep =
  | { type: "resize"; marker: GridMarker }
  | {
      type: "bytes";
      cursor: number;
      data: Uint8Array;
      origin: "history" | "live";
      responseStamp?: InputStamp | null;
    };
export type ReplayProgress = { cursor: number; gridSequence: number | null };
type Segment = {
  start: number;
  end: number;
  data: Uint8Array;
  origin: "history" | "live";
  responseStamp?: InputStamp | null;
};
type ReplayResult = { steps: TerminalReplayStep[]; needsSnapshot: boolean };

/** Preserve byte offsets and resize order; a missing interval is never safe to guess. */
export function terminalReplaySteps(
  buffer: TerminalBuffer,
  after: ReplayProgress | null,
): ReplayResult {
  const missing: ReplayResult = { steps: [], needsSnapshot: true };
  const raw = buffer.history.subarray(buffer.historyPrefixBytes);
  if (
    buffer.historyPrefixBytes < 0 ||
    buffer.historyPrefixBytes > buffer.history.byteLength ||
    buffer.historyStartCursor + raw.byteLength !== buffer.historyCursor
  ) {
    return missing;
  }
  if (
    buffer.resizes.length > 1024 ||
    raw.byteLength + buffer.chunks.reduce((n, chunk) => n + chunk.data.byteLength, 0) >
      1024 * 1024 + MAX_TERMINAL_LIVE_BYTES
  ) {
    return missing;
  }
  const reset =
    after === null ||
    after.cursor < buffer.historyStartCursor ||
    (after.gridSequence ?? 0) < (buffer.initialGridSequence ?? 0);
  const segments: Segment[] = [
    { start: buffer.historyStartCursor, end: buffer.historyCursor, data: raw, origin: "history" },
  ];
  let tail = buffer.historyCursor;
  for (const chunk of buffer.chunks) {
    if (chunk.cursor <= tail) {
      continue;
    }
    const start = chunk.cursor - chunk.data.byteLength;
    // Retention may retire bytes this emulator already parsed; only unread gaps need resync.
    if (start > tail && (reset || start > after.cursor)) {
      return missing;
    }
    const retainedStart = Math.max(tail, start);
    segments.push({
      start: retainedStart,
      end: chunk.cursor,
      data: chunk.data.subarray(retainedStart - start),
      origin: chunk.origin,
      ...(chunk.responseStamp === undefined ? {} : { responseStamp: chunk.responseStamp }),
    });
    tail = chunk.cursor;
  }
  let previousSequence = buffer.initialGridSequence ?? 0;
  let previousCursor = buffer.historyStartCursor;
  for (const marker of buffer.resizes) {
    if (
      marker.sequence !== previousSequence + 1 ||
      marker.cursor < previousCursor ||
      marker.cursor > tail
    ) {
      return missing;
    }
    previousSequence = marker.sequence;
    previousCursor = marker.cursor;
  }
  if (reset && after !== null && buffer.historyPrefixBytes === 0) {
    return missing;
  }
  let cursor = reset ? buffer.historyStartCursor : after.cursor;
  let sequence = reset ? buffer.initialGridSequence : after.gridSequence;
  if (cursor > tail) {
    return missing;
  }
  const steps: TerminalReplayStep[] = [];
  if (reset && buffer.initialSize) {
    steps.push({
      type: "resize",
      marker: { ...buffer.initialSize, cursor, sequence: sequence ?? 0 },
    });
  }
  if (reset && buffer.historyPrefixBytes > 0) {
    steps.push({
      type: "bytes",
      cursor,
      data: buffer.history.subarray(0, buffer.historyPrefixBytes),
      origin: "history",
    });
  }

  function bytesUntil(end: number): boolean {
    for (const segment of segments) {
      if (cursor >= end) {
        break;
      }
      if (segment.end <= cursor) {
        continue;
      }
      if (segment.start > cursor) {
        return false;
      }
      const stop = Math.min(end, segment.end);
      steps.push({
        type: "bytes",
        cursor: stop,
        data: segment.data.subarray(cursor - segment.start, stop - segment.start),
        origin: segment.origin,
        ...(segment.responseStamp === undefined ? {} : { responseStamp: segment.responseStamp }),
      });
      cursor = stop;
    }
    return cursor === end;
  }

  for (const marker of buffer.resizes) {
    if (marker.sequence <= (sequence ?? 0)) {
      continue;
    }
    if (marker.cursor < cursor || !bytesUntil(marker.cursor)) {
      return missing;
    }
    steps.push({ type: "resize", marker });
    sequence = marker.sequence;
  }
  return bytesUntil(tail) ? { steps, needsSnapshot: false } : missing;
}

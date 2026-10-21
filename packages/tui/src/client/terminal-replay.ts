import type { GridMarker, TerminalSize } from "@work-craft/server/client";

export type TerminalReplayBuffer = {
  epoch: string;
  history: Uint8Array;
  historyStartCursor: number;
  historyPrefixBytes: number;
  historyCursor: number;
  initialSize: TerminalSize | null;
  initialGridSequence: number | null;
  resizes: GridMarker[];
  chunks: {
    cursor: number;
    data: Uint8Array;
    geometrySequence: number;
    origin: "history" | "live";
  }[];
};
export type TerminalReplayStep =
  | { type: "resize"; marker: GridMarker }
  | { type: "bytes"; cursor: number; data: Uint8Array; origin: "history" | "live" };
export type ReplayProgress = { cursor: number; gridSequence: number | null };
type Segment = { start: number; end: number; data: Uint8Array; origin: "history" | "live" };
type ReplayResult = { steps: TerminalReplayStep[]; needsSnapshot: boolean };

/** Preserve byte offsets and resize order; a missing interval is never safe to guess. */
export function terminalReplaySteps(
  buffer: TerminalReplayBuffer,
  after: ReplayProgress | null,
): ReplayResult {
  const missing: ReplayResult = { steps: [], needsSnapshot: true };
  if (
    buffer.resizes.length > 1024 ||
    buffer.history.byteLength + buffer.chunks.reduce((n, chunk) => n + chunk.data.byteLength, 0) >
      2 * 1024 * 1024
  ) {
    return missing;
  }
  const raw = buffer.history.subarray(buffer.historyPrefixBytes);
  if (
    buffer.historyPrefixBytes < 0 ||
    buffer.historyPrefixBytes > buffer.history.byteLength ||
    buffer.historyStartCursor + raw.byteLength !== buffer.historyCursor
  ) {
    return missing;
  }
  const segments: Segment[] = [
    { start: buffer.historyStartCursor, end: buffer.historyCursor, data: raw, origin: "history" },
  ];
  let tail = buffer.historyCursor;
  for (const chunk of buffer.chunks) {
    if (chunk.cursor <= tail) {
      continue;
    }
    const start = chunk.cursor - chunk.data.byteLength;
    if (start > tail) {
      return missing;
    }
    segments.push({
      start: tail,
      end: chunk.cursor,
      data: chunk.data.subarray(tail - start),
      origin: chunk.origin,
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
  const reset =
    after === null ||
    after.cursor < buffer.historyStartCursor ||
    (after.gridSequence ?? 0) < (buffer.initialGridSequence ?? 0);
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

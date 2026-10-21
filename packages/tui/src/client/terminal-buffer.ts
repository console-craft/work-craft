import {
  decodeBytes,
  type GridMarker,
  type Snapshot,
  type TerminalSize,
} from "@work-craft/server/client";

import { terminalReplaySteps } from "@/client/terminal-replay";

export type TerminalBuffer = {
  epoch: string;
  history: Uint8Array;
  historyCursor: number;
  historyStartCursor: number;
  historyPrefixBytes: number;
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

const MAX_TERMINAL_BYTES = 1024 * 1024;

export function snapshotTerminals(
  snapshot: Snapshot,
  current: ReadonlyMap<string, TerminalBuffer>,
): ReadonlyMap<string, TerminalBuffer> {
  const terminals = new Map<string, TerminalBuffer>();
  let changed = current.size !== snapshot.terminalHistories.length;
  for (const history of snapshot.terminalHistories) {
    const previous = current.get(history.paneId);
    let next = previous;
    const replacement: TerminalBuffer = {
      epoch: snapshot.epoch,
      history: decodeBytes(history.data),
      historyCursor: history.cursor,
      historyStartCursor: history.startCursor,
      historyPrefixBytes: history.prefixBytes,
      initialSize: history.initialSize,
      initialGridSequence: history.initialGridSequence,
      resizes: history.resizes,
      chunks: [],
    };
    if (previous?.epoch !== snapshot.epoch || terminalReplaySteps(previous, null).needsSnapshot) {
      next = replacement;
    } else {
      const latestCursor = previous.chunks.at(-1)?.cursor ?? previous.historyCursor;
      const markers = [
        ...new Map(
          [...previous.resizes, ...history.resizes].map((marker) => [marker.sequence, marker]),
        ).values(),
      ].toSorted((a, b) => a.sequence - b.sequence);
      next =
        markers.length > 1024 ||
        (history.initialGridSequence ?? 0) >
          (previous.resizes.at(-1)?.sequence ?? previous.initialGridSequence ?? 0)
          ? replacement
          : markers.length === previous.resizes.length
            ? previous
            : { ...previous, resizes: markers };
      if (history.cursor > latestCursor) {
        const data = decodeBytes(history.data);
        const missingBytes = history.cursor - latestCursor;
        next =
          next !== replacement &&
          latestCursor >= history.startCursor &&
          missingBytes <= data.byteLength - history.prefixBytes
            ? appendTerminalChunk(
                next,
                history.cursor,
                data.slice(data.byteLength - missingBytes),
                snapshot.geometry.sequence,
                "history",
              )
            : replacement;
      }
    }
    changed ||= next !== previous;
    terminals.set(history.paneId, next!);
  }
  return changed ? terminals : current;
}

export function appendTerminalChunk(
  buffer: TerminalBuffer,
  cursor: number,
  data: Uint8Array,
  geometrySequence: number,
  origin: "history" | "live" = "live",
): TerminalBuffer {
  const chunks = [...buffer.chunks, { cursor, data, geometrySequence, origin }];
  let excess =
    chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0) - MAX_TERMINAL_BYTES;
  while (excess > 0) {
    const first = chunks[0]!;
    if (first.data.byteLength <= excess) {
      excess -= first.data.byteLength;
      chunks.shift();
    } else {
      chunks[0] = { ...first, data: first.data.slice(excess) };
      excess = 0;
    }
  }
  return { ...buffer, chunks };
}

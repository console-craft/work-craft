import {
  decodeBytes,
  type GridMarker,
  type InputStamp,
  type Snapshot,
  type TerminalSize,
} from "@work-craft/server/client";

import { MAX_TERMINAL_LIVE_BYTES, terminalReplaySteps } from "@/client/terminal-replay";

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
    responseStamp?: InputStamp | null;
  }[];
};

export function snapshotTerminals(
  snapshot: Snapshot,
  current: ReadonlyMap<string, TerminalBuffer>,
): ReadonlyMap<string, TerminalBuffer> {
  const terminals = new Map<string, TerminalBuffer>();
  let changed = current.size !== snapshot.terminalHistories.length;
  for (const history of snapshot.terminalHistories) {
    const previous = current.get(history.paneId);
    let next = previous;
    const live = previous?.epoch === snapshot.epoch ? previous : undefined;
    const lastSequence = history.resizes.at(-1)?.sequence ?? history.initialGridSequence ?? 0;
    const replacement: TerminalBuffer = {
      epoch: snapshot.epoch,
      history: decodeBytes(history.data),
      historyCursor: history.cursor,
      historyStartCursor: history.startCursor,
      historyPrefixBytes: history.prefixBytes,
      initialSize: history.initialSize,
      initialGridSequence: history.initialGridSequence,
      // HTTP history may be overtaken by live bytes or a resize at its final cursor.
      resizes: [
        ...history.resizes,
        ...(live?.resizes.filter(({ sequence }) => sequence > lastSequence) ?? []),
      ],
      chunks: live?.chunks.filter(({ cursor }) => cursor > history.cursor) ?? [],
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
  responseStamp?: InputStamp | null,
): TerminalBuffer {
  const chunks = [...buffer.chunks];
  const previous = chunks.at(-1);
  if (
    previous &&
    previous.cursor === cursor - data.byteLength &&
    previous.data.byteLength + data.byteLength <= 8192 &&
    previous.origin === origin &&
    previous.geometrySequence === geometrySequence &&
    sameResponseStamp(previous.responseStamp, responseStamp) &&
    (buffer.resizes.at(-1)?.cursor ?? -1) < previous.cursor
  ) {
    const merged = new Uint8Array(previous.data.byteLength + data.byteLength);
    merged.set(previous.data);
    merged.set(data, previous.data.byteLength);
    chunks[chunks.length - 1] = { ...previous, cursor, data: merged };
  } else {
    chunks.push({
      cursor,
      data,
      geometrySequence,
      origin,
      ...(responseStamp === undefined ? {} : { responseStamp }),
    });
  }
  let excess =
    chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0) - MAX_TERMINAL_LIVE_BYTES;
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

export function sameResponseStamp(first?: InputStamp | null, second?: InputStamp | null): boolean {
  return (
    first === second ||
    (!!first &&
      !!second &&
      first.epoch === second.epoch &&
      first.attachmentGeneration === second.attachmentGeneration &&
      first.navigationGeneration === second.navigationGeneration &&
      first.geometrySequence === second.geometrySequence)
  );
}

import {
  decodeBytes,
  type GridMarker,
  type InputStamp,
  type PaneHistoryResponse,
  type Snapshot,
  type TerminalSize,
} from "@work-craft/server/client";

import { MAX_TERMINAL_LIVE_BYTES, terminalReplaySteps } from "@/client/terminal-replay";

export type TerminalBuffer = {
  epoch: string;
  runtimeGeneration: number;
  resetGeneration: number;
  needsHistory?: boolean;
  recovering?: boolean;
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
    const next = mergePaneHistory(
      {
        epoch: snapshot.epoch,
        paneId: history.paneId,
        runtimeGeneration: previous?.epoch === snapshot.epoch ? previous.runtimeGeneration : 0,
        history,
      },
      previous,
      snapshot.geometry.sequence,
    );
    changed ||= next !== previous;
    terminals.set(history.paneId, next);
  }
  return changed ? terminals : current;
}

/** Merge scoped history without discarding overtaking live bytes or resize markers. */
export function mergePaneHistory(
  response: PaneHistoryResponse,
  previous: TerminalBuffer | undefined,
  geometrySequence: number,
): TerminalBuffer {
  const { history, epoch, runtimeGeneration } = response;
  const current =
    previous?.epoch === epoch && previous.runtimeGeneration === runtimeGeneration
      ? previous
      : undefined;
  const lastSequence = history.resizes.at(-1)?.sequence ?? history.initialGridSequence ?? 0;
  const replacement: TerminalBuffer = {
    epoch,
    runtimeGeneration,
    resetGeneration: current?.resetGeneration ?? 0,
    history: decodeBytes(history.data),
    historyCursor: history.cursor,
    historyStartCursor: history.startCursor,
    historyPrefixBytes: history.prefixBytes,
    initialSize: history.initialSize,
    initialGridSequence: history.initialGridSequence,
    resizes: [
      ...history.resizes,
      ...(current?.resizes.filter(({ sequence }) => sequence > lastSequence) ?? []),
    ],
    chunks: current?.chunks.filter(({ cursor }) => cursor > history.cursor) ?? [],
  };
  if (!current || current.needsHistory) {
    return replacement;
  }
  if (
    terminalReplaySteps(current, null).needsSnapshot ||
    (history.initialGridSequence ?? 0) >
      (current.resizes.at(-1)?.sequence ?? current.initialGridSequence ?? 0)
  ) {
    return replacement;
  }
  const latestCursor = current.chunks.at(-1)?.cursor ?? current.historyCursor;
  const markers = [
    ...new Map(
      [...current.resizes, ...history.resizes].map((marker) => [marker.sequence, marker]),
    ).values(),
  ].toSorted((a, b) => a.sequence - b.sequence);
  if (markers.length > 1024) {
    return replacement;
  }
  let next = markers.length === current.resizes.length ? current : { ...current, resizes: markers };
  if (history.cursor > latestCursor) {
    const missing = history.cursor - latestCursor;
    const data = replacement.history;
    if (latestCursor < history.startCursor || missing > data.byteLength - history.prefixBytes) {
      return replacement;
    }
    next = appendTerminalChunk(
      next,
      history.cursor,
      data.slice(data.byteLength - missing),
      geometrySequence,
      "history",
    );
  }
  return next;
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

import { decodeBytes, type Snapshot } from "@work-craft/server/client";

export type TerminalBuffer = {
  epoch: string;
  history: Uint8Array;
  historyCursor: number;
  chunks: { cursor: number; data: Uint8Array }[];
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
    if (previous?.epoch !== snapshot.epoch) {
      next = {
        epoch: snapshot.epoch,
        history: decodeBytes(history.data),
        historyCursor: history.cursor,
        chunks: [],
      };
    } else {
      const latestCursor = previous.chunks.at(-1)?.cursor ?? previous.historyCursor;
      if (history.cursor > latestCursor) {
        const data = decodeBytes(history.data);
        const missingBytes = history.cursor - latestCursor;
        const retainedStart = history.cursor - Math.min(history.cursor, MAX_TERMINAL_BYTES);
        next =
          latestCursor >= retainedStart && missingBytes <= data.byteLength
            ? appendTerminalChunk(
                previous,
                history.cursor,
                data.slice(data.byteLength - missingBytes),
              )
            : {
                epoch: snapshot.epoch,
                history: data,
                historyCursor: history.cursor,
                chunks: [],
              };
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
): TerminalBuffer {
  const chunks = [...buffer.chunks, { cursor, data }];
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

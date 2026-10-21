import type { Database } from "bun:sqlite";

import type { GridMarker, TerminalSize } from "../api/protocol.ts";
import { HistoryGeometry } from "./history-geometry.ts";

export type HistoryOptions = {
  maxBytesPerPane?: number;
  flushBytes?: number;
  flushIntervalMs?: number;
  maxMarkers?: number;
};

export type HistoryRead = {
  paneId: string;
  cursor: number;
  data: Uint8Array;
  truncated: boolean;
  startCursor: number;
  prefixBytes: number;
  initialSize: TerminalSize | null;
  initialGridSequence: number | null;
  resizes: GridMarker[];
};

type Chunk = { cursorStart: number; cursorEnd: number; data: Uint8Array };
type PaneHistory = {
  cursor: number;
  queuedBytes: number;
  chunks: Chunk[];
  dirty: boolean;
  timer?: Timer;
};

const TRUNCATION_MARKER = new TextEncoder().encode(
  "\x1bc\r\n[work-craft: earlier terminal output truncated]\r\n",
);

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

export class TerminalHistory {
  private readonly maxBytesPerPane: number;
  private readonly flushBytes: number;
  private readonly flushIntervalMs: number;
  private readonly panes = new Map<string, PaneHistory>();
  private readonly geometry: HistoryGeometry;

  constructor(
    private readonly db: Database,
    options: HistoryOptions = {},
  ) {
    this.maxBytesPerPane = options.maxBytesPerPane ?? 1024 * 1024;
    this.flushBytes = options.flushBytes ?? 32 * 1024;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
    this.geometry = new HistoryGeometry(db, options.maxMarkers);
  }

  recordGrid(paneId: string, size: TerminalSize): GridMarker | undefined {
    const pane = this.pane(paneId);
    const marker = this.geometry.record(paneId, pane.cursor, size);
    if (marker) {
      pane.dirty = true;
      pane.timer ??= setTimeout(
        () => void this.flush(paneId).catch(() => {}),
        this.flushIntervalMs,
      );
    }
    return marker;
  }

  append(paneId: string, bytes: Uint8Array): number {
    const pane = this.pane(paneId);
    const cursorStart = pane.cursor;
    pane.cursor += bytes.byteLength;
    if (bytes.byteLength === 0) {
      return pane.cursor;
    }

    pane.chunks.push({ cursorStart, cursorEnd: pane.cursor, data: bytes.slice() });
    pane.dirty = true;
    pane.queuedBytes += bytes.byteLength;
    if (pane.queuedBytes >= this.flushBytes) {
      if (pane.timer !== undefined) {
        clearTimeout(pane.timer);
      }
      pane.timer = setTimeout(() => void this.flush(paneId).catch(() => {}), 0);
    } else if (pane.timer === undefined) {
      pane.timer = setTimeout(() => void this.flush(paneId).catch(() => {}), this.flushIntervalMs);
    }
    return pane.cursor;
  }

  async flush(paneId?: string): Promise<void> {
    const paneIds = paneId === undefined ? [...this.panes.keys()] : [paneId];
    for (const id of paneIds) {
      const pane = this.panes.get(id);
      if (pane === undefined) {
        continue;
      }
      if (pane.timer !== undefined) {
        clearTimeout(pane.timer);
        pane.timer = undefined;
      }
      if (!pane.dirty) {
        continue;
      }

      const chunks = pane.chunks;
      this.db.transaction(() => {
        const insert = this.db.query(
          "INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES (?, ?, ?, ?)",
        );
        for (const chunk of chunks) {
          insert.run(id, chunk.cursorStart, chunk.cursorEnd, chunk.data);
        }
        const retainedStart = this.geometry.retentionStart(
          id,
          Math.max(0, pane.cursor - this.maxBytesPerPane),
        );
        this.retainNewest(id, retainedStart);
        this.geometry.flush(id, retainedStart, pane.cursor);
      })();
      this.geometry.committed(id);
      pane.chunks = [];
      pane.queuedBytes = 0;
      pane.dirty = false;
    }
  }

  read(paneId: string, afterCursor?: number): HistoryRead {
    const pane = this.pane(paneId);
    const persisted = this.db
      .query<Chunk, [string]>(
        "SELECT cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks WHERE pane_id = ? ORDER BY cursor_start, id",
      )
      .all(paneId);
    const retained = concatBytes([...persisted, ...pane.chunks].map(({ data }) => data));
    const retainedStart = this.geometry.retentionStart(
      paneId,
      Math.max(0, pane.cursor - Math.min(retained.byteLength, this.maxBytesPerPane)),
    );
    const bytes = retained.slice(Math.max(0, retained.byteLength - (pane.cursor - retainedStart)));
    const truncated =
      retainedStart > 0 && (afterCursor === undefined || afterCursor < retainedStart);
    const offset = Math.max(
      0,
      Math.min(bytes.byteLength, (afterCursor ?? retainedStart) - retainedStart),
    );
    const data = bytes.slice(offset);
    const startCursor = retainedStart + offset;
    const grid = this.geometry.read(paneId, startCursor, pane.cursor);
    const prefix = truncated || (grid.truncated && afterCursor === undefined);
    return {
      paneId,
      cursor: pane.cursor,
      data: prefix ? concatBytes([TRUNCATION_MARKER, data]) : data,
      ...grid,
      truncated: prefix,
      startCursor,
      prefixBytes: prefix ? TRUNCATION_MARKER.byteLength : 0,
    };
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private pane(paneId: string): PaneHistory {
    let pane = this.panes.get(paneId);
    if (pane === undefined) {
      const cursor =
        this.db
          .query<{ cursor: number }, [string]>(
            "SELECT COALESCE(MAX(cursor_end), 0) AS cursor FROM terminal_chunks WHERE pane_id = ?",
          )
          .get(paneId)?.cursor ?? 0;
      pane = {
        cursor: Math.max(cursor, this.geometry.endCursor(paneId)),
        queuedBytes: 0,
        chunks: [],
        dirty: false,
      };
      this.panes.set(paneId, pane);
    }
    return pane;
  }

  private retainNewest(paneId: string, retainedStart: number): void {
    const rows = this.db
      .query<{ id: number } & Chunk, [string]>(
        "SELECT id, cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks WHERE pane_id = ? ORDER BY cursor_start, id",
      )
      .all(paneId);
    for (const row of rows) {
      if (row.cursorStart >= retainedStart) {
        break;
      }
      if (row.cursorEnd <= retainedStart) {
        this.db.run("DELETE FROM terminal_chunks WHERE id = ?", [row.id]);
      } else {
        this.db.run("UPDATE terminal_chunks SET cursor_start = ?, data = ? WHERE id = ?", [
          retainedStart,
          row.data.slice(retainedStart - row.cursorStart),
          row.id,
        ]);
      }
    }
  }
}

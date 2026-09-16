import type { Database } from "bun:sqlite";

export type HistoryOptions = {
  maxBytesPerPane?: number;
  flushBytes?: number;
  flushIntervalMs?: number;
};

export type HistoryRead = {
  paneId: string;
  cursor: number;
  data: Uint8Array;
  truncated: boolean;
};

type Chunk = { cursorStart: number; cursorEnd: number; data: Uint8Array };
type PaneHistory = { cursor: number; queuedBytes: number; chunks: Chunk[]; timer?: Timer };

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

  constructor(
    private readonly db: Database,
    options: HistoryOptions = {},
  ) {
    this.maxBytesPerPane = options.maxBytesPerPane ?? 1024 * 1024;
    this.flushBytes = options.flushBytes ?? 32 * 1024;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
  }

  append(paneId: string, bytes: Uint8Array): number {
    const pane = this.pane(paneId);
    const cursorStart = pane.cursor;
    pane.cursor += bytes.byteLength;
    if (bytes.byteLength === 0) {
      return pane.cursor;
    }

    pane.chunks.push({ cursorStart, cursorEnd: pane.cursor, data: bytes.slice() });
    pane.queuedBytes += bytes.byteLength;
    if (pane.queuedBytes >= this.flushBytes) {
      if (pane.timer !== undefined) {
        clearTimeout(pane.timer);
      }
      pane.timer = setTimeout(() => void this.flush(paneId), 0);
    } else if (pane.timer === undefined) {
      pane.timer = setTimeout(() => void this.flush(paneId), this.flushIntervalMs);
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
      if (pane.chunks.length === 0) {
        continue;
      }

      const chunks = pane.chunks;
      pane.chunks = [];
      pane.queuedBytes = 0;
      this.db.transaction(() => {
        const insert = this.db.query(
          "INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES (?, ?, ?, ?)",
        );
        for (const chunk of chunks) {
          insert.run(id, chunk.cursorStart, chunk.cursorEnd, chunk.data);
        }
        this.retainNewest(id);
      })();
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
    const bytes =
      retained.byteLength > this.maxBytesPerPane
        ? retained.slice(retained.byteLength - this.maxBytesPerPane)
        : retained;
    const retainedStart = pane.cursor - bytes.byteLength;
    const truncated =
      retainedStart > 0 && (afterCursor === undefined || afterCursor < retainedStart);
    const offset = Math.max(
      0,
      Math.min(bytes.byteLength, (afterCursor ?? retainedStart) - retainedStart),
    );
    const data = bytes.slice(offset);
    return {
      paneId,
      cursor: pane.cursor,
      data: truncated ? concatBytes([TRUNCATION_MARKER, data]) : data,
      truncated,
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
      pane = { cursor, queuedBytes: 0, chunks: [] };
      this.panes.set(paneId, pane);
    }
    return pane;
  }

  private retainNewest(paneId: string): void {
    const rows = this.db
      .query<{ id: number } & Chunk, [string]>(
        "SELECT id, cursor_start AS cursorStart, cursor_end AS cursorEnd, data FROM terminal_chunks WHERE pane_id = ? ORDER BY cursor_start, id",
      )
      .all(paneId);
    let excess = rows.reduce((total, row) => total + row.data.byteLength, 0) - this.maxBytesPerPane;
    for (const row of rows) {
      if (excess <= 0) {
        break;
      }
      if (row.data.byteLength <= excess) {
        this.db.run("DELETE FROM terminal_chunks WHERE id = ?", [row.id]);
        excess -= row.data.byteLength;
      } else {
        this.db.run("UPDATE terminal_chunks SET cursor_start = ?, data = ? WHERE id = ?", [
          row.cursorStart + excess,
          row.data.slice(excess),
          row.id,
        ]);
        excess = 0;
      }
    }
  }
}

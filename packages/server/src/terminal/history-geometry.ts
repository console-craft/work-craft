import type { Database } from "bun:sqlite";

import { type GridMarker, ProtocolError, type TerminalSize } from "../api/protocol.ts";

export type RuntimeStart = "fresh" | "restored";
export type RuntimeStartMarker = GridMarker & { runtimeStart: RuntimeStart };
type StoredMarker = GridMarker & { runtimeStart?: RuntimeStart };

type SavedGrid = {
  startCursor: number;
  endCursor: number;
  cols: number | null;
  rows: number | null;
  sequence: number | null;
  truncated: number;
};
type PaneGeometry = {
  start: number;
  end: number;
  baseline: TerminalSize | null;
  baselineSequence: number | null;
  truncated: boolean;
  markers: StoredMarker[];
  pending: StoredMarker[];
  sequence: number;
};

function validCursor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function publicMarker({ cursor, sequence, cols, rows }: GridMarker): GridMarker {
  return { cursor, sequence, cols, rows };
}

function validSize(size: TerminalSize): boolean {
  return (
    [size.cols, size.rows].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 4096,
    ) && size.cols * size.rows <= 1_048_576
  );
}

/** Bounded resize metadata; byte history owns the enclosing flush transaction. */
export class HistoryGeometry {
  private readonly panes = new Map<string, PaneGeometry>();

  constructor(
    private readonly db: Database,
    private readonly maxMarkers = 1024,
  ) {
    if (!Number.isSafeInteger(maxMarkers) || maxMarkers < 1) {
      throw new Error("Resize history requires a positive marker budget");
    }
  }

  record(
    paneId: string,
    cursor: number,
    size: TerminalSize,
    runtimeStart?: RuntimeStart,
  ): GridMarker | undefined {
    const pane = this.pane(paneId);
    if (!validCursor(cursor) || cursor < pane.end || !validSize(size)) {
      throw new ProtocolError("Invalid terminal resize cursor or dimensions");
    }
    const last = pane.markers.at(-1) ?? pane.baseline;
    if (!runtimeStart && last?.cols === size.cols && last?.rows === size.rows) {
      return undefined;
    }
    const marker: StoredMarker = {
      ...size,
      cursor,
      sequence: ++pane.sequence,
      ...(runtimeStart ? { runtimeStart } : {}),
    };
    pane.markers.push(marker);
    pane.pending.push(marker);
    pane.end = cursor;
    if (pane.markers.length > this.maxMarkers) {
      const dropped = pane.markers.splice(0, pane.markers.length - this.maxMarkers);
      const baseline = dropped.at(-1)!;
      pane.baseline = { cols: baseline.cols, rows: baseline.rows };
      pane.baselineSequence = baseline.sequence;
      pane.start = Math.max(pane.start, baseline.cursor);
      pane.truncated = true;
      pane.pending = pane.pending.filter(({ sequence }) => sequence > baseline.sequence);
    }
    return publicMarker(marker);
  }

  endCursor(paneId: string): number {
    return this.pane(paneId).end;
  }

  current(paneId: string): { size: TerminalSize | null; gridSequence: number | null } {
    const pane = this.pane(paneId);
    const last = pane.markers.at(-1);
    return {
      size: last ? { cols: last.cols, rows: last.rows } : pane.baseline,
      gridSequence: last?.sequence ?? pane.baselineSequence,
    };
  }

  retentionStart(paneId: string, byteStart: number): number {
    const pane = this.pane(paneId);
    if (!validCursor(byteStart)) {
      throw new ProtocolError("Invalid terminal history retention cursor");
    }
    if (byteStart > pane.start) {
      const preceding = pane.markers.filter(({ cursor }) => cursor < byteStart);
      const baseline = preceding.at(-1);
      if (baseline) {
        pane.baseline = { cols: baseline.cols, rows: baseline.rows };
        pane.baselineSequence = baseline.sequence;
      }
      pane.start = byteStart;
      pane.markers = pane.markers.filter(({ cursor }) => cursor >= byteStart);
      pane.pending = pane.pending.filter(({ cursor }) => cursor >= byteStart);
      pane.truncated = true;
    }
    return pane.start;
  }

  read(
    paneId: string,
    startCursor: number,
    endCursor: number,
  ): {
    initialSize: TerminalSize | null;
    initialGridSequence: number | null;
    resizes: GridMarker[];
    truncated: boolean;
  } {
    if (!validCursor(startCursor) || !validCursor(endCursor) || startCursor > endCursor) {
      throw new ProtocolError("Invalid terminal history range");
    }
    const pane = this.pane(paneId);
    const start = Math.max(startCursor, pane.start);
    const preceding = pane.markers.findLast(({ cursor }) => cursor < start);
    return {
      initialSize: preceding ? { cols: preceding.cols, rows: preceding.rows } : pane.baseline,
      initialGridSequence: preceding?.sequence ?? pane.baselineSequence,
      resizes: pane.markers
        .filter(({ cursor }) => cursor >= start && cursor <= endCursor)
        .map(publicMarker),
      truncated: pane.truncated,
    };
  }

  /** Internal boundaries share resize sequence order and retention, never the public DTO. */
  starts(paneId: string, startCursor: number, endCursor: number): RuntimeStartMarker[] {
    this.read(paneId, startCursor, endCursor);
    const pane = this.pane(paneId);
    const start = Math.max(startCursor, pane.start);
    return pane.markers.flatMap((marker) =>
      marker.runtimeStart && marker.cursor >= start && marker.cursor <= endCursor
        ? [{ ...publicMarker(marker), runtimeStart: marker.runtimeStart }]
        : [],
    );
  }

  /** Call committed only after the enclosing byte+marker transaction succeeds. */
  flush(paneId: string, retainedStart: number, endCursor: number): void {
    const pane = this.pane(paneId);
    const start = this.retentionStart(paneId, retainedStart);
    if (!validCursor(endCursor) || endCursor < pane.end || endCursor < start) {
      throw new ProtocolError("Invalid terminal history flush cursor");
    }
    this.db
      .query(`INSERT INTO terminal_grids (pane_id,start_cursor,end_cursor,baseline_cols,baseline_rows,baseline_sequence,truncated)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(pane_id) DO UPDATE SET
      start_cursor=excluded.start_cursor,end_cursor=excluded.end_cursor,baseline_cols=excluded.baseline_cols,
      baseline_rows=excluded.baseline_rows,baseline_sequence=excluded.baseline_sequence,truncated=excluded.truncated`)
      .run(
        paneId,
        start,
        endCursor,
        pane.baseline?.cols ?? null,
        pane.baseline?.rows ?? null,
        pane.baselineSequence,
        Number(pane.truncated),
      );
    this.db.run(
      "DELETE FROM terminal_resizes WHERE pane_id = ? AND (cursor < ? OR sequence <= ?)",
      [paneId, start, pane.baselineSequence ?? 0],
    );
    const insert = this.db.query(
      "INSERT OR IGNORE INTO terminal_resizes (pane_id,sequence,cursor,cols,rows,runtime_start) VALUES (?,?,?,?,?,?)",
    );
    for (const marker of pane.pending) {
      insert.run(
        paneId,
        marker.sequence,
        marker.cursor,
        marker.cols,
        marker.rows,
        marker.runtimeStart ?? null,
      );
    }
  }

  committed(paneId: string): void {
    const pane = this.pane(paneId);
    const saved = this.db
      .query<{ end: number }, [string]>(
        "SELECT end_cursor AS end FROM terminal_grids WHERE pane_id = ?",
      )
      .get(paneId);
    pane.end = saved?.end ?? pane.end;
    pane.pending = [];
  }

  private pane(paneId: string): PaneGeometry {
    const existing = this.panes.get(paneId);
    if (existing) {
      return existing;
    }
    if (this.db.query("SELECT 1 FROM panes WHERE id = ?").get(paneId) === null) {
      throw new ProtocolError("Terminal history pane not found");
    }
    const saved = this.db
      .query<SavedGrid, [string]>(
        "SELECT start_cursor AS startCursor,end_cursor AS endCursor,baseline_cols AS cols,baseline_rows AS rows,baseline_sequence AS sequence,truncated FROM terminal_grids WHERE pane_id = ?",
      )
      .get(paneId);
    const markers = this.db
      .query<GridMarker & { runtimeStart: RuntimeStart | null }, [string]>(
        "SELECT cursor,sequence,cols,rows,runtime_start AS runtimeStart FROM terminal_resizes WHERE pane_id = ? ORDER BY sequence",
      )
      .all(paneId);
    const baseline =
      saved?.cols === null || saved === null ? null : { cols: saved.cols, rows: saved.rows! };
    const baselineValues = saved ? [saved.cols, saved.rows, saved.sequence] : [];
    const partialBaseline =
      baselineValues.some((value) => value === null) &&
      baselineValues.some((value) => value !== null);
    if (
      saved &&
      (!validCursor(saved.startCursor) ||
        !validCursor(saved.endCursor) ||
        saved.startCursor > saved.endCursor ||
        partialBaseline ||
        (saved.sequence !== null && !validCursor(saved.sequence)) ||
        (baseline && !validSize(baseline)))
    ) {
      throw new ProtocolError("Invalid persisted terminal grid");
    }
    let previousCursor = saved?.startCursor ?? 0;
    let previousSequence = saved?.sequence ?? 0;
    for (const marker of markers) {
      if (
        !saved ||
        !validCursor(marker.cursor) ||
        marker.cursor < previousCursor ||
        marker.cursor > saved.endCursor ||
        !validCursor(marker.sequence) ||
        marker.sequence <= previousSequence ||
        !validSize(marker) ||
        (marker.runtimeStart !== null && !["fresh", "restored"].includes(marker.runtimeStart))
      ) {
        throw new ProtocolError("Invalid persisted terminal resize markers");
      }
      previousCursor = marker.cursor;
      previousSequence = marker.sequence;
    }
    const pane: PaneGeometry = {
      start: saved?.startCursor ?? 0,
      end: saved?.endCursor ?? 0,
      baseline,
      baselineSequence: saved?.sequence ?? null,
      truncated: saved?.truncated === 1,
      markers: markers.map((marker) => ({
        ...publicMarker(marker),
        ...(marker.runtimeStart === null ? {} : { runtimeStart: marker.runtimeStart }),
      })),
      pending: [],
      sequence: markers.at(-1)?.sequence ?? saved?.sequence ?? 0,
    };
    this.panes.set(paneId, pane);
    return pane;
  }
}

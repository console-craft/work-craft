export type OutputObservation = {
  stage: string;
  paneId?: string;
  cursor?: number;
  bytes?: number;
  geometrySequence?: number;
  generation?: number;
  pending?: number;
  durationMs?: number;
  cols?: number;
  rows?: number;
  aggregateOnly?: boolean;
};

/** Bounded metadata recorder; no event-time I/O or import-time file/signal initialization. */
export function createOutputProbe(
  write: (lines: string) => void,
  now: () => number,
): {
  observe(event: OutputObservation): void;
  flush(): void;
} {
  let events: object[] = [];
  let sequence = 0;
  let discarded = 0;
  let aggregated = 0;
  let highWater: Record<string, { bytes: number; pending: number }> = Object.create(null);
  let totals: Record<string, { count: number; bytes: number; durationMs: number }> =
    Object.create(null);
  return {
    observe(event) {
      const stage = event.stage.slice(0, 64);
      const key = Object.hasOwn(totals, stage) || Object.keys(totals).length < 64 ? stage : "other";
      const total = (totals[key] ??= { count: 0, bytes: 0, durationMs: 0 });
      total.count++;
      total.bytes += event.bytes ?? 0;
      total.durationMs += event.durationMs ?? 0;
      const high = (highWater[key] ??= { bytes: 0, pending: 0 });
      high.bytes = Math.max(high.bytes, event.bytes ?? 0);
      high.pending = Math.max(high.pending, event.pending ?? 0);
      sequence++;
      if (event.aggregateOnly) {
        aggregated++;
        return;
      }
      if (events.length >= 32768) {
        discarded++;
        return;
      }
      const metadata: Record<string, string | number> = { stage };
      if (event.paneId !== undefined) {
        metadata.paneId = event.paneId.slice(0, 128);
      }
      for (const key of [
        "cursor",
        "bytes",
        "geometrySequence",
        "generation",
        "pending",
        "durationMs",
        "cols",
        "rows",
      ] as const) {
        if (event[key] !== undefined && Number.isFinite(event[key])) {
          metadata[key] = event[key]!;
        }
      }
      const monotonicMs = now();
      events.push({
        type: "event",
        pid: process.pid,
        sequence,
        monotonicMs,
        wallMs: performance.timeOrigin + monotonicMs,
        ...metadata,
      });
    },
    flush() {
      const lines: string[] = [];
      let bytes = 0;
      let truncated = 0;
      for (const event of events) {
        const line = JSON.stringify(event) + "\n";
        bytes += Buffer.byteLength(line);
        if (bytes > 16 * 1024 * 1024 - 32768) {
          truncated++;
        } else {
          lines.push(line);
        }
      }
      lines.push(
        JSON.stringify({
          type: "summary",
          pid: process.pid,
          discarded,
          aggregated,
          truncated,
          valid: discarded === 0 && truncated === 0,
          totals,
          highWater,
          memory: process.memoryUsage(),
        }) + "\n",
      );
      try {
        write(lines.join(""));
      } catch {
        // An absent completed footer makes the diagnostic run invalid, not the application.
      }
      events = [];
      discarded = 0;
      aggregated = 0;
      totals = Object.create(null);
      highWater = Object.create(null);
    },
  };
}

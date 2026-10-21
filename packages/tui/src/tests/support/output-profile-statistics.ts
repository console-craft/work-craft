/** Missing observations sort as infinite latency, never disappear from the sample. */
export function latencySummary(samples: (number | null)[]): {
  count: number;
  missing: number;
  p95: number | null;
  p99: number | null;
  max: number | null;
} {
  const ordered = samples.map((value) => value ?? Infinity).toSorted((a, b) => a - b);
  function percentile(fraction: number): number | null {
    const value = ordered[Math.ceil(ordered.length * fraction) - 1];
    return value !== undefined && Number.isFinite(value) ? value : null;
  }
  return {
    count: samples.length,
    missing: samples.filter((value) => value === null).length,
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: percentile(1),
  };
}

export function observedToken(frame: string, cursorVisible: boolean, sequence: number): boolean {
  return cursorVisible && frame.includes(`probe=${sequence};`);
}

/** Remote wall-clock offset is only known to half the round-trip interval. */
export function alignClock(
  sentMs: number,
  receivedMs: number,
  remoteMs: number,
): { offsetMs: number; uncertaintyMs: number } {
  if (receivedMs < sentMs) {
    throw new Error("Invalid clock sample interval");
  }
  return {
    offsetMs: remoteMs - (sentMs + receivedMs) / 2,
    uncertaintyMs: (receivedMs - sentMs) / 2,
  };
}

export function intervalOverlaps(
  first: { start: number; end: number },
  second: { start: number; end: number },
): number {
  if (first.end < first.start || second.end < second.start) {
    throw new Error("Invalid byte interval");
  }
  return Math.max(0, Math.min(first.end, second.end) - Math.max(first.start, second.start));
}

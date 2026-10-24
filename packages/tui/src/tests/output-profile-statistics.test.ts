import { expect, test } from "bun:test";

import {
  alignClock,
  intervalOverlaps,
  latencySummary,
  observedToken,
} from "@/tests/support/output-profile-statistics";

test("missing probes remain failures and nearest-rank latency does not hide them", () => {
  expect(latencySummary([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
    count: 10,
    missing: 0,
    p95: 100,
    p99: 100,
    max: 100,
  });
  expect(latencySummary([10, null])).toEqual({
    count: 2,
    missing: 1,
    p95: null,
    p99: null,
    max: null,
  });
});

test("token observations require the exact sequence and a visible cursor", () => {
  expect(observedToken("probe=12;", true, 12)).toBe(true);
  expect(observedToken("probe=123;", true, 12)).toBe(false);
  expect(observedToken("probe=12;", false, 12)).toBe(false);
});

test("clock alignment reports an interval rather than assuming identical process clocks", () => {
  expect(alignClock(100, 110, 108)).toEqual({ offsetMs: 3, uncertaintyMs: 5 });
  expect(() => alignClock(110, 100, 108)).toThrow();
});

test("byte interval joins tolerate different PTY and WebSocket chunk boundaries", () => {
  expect(intervalOverlaps({ start: 0, end: 10 }, { start: 8, end: 20 })).toBe(2);
  expect(intervalOverlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(0);
  const whole = intervalOverlaps({ start: 0, end: 30 }, { start: 8, end: 20 });
  const split = [0, 10, 20].reduce(
    (n, start) => n + intervalOverlaps({ start, end: start + 10 }, { start: 8, end: 20 }),
    0,
  );
  expect(whole).toBe(12);
  expect(split).toBe(12);
});

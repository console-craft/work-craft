import { expect, test } from "bun:test";

import type { CompactMaterialFrame, MaterialCell, MaterialFrame } from "../terminal-material";
import {
  compactFrame,
  createCompactFrameBuilder,
  validateCompactFrame,
} from "../terminal-material-codec";

const fg: MaterialCell["fg"] = [17 / 255, 34 / 255, 51 / 255, 1];
const bg: MaterialCell["bg"] = [68 / 255, 85 / 255, 102 / 255, 1];
const cursor: MaterialFrame["cursor"] = {
  x: 4,
  y: 0,
  visible: true,
  style: "bar",
  blinking: false,
};
function cell(text: string, width: MaterialCell["width"] = 1, attributes = 13): MaterialCell {
  return { text, width, fg, bg, attributes };
}
const source: MaterialFrame = {
  size: { cols: 7, rows: 2 },
  cursor,
  rows: [
    [cell("λ"), cell("🙂", 2), cell("", 0), cell("e\u0301"), cell(" "), cell(" "), cell(" ", 1, 0)],
    Array.from({ length: 7 }, () => cell(" ")),
  ],
};

function expand(frame: CompactMaterialFrame): MaterialFrame {
  return {
    size: frame.size,
    cursor: frame.cursor,
    rows: frame.rows.map((row) =>
      row.flatMap(([count, text, width, style]) =>
        Array.from({ length: count }, () => ({ text, width, ...frame.styles[style]! })),
      ),
    ),
  };
}

test("compact rows retain styled Unicode wide tails and cursor exactly", () => {
  const frame = compactFrame(source);
  expect(frame.styles).toHaveLength(2);
  expect(frame.rows[0]).toEqual([
    [1, "λ", 1, 0],
    [1, "🙂", 2, 0],
    [1, "", 0, 0],
    [1, "e\u0301", 1, 0],
    [2, " ", 1, 0],
    [1, " ", 1, 1],
  ]);
  expect(frame.rows[1]).toEqual([[7, " ", 1, 0]]);
  expect(expand(validateCompactFrame(frame))).toEqual(source);
});

test("equal style references share values without merging distinct colors", () => {
  const frame = compactFrame({
    size: { cols: 3, rows: 1 },
    cursor: { ...cursor, x: 0 },
    rows: [[cell("X"), { ...cell("X"), fg: [0, 0, 0, 1] }, { ...cell("X"), bg: [0, 0, 0, 1] }]],
  });
  expect(frame.styles).toHaveLength(3);
  expect(frame.rows[0]).toHaveLength(3);
  expect(expand(frame).rows[0]![1]!.fg).toEqual([0, 0, 0, 1]);
  expect(expand(frame).rows[0]![2]!.bg).toEqual([0, 0, 0, 1]);
});

test("invalid compact dimensions references counts and colors reject before drawing", () => {
  const good: CompactMaterialFrame = {
    size: { cols: 1, rows: 1 },
    cursor: { ...cursor, x: 0 },
    styles: [{ fg, bg, attributes: 0 }],
    rows: [[[1, "x", 1, 0]]],
  };
  const cases: unknown[] = [
    null,
    {},
    { ...good, size: { cols: 4097, rows: 1 } },
    { ...good, size: { cols: 4096, rows: 4096 } },
    { ...good, size: { cols: 0, rows: 1 } },
    { ...good, cursor: { ...good.cursor, x: 1 } },
    { ...good, cursor: { ...good.cursor, style: "other" } },
    { ...good, styles: [{ fg: [NaN, 0, 0, 1], bg, attributes: 0 }] },
    { ...good, styles: [{ fg: [2, 0, 0, 1], bg, attributes: 0 }] },
    { ...good, styles: [{ fg, bg, attributes: -1 }] },
    { ...good, rows: [] },
    ...[-1, 0, 0.5, Number.MAX_SAFE_INTEGER].map((count) => ({
      ...good,
      rows: [[[count, "x", 1, 0]]],
    })),
    { ...good, rows: [[[1, "x", 1, 1]]] },
    { ...good, rows: [[[1, "x", 1, -1]]] },
    { ...good, rows: [[[2, "x", 1, 0]]] },
    { ...good, rows: [[[1, "x", 3, 0]]] },
    { ...good, rows: [[[1, "", 0, 0]]] },
    { ...good, rows: [[[1, "🙂", 2, 0]]] },
    { ...good, rows: [[[1, "\n", 1, 0]]] },
    { ...good, rows: [[[1, "", 1, 0]]] },
  ];
  for (const frame of cases) {
    expect(() => validateCompactFrame(frame)).toThrow();
  }
});

test("large repeated material stays compact at maximum supported cell count", () => {
  const builder = createCompactFrameBuilder({ cols: 4096, rows: 256 }, { ...cursor, x: 0 });
  const row = Array.from({ length: 4096 }, () => cell(" "));
  for (let y = 0; y < 256; y++) {
    builder.addRow(row);
  }
  const frame = validateCompactFrame(builder.finish());
  expect(frame.rows).toHaveLength(256);
  expect(frame.rows.every((row) => row.length === 1 && row[0]![0] === 4096)).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(10000);
});

test("decoded text and serialized palette budgets reject without expansion", () => {
  const good = {
    size: { cols: 4096, rows: 1 },
    cursor: { ...cursor, x: 0 },
    styles: [{ fg, bg, attributes: 0 }],
  };
  expect(() => validateCompactFrame({ ...good, rows: [[[4096, "x".repeat(4096), 1, 0]]] })).toThrow(
    "budget",
  );
  const builder = createCompactFrameBuilder({ cols: 1, rows: 1 }, { ...cursor, x: 0 });
  expect(() => builder.addRow([cell("x".repeat(8388609))])).toThrow("budget");
  const varied = createCompactFrameBuilder({ cols: 512, rows: 512 }, { ...cursor, x: 0 });
  expect(() => {
    for (let y = 0; y < 512; y++) {
      varied.addRow(
        Array.from({ length: 512 }, (_, x) => {
          const n = y * 512 + x;
          return {
            ...cell("x"),
            fg: [
              (n & 255) / 255,
              ((n >>> 8) & 255) / 255,
              (n >>> 16) / 255,
              1,
            ] as MaterialCell["fg"],
          };
        }),
      );
    }
    varied.finish();
  }).toThrow("budget");
});

test("incremental native rows must match declared geometry", () => {
  const builder = createCompactFrameBuilder({ cols: 2, rows: 1 }, { ...cursor, x: 0 });
  expect(() => builder.addRow([cell("x")])).toThrow();
  expect(() => compactFrame({ ...source, rows: source.rows.slice(0, 1) })).toThrow();
});

test("cell text must be one grapheme with the declared display width", () => {
  const good: CompactMaterialFrame = {
    size: { cols: 2, rows: 1 },
    cursor: { ...cursor, x: 0 },
    styles: [{ fg, bg, attributes: 0 }],
    rows: [
      [
        [1, "x", 1, 0],
        [1, "Z", 1, 0],
      ],
    ],
  };
  for (const text of ["ab", "🙂", "\u0301"]) {
    expect(() =>
      validateCompactFrame({
        ...good,
        rows: [
          [
            [1, text, 1, 0],
            [1, "Z", 1, 0],
          ],
        ],
      }),
    ).toThrow();
  }
  expect(() =>
    validateCompactFrame({
      ...good,
      rows: [
        [
          [1, "ab", 2, 0],
          [1, "", 0, 0],
        ],
      ],
    }),
  ).toThrow();
  expect(
    validateCompactFrame({
      ...good,
      rows: [
        [
          [1, "e\u0301", 1, 0],
          [1, "Z", 1, 0],
        ],
      ],
    }).rows[0]![1]![1],
  ).toBe("Z");
});

test("unknown frame fields reject before serializing unbounded values", () => {
  const good: CompactMaterialFrame = {
    size: { cols: 1, rows: 1 },
    cursor: { ...cursor, x: 0 },
    styles: [{ fg, bg, attributes: 0 }],
    rows: [[[1, "x", 1, 0]]],
  };
  let serialized = 0;
  const oversized = {
    toJSON() {
      serialized++;
      return "x".repeat(16777216);
    },
  };
  for (const value of [
    { ...good, unknown: oversized },
    { ...good, size: { ...good.size, unknown: oversized } },
    { ...good, cursor: { ...good.cursor, unknown: oversized } },
    { ...good, styles: [{ ...good.styles[0], unknown: oversized }] },
  ]) {
    expect(() => validateCompactFrame(value)).toThrow("Unexpected");
  }
  expect(serialized).toBe(0);
});

test("native regional-indicator slots require a wide head and an empty tail", () => {
  const frame: CompactMaterialFrame = {
    size: { cols: 2, rows: 1 },
    cursor: { ...cursor, x: 0 },
    styles: [{ fg, bg, attributes: 0 }],
    rows: [
      [
        [1, "🇦", 2, 0],
        [1, "", 0, 0],
      ],
    ],
  };
  expect(validateCompactFrame(frame).rows[0]).toEqual([
    [1, "🇦", 2, 0],
    [1, "", 0, 0],
  ]);
  expect(() =>
    validateCompactFrame({
      ...frame,
      rows: [
        [
          [1, "🇦", 1, 0],
          [1, " ", 1, 0],
        ],
      ],
    }),
  ).toThrow("width");
  expect(() =>
    validateCompactFrame({
      ...frame,
      rows: [
        [
          [1, "🇦🇧", 2, 0],
          [1, "", 0, 0],
        ],
      ],
    }),
  ).not.toThrow();
});

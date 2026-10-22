import { expect, test } from "bun:test";

import { createProjectionFixture } from "./projection-fixture.ts";

const encode = (text: string) => new TextEncoder().encode(text);

test("resolved Unicode cells are plain material values with explicit wide continuations", () => {
  const fixture = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    fixture.write(encode("λ🙂e\u0301"));
    const frame = JSON.parse(JSON.stringify(fixture.frame(0)));
    expect(
      frame.rows[0]
        .slice(0, 4)
        .map(({ text, width }: { text: string; width: number }) => ({ text, width })),
    ).toEqual([
      { text: "λ", width: 1 },
      { text: "🙂", width: 2 },
      { text: "", width: 0 },
      { text: "e\u0301", width: 1 },
    ]);
    expect(frame.rows[0][0].fg).toEqual([1, 1, 1, 1]);
    expect(frame.rows[0][0].bg).toEqual([0, 0, 0, 1]);
  } finally {
    fixture.destroy();
  }
});

test("styled blank cells and cursor shape survive material extraction", () => {
  const fixture = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    fixture.write(encode("\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102m \x1b[6 q"));
    const frame = fixture.frame(0);
    expect(frame.rows[0]![0]).toMatchObject({
      text: " ",
      width: 1,
      attributes: 13,
      fg: [17 / 255, 34 / 255, 51 / 255, 1],
      bg: [68 / 255, 85 / 255, 102 / 255, 1],
    });
    expect(frame.cursor).toEqual({ x: 1, y: 0, visible: true, style: "bar", blinking: false });
  } finally {
    fixture.destroy();
  }
});

test("one viewer scrolls without changing another viewer or parser input modes", () => {
  const fixture = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    fixture.write(encode("\x1b[?1h\x1b[?2004h0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6"));
    const atZero = fixture.frame(0);
    expect(fixture.frame(3).rows[0]![0]!.text).toBe("1");
    expect(fixture.frame(0)).toEqual(atZero);
    fixture.frame(3);
    fixture.write(encode("\r\n7"));
    expect(fixture.frame(0).rows[2]![0]!.text).toBe("7");
    expect(
      new TextDecoder().decode(fixture.encode({ kind: "key", key: { key: "arrow_up" } })),
    ).toBe("\x1bOA");
    expect(
      new TextDecoder().decode(fixture.encode({ kind: "paste", bytes: [112, 97, 115, 116, 101] })),
    ).toBe("\x1b[200~paste\x1b[201~");
  } finally {
    fixture.destroy();
  }
});

const hyperlinkTest = process.env.WORK_CRAFT_FORK_LINK_DIAGNOSTICS === "1" ? test : test.skip;
hyperlinkTest("OSC8 hyperlink cells expose a resolved URL rather than a native link ID", () => {
  const fixture = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    fixture.write(encode("\x1b]8;;https://example.test/λ\x1b\\L\x1b]8;;\x1b\\"));
    expect(fixture.frame(0).rows[0]![0]).toMatchObject({
      text: "L",
      link: "https://example.test/λ",
    });
  } finally {
    fixture.destroy();
  }
});

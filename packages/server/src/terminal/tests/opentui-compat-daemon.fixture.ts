import { expect, test } from "bun:test";

import { createProjectionFixture } from "./projection-fixture";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("headless material preserves both styled cells of invisible wide text without hyperlinks", async () => {
  const parser = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    parser.write(encode("\x1b[1;8;48;2;68;85;102m界\x1b[0mN"));
    const cells = parser.frame(0).rows[0]!.slice(0, 3);
    await Bun.write("daemon-material-observation.json", JSON.stringify(cells, null, 2));
    expect(cells.map(({ text }) => text)).toEqual([" ", " ", "N"]);
    expect(cells.map(({ attributes }) => attributes)).toEqual([65, 65, 0]);
    expect(cells[0]!.bg).toEqual([68 / 255, 85 / 255, 102 / 255, 1]);
    expect(cells[1]!.bg).toEqual([68 / 255, 85 / 255, 102 / 255, 1]);
  } finally {
    parser.destroy();
  }
});

test("late viewer retains runtime paste mode after raw tail rollover", () => {
  const parser = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    parser.write(encode("\x1b[?2004h\x1b[?1h"));
    const chunk = encode("\x1b[H".repeat(2048));
    for (let bytes = 0; bytes <= 1048576; bytes += chunk.byteLength) {
      parser.write(chunk);
    }
    parser.write(encode("same visible screen"));
    expect(
      parser
        .frame(0)
        .rows.flat()
        .map(({ text }) => text)
        .join(""),
    ).toContain("same visible");
    expect(decode(parser.encode({ kind: "paste", bytes: [120] }))).toBe("\x1b[200~x\x1b[201~");
    expect(decode(parser.encode({ kind: "key", key: { key: "arrow_up" } }))).toBe("\x1bOA");
  } finally {
    parser.destroy();
  }
});

test("viewer browsing does not move another frame or change input modes", () => {
  const parser = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    parser.write(encode("\x1b[?2004h0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6"));
    const live = parser.frame(0);
    expect(parser.frame(3).rows[0]![0]!.text).toBe("1");
    expect(parser.frame(0)).toEqual(live);
    expect(decode(parser.encode({ kind: "paste", bytes: [120] }))).toBe("\x1b[200~x\x1b[201~");
  } finally {
    parser.destroy();
  }
});

test("two viewers cannot duplicate one hidden runtime reply", () => {
  const parser = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    parser.write(encode("\x1b[5n"));
    expect(decode(parser.replies())).toBe("\x1b[0n");
    parser.frame(0);
    parser.frame(0);
    expect(parser.replies()).toHaveLength(0);
  } finally {
    parser.destroy();
  }
});

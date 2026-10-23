import { expect, spyOn, test } from "bun:test";

import { resolveRenderLib } from "@opentui/core";

import type { TerminalSize } from "../../api/protocol";
import type { CompactMaterialFrame } from "../../api/terminal-material";
import type { HistoryReplay } from "../history";
import { createTerminalProjection, type TerminalProjection } from "../projection";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const size = { cols: 20, rows: 5 };

function history(text: string, grid = size): HistoryReplay {
  const data = encode(text);
  return {
    paneId: "p",
    data,
    cursor: data.length,
    startCursor: 0,
    prefixBytes: 0,
    truncated: false,
    initialSize: grid,
    initialGridSequence: null,
    resizes: [],
    starts: [],
  };
}

function text(frame: CompactMaterialFrame): string {
  return frame.rows
    .map((row) => row.map(([n, value, width]) => (width ? value.repeat(n) : "")).join(""))
    .join("\n");
}

async function restore(
  retained: HistoryReplay,
  grid: TerminalSize = size,
): Promise<TerminalProjection> {
  const { restoreColdProjection } = await import("../cold-history");
  return restoreColdProjection(retained, grid);
}

test("cold history restores multiple screens and the restart separator", async () => {
  const old = Array.from({ length: 80 }, (_, i) => `ROW${String(i).padStart(3, "0")}`).join("\r\n");
  const retained = history(old + "\r\n[restart]\r\nFRESH");
  retained.starts = [
    { ...size, cursor: 0, sequence: 1, runtimeStart: "fresh" },
    { ...size, cursor: encode(old).length, sequence: 2, runtimeStart: "restored" },
  ];
  retained.resizes = retained.starts.map(({ runtimeStart: _, ...marker }) => marker);
  const parser = await restore(retained);
  try {
    expect(text(parser.frame(0))).toContain("FRESH");
    expect(text(parser.frame(0)).split("[restart]")).toHaveLength(2);
    const pages = Array.from({ length: 20 }, (_, i) => text(parser.frame(i * 5))).join("\n");
    for (const marker of ["ROW000", "ROW040", "ROW079"]) {
      expect(pages).toContain(marker);
    }
  } finally {
    parser.destroy();
  }
});

test("cold replay never gives historical modes or replies to a fresh parser", async () => {
  const retained = history(
    "\x1b[?1049h\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[>1u\x1b[2;4r\x1b[?6h\x1b[6 qOLD\x1b[5n\x1b[6n\x1b[?25l",
  );
  const parser = await restore(retained);
  try {
    expect(decode(parser.encode({ kind: "key", key: { key: "arrow_up" } }))).toBe("\x1b[A");
    expect(decode(parser.encode({ kind: "paste", bytes: [120] }))).toBe("x");
    expect(
      parser.encode({ kind: "mouse", mouse: { action: "press", button: "left", x: 0, y: 0 } }),
    ).toHaveLength(0);
    expect(parser.encode({ kind: "focus", focused: true })).toHaveLength(0);
    expect(parser.replies()).toHaveLength(0);
    expect(parser.frame(0).cursor).toMatchObject({
      visible: true,
      style: "block",
      blinking: false,
    });
    parser.write(encode("\x1b[5n"));
    expect(decode(parser.replies())).toBe("\x1b[0n");
    expect(parser.replies()).toHaveLength(0);
  } finally {
    parser.destroy();
  }
});

test("capture preserves styled blanks and glyph columns below a saved cursor", async () => {
  const source = createTerminalProjection(size);
  const restored = createTerminalProjection(size);
  try {
    source.write(
      encode(
        "\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102mλ🙂é \x1b[0m\x1b[1;7H🇯\x1b[1;9H🇵Z\x1b[4;2H\x1b[48;2;51;68;85m \x1b[0m\x1b[1;1H",
      ),
    );
    const before = source.frame(0);
    expect(before.rows[0]!.slice(0, 4).map((run) => [run[1], run[2]])).toEqual([
      ["λ", 1],
      ["🙂", 2],
      ["", 0],
      ["é", 1],
    ]);
    const transcript = await source.takeDisplayTranscript("preserve");
    restored.write(transcript);
    expect(restored.frame(0)).toEqual(before);
    expect(restored.replies()).toHaveLength(0);
    expect(() => source.frame(0)).toThrow();
  } finally {
    source.destroy();
    restored.destroy();
  }
});

test("capture preserves resolved inverse foregrounds and styled blanks", async () => {
  const source = createTerminalProjection(size);
  const restored = createTerminalProjection(size);
  try {
    source.write(encode("\x1b[7mTEXT \x1b[0m"));
    const before = source.frame(0);
    restored.write(await source.takeDisplayTranscript("preserve"));
    expect(restored.frame(0)).toEqual(before);
  } finally {
    source.destroy();
    restored.destroy();
  }
});

test("capture near the right margin never pushes duplicate rows into history", async () => {
  for (const width of [19, 20]) {
    for (const suffix of [
      new Uint8Array(),
      encode("\x1b["),
      encode("\x1b]2;pending"),
      Uint8Array.of(0xf0, 0x9f),
    ]) {
      const source = createTerminalProjection(size);
      const restored = createTerminalProjection(size);
      const lines = Array.from(
        { length: 12 },
        (_, i) => `ROW-${String(i).padStart(3, "0")}${"x".repeat(width - 7)}`,
      );
      try {
        source.write(encode(lines.join("\r\n")));
        source.write(suffix);
        expect(
          text(source.frame(1))
            .split("\n")
            .map((row) => row.slice(0, 7)),
        ).toEqual(["ROW-006", "ROW-007", "ROW-008", "ROW-009", "ROW-010"]);
        const transcript = await source.takeDisplayTranscript("preserve");
        restored.write(transcript);
        for (let offset = 0; offset <= 7; offset++) {
          expect(
            text(restored.frame(offset))
              .split("\n")
              .map((row) => row.trimEnd()),
          ).toEqual(lines.slice(7 - offset, 12 - offset));
        }
      } finally {
        source.destroy();
        restored.destroy();
      }
    }
  }
});

test("identical history rows are not mistaken for the beginning of scrollback", async () => {
  const parser = await restore(history(["FIRST", ...Array(500).fill("same"), "LAST"].join("\r\n")));
  try {
    expect(text(parser.frame(0))).toContain("LAST");
    expect(
      text(parser.frame(250))
        .split("\n")
        .every((row) => row.trim() === "same"),
    ).toBe(true);
    expect(text(parser.frame(497)).split("\n")[0]!.trim()).toBe("FIRST");
  } finally {
    parser.destroy();
  }
});

test("capture retains scrollback when a fresh generation has moved its cursor to the top", async () => {
  const retained = history(
    Array.from({ length: 60 }, (_, i) => `TOP-${i}`).join("\r\n") + "\x1b[HNOW",
  );
  const parser = await restore(retained);
  try {
    expect(text(parser.frame(0))).toContain("NOW");
    expect(text(parser.frame(10000))).toContain("TOP-0");
  } finally {
    parser.destroy();
  }
});

for (const [name, suffix] of [
  ["CSI", encode("\x1b[")],
  ["OSC", encode("\x1b]2;ignored\r\n[work-craft: daemon restarted; shell restored]\r\nIGNORED")],
  ["UTF-8", Uint8Array.of(0xf0, 0x9f)],
] as const) {
  test(`runtime starts reset partial ${name} without trusting separator text`, async () => {
    const old = Buffer.concat([encode("OLD\r\n"), suffix]);
    const retained = history("");
    retained.data = Buffer.concat([old, encode("31mNEW")]);
    retained.cursor = retained.data.length;
    retained.starts = [{ ...size, cursor: old.length, sequence: 1, runtimeStart: "fresh" }];
    retained.resizes = [{ ...size, cursor: old.length, sequence: 1 }];
    const parser = await restore(retained);
    try {
      const visible = text(parser.frame(0));
      expect(visible).toContain("31mNEW");
      expect(visible).not.toContain("IGNORED");
      expect(visible).not.toContain("�");
      expect(parser.replies()).toHaveLength(0);
    } finally {
      parser.destroy();
    }
  });
}

test("byte truncation prefix stays outside raw cursor/resize accounting", async () => {
  const prefix = encode("\x1bc\r\n[work-craft: earlier terminal output truncated]\r\n");
  const retained = history("TAIL", { cols: 80, rows: 5 });
  retained.data = Buffer.concat([prefix, retained.data]);
  retained.prefixBytes = prefix.length;
  retained.startCursor = 400;
  retained.cursor = 404;
  retained.truncated = true;
  retained.initialSize = null;
  retained.resizes = [{ cols: 80, rows: 5, cursor: 402, sequence: 9 }];
  const parser = await restore(retained, { cols: 80, rows: 5 });
  try {
    expect(text(parser.frame(0))).toContain("earlier terminal output truncated");
    expect(text(parser.frame(0))).toContain("TAIL");
    expect(parser.replies()).toHaveLength(0);
  } finally {
    parser.destroy();
  }
});

for (const kind of ["native cells", "transcript bytes"] as const) {
  test(`over-budget ${kind} capture rejects and releases native ownership`, async () => {
    const lib = resolveRenderLib();
    const create = spyOn(lib, "createContext");
    const destroy = spyOn(lib, "destroyContext");
    const source = createTerminalProjection({
      cols: 4096,
      rows: kind === "native cells" ? 512 : 256,
    });
    try {
      source.write(
        encode(
          kind === "native cells" ? "\n".repeat(600) : "x" + "\x1b[65535b".repeat(20) + "\x1b[0m",
        ),
      );
      await expect(source.takeDisplayTranscript("preserve")).rejects.toThrow(/budget/i);
      expect(() => source.frame(0)).toThrow();
      expect(create.mock.calls.length).toBe(1);
      expect(destroy.mock.calls.length).toBe(1);
    } finally {
      source.destroy();
      create.mockRestore();
      destroy.mockRestore();
    }
  });
}

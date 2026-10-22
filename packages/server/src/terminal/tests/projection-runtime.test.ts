import { expect, spyOn, test } from "bun:test";

import { createTerminalProjection } from "../projection";
import { RuntimeRegistry } from "../runtime";

test("query replies never advertise resize reports the native parser does not emit", () => {
  const parser = createTerminalProjection({ cols: 80, rows: 24 });
  try {
    parser.write(new TextEncoder().encode("\x1b[?2048$p\x1b[?2048h\x1b[?2048$p\x1b[5n"));
    expect(new TextDecoder().decode(parser.replies())).toBe("\x1b[?2048;0$y\x1b[?2048;0$y\x1b[0n");
    expect(parser.replies()).toHaveLength(0);
  } finally {
    parser.destroy();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Runtime projection did not settle");
    }
    await Bun.sleep(5);
  }
}

test("real runtime material preserves Unicode styles and ordered canonical resize", async () => {
  let output = "";
  const registry = new RuntimeRegistry({
    onStatus() {},
    onOutput(_id, bytes) {
      output += new TextDecoder().decode(bytes);
    },
  });
  try {
    await registry.start(
      {
        id: "p",
        cwd: process.cwd(),
        restorePolicy: {
          type: "shell",
          executable: "/bin/sh",
          args: [
            "-c",
            "stty raw -echo; printf 'λ🙂é\\033[1;3;4;38;2;17;34;51;48;2;68;85;102m \\033[6 q'; sleep 60",
          ],
        },
      },
      { cols: 12, rows: 3 },
    );
    await waitFor(() => output.includes("6 q"));
    const first = registry.material("p", 0);
    expect(first.frame.rows[0]!.slice(0, 4).map((run) => [run[1], run[2]])).toEqual([
      ["λ", 1],
      ["🙂", 2],
      ["", 0],
      ["é", 1],
    ]);
    expect(first.frame.cursor).toMatchObject({ x: 5, y: 0, style: "bar", visible: true });
    expect(first.frame.styles).toContainEqual({
      fg: [17 / 255, 34 / 255, 51 / 255, 1],
      bg: [68 / 255, 85 / 255, 102 / 255, 1],
      attributes: 13,
    });
    expect(first.frame.styles[0]!.bg[3]).toBe(0);
    registry.resize("p", 20, 5);
    const resized = registry.material("p", 0);
    expect(resized.frame.size).toEqual({ cols: 20, rows: 5 });
    expect(resized.sequence).toBeGreaterThan(first.sequence);
  } finally {
    await registry.stopAll();
  }
});

test("material reads never duplicate the daemon's single native query reply", async () => {
  let output = "";
  const registry = new RuntimeRegistry({
    onStatus() {},
    onOutput(_id, bytes) {
      output += new TextDecoder().decode(bytes);
    },
  });
  const write = spyOn(Bun.Terminal.prototype, "write");
  try {
    await registry.start({
      id: "p",
      cwd: process.cwd(),
      restorePolicy: {
        type: "shell",
        executable: "/bin/sh",
        args: ["-c", "stty raw -echo; printf 'READY\\033[5n'; sleep 60"],
      },
    });
    await waitFor(() => output.includes("5n"));
    registry.material("p", 0);
    registry.material("p", 0);
    expect(
      write.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array)),
    ).toEqual(["\x1b[0n"]);
  } finally {
    write.mockRestore();
    await registry.stopAll();
  }
});

test("a fresh runtime never encodes input with the previous child's modes", async () => {
  let output = "";
  const registry = new RuntimeRegistry({
    onStatus() {},
    onOutput(_id, bytes) {
      output += new TextDecoder().decode(bytes);
    },
  });
  try {
    await registry.start({
      id: "p",
      cwd: process.cwd(),
      restorePolicy: {
        type: "shell",
        executable: "/bin/sh",
        args: ["-c", "printf '\\033[?1h\\033[?2004hOLD'"],
      },
    });
    await registry.waitForExit("p");
    expect(registry.material("p", 0).frame.rows[0]!.some((run) => run[1] === "O")).toBe(true);
    output = "";
    await registry.start({
      id: "p",
      cwd: process.cwd(),
      restorePolicy: {
        type: "shell",
        executable: "/bin/sh",
        args: ["-c", "stty raw -echo; printf READY; dd bs=1 count=3 2>/dev/null | od -An -tx1"],
      },
    });
    await waitFor(() => output.includes("READY"));
    await registry.writeSemantic("p", { kind: "key", key: { key: "arrow_up" } });
    await registry.waitForExit("p");
    expect(output).toMatch(/1b\s+5b\s+41/);
    await registry.stopAll();
    expect(() => registry.material("p", 0)).toThrow();
  } finally {
    await registry.stopAll();
  }
});

test("real native input keeps its charge until PTY drain and rejects oversize without truncation", async () => {
  let output = "";
  const registry = new RuntimeRegistry({
    onStatus() {},
    onOutput(_id, bytes) {
      output += new TextDecoder().decode(bytes);
    },
  });
  let pending: Promise<unknown> | undefined;
  try {
    await registry.start({
      id: "p",
      cwd: process.cwd(),
      restorePolicy: {
        type: "shell",
        executable: "/bin/sh",
        args: ["-c", "stty raw -echo; printf READY; sleep 60"],
      },
    });
    await waitFor(() => output.includes("READY"));
    await expect(registry.writeSemantic("p", new Uint8Array(1048577).fill(120))).rejects.toThrow(
      "InvalidArgument",
    );
    expect(registry.inputPending("p")).toBe(false);
    pending = registry
      .writeSemantic("p", new Uint8Array(1048576).fill(120))
      .catch((error) => error);
    await Bun.sleep(20);
    expect(registry.inputPending("p")).toBe(true);
    await expect(registry.writeSemantic("p", { kind: "key", key: { text: "x" } })).rejects.toThrow(
      "flight",
    );
    await registry.stopAll();
    expect(await pending).toBeInstanceOf(Error);
    expect(registry.inputPending("p")).toBe(false);
  } finally {
    await registry.stopAll();
    await pending;
  }
});

test("a runtime created at a small grid can grow to a supported compact large grid", async () => {
  const registry = new RuntimeRegistry({ onStatus() {}, onOutput() {} });
  try {
    await registry.start(
      {
        id: "p",
        cwd: process.cwd(),
        restorePolicy: { type: "shell", executable: "/bin/sh", args: ["-c", "sleep 60"] },
      },
      { cols: 12, rows: 3 },
    );
    registry.resize("p", 512, 512);
    const frame = registry.material("p", 0).frame;
    expect(frame.size).toEqual({ cols: 512, rows: 512 });
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(10000);
  } finally {
    await registry.stopAll();
  }
});

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmbeddedTerminalRenderable, KeyEvent, MouseEvent, parseKeypress } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { projectionInputQueue } from "@/workbench/tests/no-fork-input-queue";
import { NoForkMaterialView } from "@/workbench/tests/no-fork-material-view";

// oxlint-disable-next-line no-restricted-imports -- Test-only plain reference expansion.
import { compactFrame } from "../../../../../scripts/test-support/terminal-projection-codec";
// oxlint-disable-next-line no-restricted-imports -- Test-only wire sender.
import { sendProjectionInput } from "../../../../../scripts/test-support/terminal-projection-paste";
// oxlint-disable-next-line no-restricted-imports -- Test-only plain material DTO.
import type {
  CompactMaterialFrame,
  MaterialCell,
  MaterialFrame,
  PasteMessage,
  ProjectionInput,
  ProjectionStamp,
  SemanticInput,
} from "../../../../../scripts/test-support/terminal-projection-types";

type RuntimeState = {
  stamp: ProjectionStamp;
  sequence: number;
  ready: boolean;
  pid: number;
  bytes: number;
  input: number[];
  inputBytes: number;
  inputFrontier: number;
  inputHash: string;
  frame: CompactMaterialFrame;
};

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) {
      return value;
    }
    await Bun.sleep(10);
  }
  throw new Error("Owned fixture did not acknowledge the required state");
}

async function runtime() {
  const directory = await mkdtemp(join(import.meta.dir, "roundtrip-"));
  // macOS Unix sockets cannot use the long retained-evidence path.
  const socketDirectory = await mkdtemp(join(tmpdir(), "nf-"));
  const socket = join(socketDirectory, "runtime.sock");
  const fd = openSync(join(directory, "runtime.log"), "wx");
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "runtime.js"),
      "serve",
      socket,
      join(directory, "program-input.jsonl"),
    ],
    { stdin: "ignore", stdout: fd, stderr: fd },
  );
  closeSync(fd);
  let maxInputRequestBytes = 0;
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (path === "/input" && serialized !== undefined) {
      maxInputRequestBytes = Math.max(maxInputRequestBytes, Buffer.byteLength(serialized));
    }
    const response = await fetch(`http://fixture${path}`, {
      unix: socket,
      signal,
      ...(serialized === undefined ? {} : { method: "POST", body: serialized }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }
  async function close(): Promise<void> {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    await child.exited;
    await rm(socketDirectory, { recursive: true, force: true });
  }
  try {
    const initial = await waitFor(
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`Runtime exited before binding ${socket}`);
        }
        try {
          return await request<RuntimeState>("/state");
        } catch {
          return null;
        }
      },
      (state) => state?.ready === true,
    );
    return {
      directory,
      close,
      runtimePid: child.pid,
      maxInputRequestBytes: () => maxInputRequestBytes,
      state: (offset = 0) => request<RuntimeState>(`/state?offset=${offset}`),
      output: (text: string) =>
        request<void>("/output", { bytes: [...new TextEncoder().encode(text)] }),
      outputBytes: (bytes: Uint8Array) => request<void>("/output", { bytes: [...bytes] }),
      exitProgram: () => request<void>("/exit", {}),
      input: (input: SemanticInput) =>
        sendProjectionInput({ stamp: initial!.stamp, input }, (message, signal) =>
          request<{ stale?: boolean }>("/input", message, signal),
        ),
      sendInput: (input: SemanticInput) =>
        request<{ forwarded: boolean }>("/input", { stamp: initial!.stamp, input }),
      rawInput: (event: ProjectionInput, signal?: AbortSignal) =>
        event.input.kind === "paste"
          ? sendProjectionInput(
              event,
              (message, currentSignal) =>
                request<{ stale?: boolean }>("/input", message, currentSignal),
              signal,
            )
          : request<void>("/input", event, signal),
      wireInput: (message: ProjectionInput | PasteMessage) =>
        request<{ forwarded?: boolean }>("/input", message),
      revoke: (field: keyof ProjectionStamp) => request<void>("/revoke", { field }),
      resize: (cols: number, rows: number) => request<void>("/resize", { cols, rows }),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function material(output: string): MaterialFrame {
  const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "runtime.js"), output], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ code: child.exitCode, error: child.stderr.toString() }).toEqual({ code: 0, error: "" });
  return JSON.parse(child.stdout.toString());
}

function smallRow(frame: CompactMaterialFrame): MaterialCell[] {
  if (frame.size.cols * frame.size.rows > 10000) {
    throw new Error("Reference expansion is small-frame only");
  }
  return frame.rows[0]!.flatMap(([count, text, width, style]) =>
    Array.from({ length: count }, () => ({ text, width, ...frame.styles[style]! })),
  );
}

test("research-only exception records upstream invisible-wide second-cell styling loss", () => {
  const cells = material("\x1b[1;8;48;2;68;85;102m界\x1b[0mN").rows[0]!.slice(0, 3);
  expect(cells.map(({ text }) => text)).toEqual([" ", " ", "N"]);
  // Accepted for research only; the original daemon fidelity assertion remains red.
  expect(cells.map(({ attributes }) => attributes)).toEqual([65, 0, 0]);
  expect(cells[0]!.bg).toEqual([68 / 255, 85 / 255, 102 / 255, 1]);
  expect(cells[1]!.bg).toEqual([0, 0, 0, 1]);
});

test("ordinary Unicode styled blanks and cursor remain required outside that exception", () => {
  const frame = material("λ🙂e\u0301\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102m \x1b[6 q");
  expect(frame.rows[0]!.slice(0, 4).map(({ text, width }) => ({ text, width }))).toEqual([
    { text: "λ", width: 1 },
    { text: "🙂", width: 2 },
    { text: "", width: 0 },
    { text: "e\u0301", width: 1 },
  ]);
  expect(frame.rows[0]![4]).toMatchObject({
    text: " ",
    width: 1,
    attributes: 13,
    fg: [17 / 255, 34 / 255, 51 / 255, 1],
    bg: [68 / 255, 85 / 255, 102 / 255, 1],
  });
  expect(frame.cursor).toEqual({ x: 5, y: 0, visible: true, style: "bar", blinking: false });
});

test("two independent views render one live PTY", async () => {
  const live = await runtime();
  const a = await createTestRenderer({ width: 12, height: 3 });
  const b = await createTestRenderer({ width: 20, height: 5 });
  try {
    const before = await live.state();
    await live.output("λ🙂e\u0301\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102m \x1b[6 q");
    const state = await live.state();
    for (const setup of [a, b]) {
      const view = new NoForkMaterialView(setup.renderer, JSON.parse(JSON.stringify(state.frame)));
      setup.renderer.root.add(view);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("λ🙂e\u0301");
      expect(setup.renderer.getCursorState()).toMatchObject({
        x: 6,
        y: 1,
        visible: true,
        style: "line",
      });
      const styled = setup.captureSpans().lines[0]!.spans.find((span) => span.attributes === 13)!;
      expect(styled.fg.toInts()).toEqual([17, 34, 51, 255]);
      expect(styled.bg.toInts()).toEqual([68, 85, 102, 255]);
    }
    expect((await live.state()).pid).toBe(before.pid);
    expect(state.frame.size).toEqual({ cols: 12, rows: 3 });
  } finally {
    await a.dispose();
    await b.dispose();
    await live.close();
  }
});

test("late viewer keeps modes after raw output rollover", async () => {
  const live = await runtime();
  try {
    const pid = (await live.state()).pid;
    await live.output("\x1b[?1h\x1b[?2004h");
    const output = "\x1b[H".repeat(2048);
    for (let bytes = 0; bytes <= 1048576; bytes += Buffer.byteLength(output)) {
      await live.output(output);
    }
    const state = await live.state();
    expect(state.bytes).toBeGreaterThan(1048576);
    const late = await createTestRenderer({ width: 20, height: 5 });
    try {
      late.renderer.root.add(new NoForkMaterialView(late.renderer, state.frame));
      await late.flush();
      await live.input({ kind: "key", key: { key: "arrow_up" } });
      await live.input({ kind: "paste", bytes: [120] });
      const received = await waitFor(live.state, (value) => value.input.length >= 16);
      expect(new TextDecoder().decode(new Uint8Array(received.input))).toBe(
        "\x1bOA\x1b[200~x\x1b[201~",
      );
      expect(received.pid).toBe(pid);
    } finally {
      await late.dispose();
    }
  } finally {
    await live.close();
  }
});

test("two viewers never duplicate a child query response", async () => {
  const live = await runtime();
  try {
    await live.output("\x1b[5n");
    const first = await waitFor(live.state, (state) => state.input.length >= 4);
    const a = await live.state();
    const b = await live.state(1);
    expect(a.pid).toBe(b.pid);
    expect(new TextDecoder().decode(new Uint8Array(first.input))).toBe("\x1b[0n");
    expect((await live.state()).input).toEqual(first.input);
  } finally {
    await live.close();
  }
});

test("partial UTF8 CSI and long OSC8 repaint remain ordinary material", async () => {
  const live = await runtime();
  try {
    const bytes = new TextEncoder().encode("λ🙂e\u0301\x1b[1;3;4mZ");
    for (const byte of bytes) {
      await live.outputBytes(new Uint8Array([byte]));
    }
    expect(
      smallRow((await live.state()).frame)
        .slice(0, 5)
        .map(({ text }) => text),
    ).toEqual(["λ", "🙂", "", "e\u0301", "Z"]);
    expect(smallRow((await live.state()).frame)[4]!.attributes).toBe(13);
    const url = "https://example.test/" + "x".repeat(600);
    await live.output(`\x1b[0m\x1b[2J\x1b[H\x1b]8;;${url}\x1b\\LINK\x1b]8;;\x1b\\`);
    expect(
      smallRow((await live.state()).frame)
        .slice(0, 4)
        .map(({ text }) => text)
        .join(""),
    ).toBe("LINK");
    await live.output("\x1b[2J\x1b[HPLAIN");
    const plain = smallRow((await live.state()).frame).slice(0, 5);
    expect(plain.map(({ text }) => text).join("")).toBe("PLAIN");
    expect(plain.every((cell) => cell.attributes === 0 && cell.link === undefined)).toBe(true);
  } finally {
    await live.close();
  }
});

test("local browsing and cold pictures cannot change another view or a new child mode", async () => {
  const live = await runtime();
  const a = await createTestRenderer({ width: 12, height: 3 });
  const b = await createTestRenderer({ width: 20, height: 5 });
  let cold: Awaited<ReturnType<typeof runtime>> | undefined;
  try {
    await live.output("\x1b[?1h\x1b[?2004h0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6");
    const current = (await live.state()).frame;
    const first = new NoForkMaterialView(a.renderer, current);
    const second = new NoForkMaterialView(b.renderer, current);
    a.renderer.root.add(first);
    b.renderer.root.add(second);
    await a.flush();
    await b.flush();
    const other = b.captureCharFrame();
    first.setFrame((await live.state(3)).frame);
    await a.flush();
    await b.flush();
    expect(a.captureCharFrame().trimStart().startsWith("1")).toBe(true);
    expect(b.captureCharFrame()).toBe(other);
    expect((await live.state()).frame).toEqual(current);
    await live.input({ kind: "paste", bytes: [120] });
    const input = await waitFor(live.state, (state) => state.input.length > 0);
    expect(new TextDecoder().decode(new Uint8Array(input.input))).toBe("\x1b[200~x\x1b[201~");
    cold = await runtime();
    second.setFrame(current);
    await b.flush();
    expect((await cold.state()).input).toEqual([]);
    await cold.input({ kind: "key", key: { key: "arrow_up" } });
    await cold.input({ kind: "paste", bytes: [120] });
    const fresh = await waitFor(cold.state, (state) => state.input.length >= 4);
    expect(new TextDecoder().decode(new Uint8Array(fresh.input))).toBe("\x1b[Ax");
  } finally {
    await a.dispose();
    await b.dispose();
    await cold?.close();
    await live.close();
  }
});

test("owned runtime cleanup also reaps an early-exiting PTY program", async () => {
  const live = await runtime();
  const pid = (await live.state()).pid;
  try {
    await live.exitProgram();
  } finally {
    await live.close();
  }
  expect(() => process.kill(pid, 0)).toThrow();
  expect(() => process.kill(live.runtimePid, 0)).toThrow();
});

test("native-dispatched keys retain Unicode layout metadata and Kitty actions at the real PTY", async () => {
  for (const modes of ["\x1b[?1h", "\x1b[>31u"]) {
    const live = await runtime();
    const setup = await createTestRenderer({ width: 12, height: 3, kittyKeyboard: true });
    const queue = projectionInputQueue();
    let captured = 0;
    let active = true;
    let reference: EmbeddedTerminalRenderable | undefined;
    try {
      await live.output(modes);
      reference = new EmbeddedTerminalRenderable(setup.renderer, { width: 12, height: 3 });
      reference.write(modes);
      const state = await live.state();
      const view = new NoForkMaterialView(
        setup.renderer,
        state.frame,
        (event) => {
          captured++;
          queue.enqueue(event, state.stamp, (entry, signal) => live.rawInput(entry, signal));
        },
        () => active,
      );
      setup.renderer.root.add(view);
      view.focus();
      const sequences = [
        "\x1b[A",
        "\x1b[B",
        "\x1b[C",
        "\x1b[D",
        "\x1b[5~",
        "\x1b[6~",
        "\x1b[H",
        "\x1b[F",
        "\x1b[2~",
        "\x1b[3~",
        "\x1bOP",
        "\x1b[24~",
        " ",
        "\r",
        "\t",
        "\x7f",
        "\x1b",
        "\x01",
        "λ",
        "🙂",
        "e\u0301",
        "\x1b[97;1u",
        "\x1b[97;1:2u",
        "\x1b[97;1:3u",
        "\x1b[65:97:113;2;65u",
        "\x1b[97;1;955:769u",
        "\x1ba",
        "\x1b[97;3u",
        "\x1b[97;33u",
        "\x1b[97;9u",
        "\x1b[97;17u",
        "\x1b[97;65u",
        "\x1b[97;129u",
        ...[
          57358,
          57359,
          57360,
          57361,
          57362,
          57363,
          57376,
          57398,
          ...Array.from({ length: 28 }, (_, index) => 57399 + index),
          57427,
          57441,
          57442,
          57443,
          57444,
          57447,
          57448,
          57449,
          57450,
        ].map((code) => `\x1b[${code};1u`),
      ];
      const expected: number[] = [];
      for (const sequence of sequences) {
        const parsed = parseKeypress(sequence, { useKittyKeyboard: true })!;
        expected.push(...reference.encodeKey(new KeyEvent(parsed)));
        setup.renderer.keyInput.processParsedKey(parsed);
      }
      expect(captured).toBe(sequences.length + 1); // Initial physical focus is a separate semantic event.
      await queue.flush(() => state.stamp);
      const received = await live.state();
      await Bun.write(
        join(live.directory, "key-comparison.json"),
        JSON.stringify({ modes, expected, actual: received.input }, null, 2),
      );
      expect(received.input).toEqual(expected);
    } finally {
      try {
        active = false;
        queue.clear();
        await setup.dispose();
      } finally {
        reference?.destroy();
        await live.close();
      }
    }
  }
});

test("native paste capture owns mutable bytes and protocol-shaped paste never becomes a gesture", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    await live.output("\x1b[?2004h\x1b[?1000h\x1b[?1006h");
    const held: SemanticInput[] = [];
    const view = new NoForkMaterialView(setup.renderer, (await live.state()).frame, (event) =>
      held.push(event),
    );
    setup.renderer.root.add(view);
    view.focus();
    held.length = 0;
    const bytes = Buffer.from("original\x1b[<0;3;2M");
    setup.renderer.keyInput.processPaste(bytes);
    bytes.fill(120);
    expect(held).toHaveLength(1);
    await live.input(held[0]!);
    const received = await waitFor(live.state, (state) => state.input.length > 0);
    expect(new TextDecoder().decode(new Uint8Array(received.input))).toBe(
      "\x1b[200~original [<0;3;2M\x1b[201~",
    );
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("mouse and focus use live modes without delaying physical blur or destruction", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 20, height: 6 });
  try {
    const sent: Promise<void>[] = [];
    let ordered = Promise.resolve();
    const view = new NoForkMaterialView(setup.renderer, (await live.state()).frame, (event) => {
      sent.push((ordered = ordered.then(() => live.input(event))));
    });
    setup.renderer.root.add(view);
    await setup.flush();
    view.focus();
    await Promise.all(sent);
    await live.output("\x1b[?1000h\x1b[?1006h\x1b[?1004h");
    view.processMouseEvent(
      new MouseEvent(view, {
        type: "down",
        button: 0,
        x: 2,
        y: 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    view.blur();
    expect(view.focused).toBe(false);
    await Promise.all(sent);
    expect(new TextDecoder().decode(new Uint8Array((await live.state()).input))).toBe(
      "\x1b[<0;3;2M\x1b[O",
    );
    view.focus();
    view.processMouseEvent(
      new MouseEvent(view, {
        type: "scroll",
        button: 4,
        x: 2,
        y: 1,
        scroll: { direction: "up", delta: 1 },
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    await Promise.all(sent);
    expect(new TextDecoder().decode(new Uint8Array((await live.state()).input))).toBe(
      "\x1b[<0;3;2M\x1b[O\x1b[I\x1b[<64;3;2M",
    );
    await live.output("\x1b[?1000l\x1b[?1004l");
    const before = (await live.state()).input;
    view.focus();
    view.processMouseEvent(
      new MouseEvent(view, {
        type: "down",
        button: 0,
        x: 2,
        y: 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    view.destroy();
    expect(view.isDestroyed).toBe(true);
    expect(view.focused).toBe(false);
    await Promise.all(sent);
    expect((await live.state()).input).toEqual(before);
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("mouse fallback selects and copies Unicode locally and wheel browsing leaves its peer unchanged", async () => {
  const live = await runtime();
  const a = await createTestRenderer({ width: 12, height: 3 });
  const b = await createTestRenderer({ width: 20, height: 5 });
  try {
    await live.output("λ🙂e\u0301\r\n1\r\n2\r\n3\r\n4");
    const frame = (await live.state(2)).frame;
    const held: Promise<void>[] = [];
    let ordered = Promise.resolve();
    const view = new NoForkMaterialView(a.renderer, frame, (event) => {
      held.push(
        (ordered = ordered.then(async () => {
          const reply = await live.sendInput(event);
          view.applyMouseResult(event, reply.forwarded);
          if (
            !reply.forwarded &&
            event.kind === "mouse" &&
            event.mouse.action === "press" &&
            (event.mouse.button === "four" || event.mouse.button === "five")
          ) {
            view.setFrame((await live.state(view.scrollOffset)).frame);
          }
        })),
      );
    });
    const peer = new NoForkMaterialView(b.renderer, frame);
    a.renderer.root.add(view);
    b.renderer.root.add(peer);
    await a.flush();
    await b.flush();
    for (const [type, x] of [
      ["down", 0],
      ["drag", 3],
      ["up", 3],
    ] as const) {
      view.processMouseEvent(
        new MouseEvent(view, {
          type,
          button: 0,
          x,
          y: 0,
          isDragging: type === "drag",
          modifiers: { shift: false, alt: false, ctrl: false },
        }),
      );
    }
    await Promise.all(held);
    expect(view.getSelectedText()).toBe("λ🙂e\u0301");
    expect(peer.getSelectedText()).toBe("");
    const other = b.captureCharFrame();
    view.scrollOffset = 0;
    view.setFrame((await live.state()).frame);
    await a.flush();
    const beforeWheel = a.captureCharFrame();
    view.processMouseEvent(
      new MouseEvent(view, {
        type: "scroll",
        button: 4,
        x: 2,
        y: 1,
        scroll: { direction: "up", delta: 1 },
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
    await Promise.all(held);
    expect(view.scrollOffset).toBe(1);
    await a.flush();
    expect(a.captureCharFrame()).not.toBe(beforeWheel);
    expect(a.captureCharFrame().trimStart().startsWith("1")).toBe(true);
    await b.flush();
    expect(b.captureCharFrame()).toBe(other);
    expect((await live.state()).input).toEqual([]);
  } finally {
    await a.dispose();
    await b.dispose();
    await live.close();
  }
});

test("queued input cannot borrow a later sender or survive any authority generation change", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    for (const field of ["attachment", "navigation", "geometry", "runtime", "epoch"] as const) {
      const state = await live.state();
      const queue = projectionInputQueue();
      let original = 0;
      let replacement = 0;
      const input: SemanticInput = { kind: "paste", bytes: [120] };
      let sender = async (event: ProjectionInput, signal: AbortSignal) => {
        original++;
        await live.rawInput(event, signal);
      };
      queue.enqueue(input, state.stamp, sender);
      sender = async () => {
        replacement++;
      };
      await queue.flush(() => state.stamp);
      expect(original).toBe(1);
      expect(replacement).toBe(0);
      const before = (await live.state()).input;
      let allowed = true;
      const view = new NoForkMaterialView(
        setup.renderer,
        state.frame,
        (event) => queue.enqueue(event, state.stamp, sender),
        () => allowed,
      );
      setup.renderer.root.add(view);
      view.focus();
      setup.renderer.keyInput.processPaste(new Uint8Array([120]));
      await live.revoke(field);
      if (field === "navigation") {
        await live.revoke(field);
      }
      const current = await live.state();
      allowed = false;
      await queue.flush(() => current.stamp);
      await expect(live.rawInput({ stamp: state.stamp, input })).rejects.toThrow();
      expect(queue.bytes).toBe(0);
      expect(replacement).toBe(0);
      expect((await live.state()).input).toEqual(before);
      view.destroy();
    }
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("late pictures and same-cursor ordered resizes cannot restore old input authority", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 30, height: 8 });
  try {
    const first = await live.state();
    const view = new NoForkMaterialView(setup.renderer, first.frame);
    setup.renderer.root.add(view);
    expect(view.setEnvelope(first, first.stamp)).toBe(true);
    expect(view.setEnvelope(first, first.stamp)).toBe(false);
    await live.resize(15, 4);
    await live.resize(20, 5);
    const current = await live.state();
    expect(current.bytes).toBe(first.bytes);
    expect(current.stamp.geometry).toBe(first.stamp.geometry + 2);
    expect(current.frame.size).toEqual({ cols: 20, rows: 5 });
    expect(view.setEnvelope(current, current.stamp)).toBe(true);
    await setup.flush();
    expect({ cols: view.width, rows: view.height }).toEqual({ cols: 20, rows: 5 });
    expect(view.setEnvelope(first, current.stamp)).toBe(false);
    expect(view.setEnvelope({ ...current, sequence: 100 }, current.stamp)).toBe(true);
    const replacementStamp = {
      ...current.stamp,
      epoch: "replacement-epoch",
      runtime: "replacement-runtime",
    };
    expect(
      view.setEnvelope({ ...current, stamp: replacementStamp, sequence: 1 }, replacementStamp),
    ).toBe(true);
    expect(view.setEnvelope({ ...current, sequence: 101 }, replacementStamp)).toBe(false);
    await expect(
      live.rawInput({ stamp: first.stamp, input: { kind: "paste", bytes: [120] } }),
    ).rejects.toThrow();
    expect((await live.state()).input).toEqual([]);
    view.destroy();
    expect(view.setEnvelope({ ...current, sequence: 1000 }, current.stamp)).toBe(false);
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("unauthorized paste is rejected before reading or retaining detached bytes", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    const sent: SemanticInput[] = [];
    const view = new NoForkMaterialView(
      setup.renderer,
      (await live.state()).frame,
      (event) => {
        sent.push(event);
      },
      () => false,
    );
    setup.renderer.root.add(view);
    view.focus();
    const bytes = new Uint8Array([97]);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(() => setup.renderer.keyInput.processPaste(bytes)).not.toThrow();
    expect(sent).toEqual([]);
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("queued and in-flight payloads share the 8 MiB ceiling and teardown cancels a held send", async () => {
  const stamp: ProjectionStamp = {
    epoch: "e",
    runtime: "r",
    attachment: 1,
    navigation: 1,
    geometry: 1,
  };
  const queue = projectionInputQueue();
  const limit = 8 * 1024 * 1024;
  queue.enqueue(
    { kind: "paste", bytes: Array.from({ length: limit - 128 }, () => 120) },
    stamp,
    async () => {},
  );
  expect(queue.bytes).toBe(limit);
  expect(() => queue.enqueue({ kind: "focus", focused: false }, stamp, async () => {})).toThrow(
    "limit",
  );
  queue.clear();
  expect(queue.bytes).toBe(0);
  let aborted = false;
  queue.enqueue(
    { kind: "focus", focused: false },
    stamp,
    async (_event, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      }),
  );
  const flushing = queue.flush(() => stamp);
  const stopped = flushing.then(
    () => false,
    () => true,
  );
  expect(queue.bytes).toBe(128);
  queue.clear();
  expect(await stopped).toBe(true);
  expect(aborted).toBe(true);
  expect(queue.bytes).toBe(0);
});

test("a valid large canonical grid must remain displayable without exceeding the retained-frame ceiling", async () => {
  const live = await runtime();
  const a = await createTestRenderer({ width: 12, height: 3 });
  const b = await createTestRenderer({ width: 20, height: 5 });
  let failure: string | null = null;
  let serialized = 0;
  try {
    try {
      await live.resize(512, 512);
      await live.output("\x1b[Hλ🙂e\u0301\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102m \x1b[6 q");
      const state = await live.state();
      serialized = Buffer.byteLength(JSON.stringify(state));
      expect(state.frame.size).toEqual({ cols: 512, rows: 512 });
      expect(serialized).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(state.frame.styles.length).toBeGreaterThan(1);
      for (const setup of [a, b]) {
        setup.renderer.root.add(new NoForkMaterialView(setup.renderer, state.frame));
        await setup.flush();
        expect(setup.captureCharFrame()).toContain("λ🙂e\u0301");
        expect(setup.renderer.getCursorState()).toMatchObject({ visible: true, style: "line" });
        const styled = setup.captureSpans().lines[0]!.spans.find((span) => span.attributes === 13)!;
        expect(styled.fg.toInts()).toEqual([17, 34, 51, 255]);
        expect(styled.bg.toInts()).toEqual([68, 85, 102, 255]);
      }
      expect((await live.state()).frame.size).toEqual({ cols: 512, rows: 512 });
    } catch (error) {
      failure = String(error);
    }
    await Bun.write(
      join(live.directory, "large-frame-observation.json"),
      JSON.stringify(
        {
          size: { cols: 512, rows: 512 },
          cells: 512 * 512,
          existingMaximumCells: 1_048_576,
          ceiling: 8 * 1024 * 1024,
          minimumFullMaterialBytes: 512 * 512 * 64,
          compactEnvelopeBytes: serialized,
          failure,
        },
        null,
        2,
      ),
    );
    expect(failure).toBeNull();
  } finally {
    await a.dispose();
    await b.dispose();
    await live.close();
  }
});

test("invalid compact material retains the last picture and later valid material still draws", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  try {
    await live.output("BEFORE");
    const state = await live.state();
    const view = new NoForkMaterialView(setup.renderer, state.frame);
    setup.renderer.root.add(view);
    await setup.flush();
    const before = setup.captureCharFrame();
    const malformed = {
      ...state.frame,
      rows: [[[Number.MAX_SAFE_INTEGER, "x", 1, 0]]],
    } as CompactMaterialFrame;
    expect(() => view.setFrame(malformed)).toThrow();
    view.requestRender();
    await setup.flush();
    expect(setup.captureCharFrame()).toBe(before);
    const badWidth = structuredClone(state.frame);
    badWidth.rows[0] = [
      [1, "ab", 1, 0],
      [11, " ", 1, 0],
    ];
    expect(() => view.setFrame(badWidth)).toThrow("width");
    view.requestRender();
    await setup.flush();
    expect(setup.captureCharFrame()).toBe(before);
    await live.output("\x1b[HAFTER ");
    view.setFrame((await live.state()).frame);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("AFTER");
  } finally {
    await setup.dispose();
    await live.close();
  }
});

test("irregular text and alternating styles retain exact small-frame material", async () => {
  const live = await runtime();
  try {
    const output = "A\x1b[38;2;17;34;51mλ\x1b[48;2;68;85;102m🙂\x1b[0me\u0301 Z";
    await live.output(output);
    expect((await live.state()).frame).toEqual(compactFrame(material(output)));
  } finally {
    await live.close();
  }
});

test("a valid unique-color grid must remain displayable within the unchanged budget", async () => {
  const live = await runtime();
  let failure: string | null = null;
  try {
    await live.resize(512, 512);
    for (let y = 0; y < 512; y++) {
      let output = `\x1b[${y + 1};1H`;
      for (let x = 0; x < 512; x++) {
        const n = y * 512 + x;
        output += `\x1b[38;2;${n & 255};${(n >>> 8) & 255};${n >>> 16}m${String.fromCharCode(65 + (n % 26))}`;
      }
      await live.output(output);
    }
    try {
      const state = await live.state();
      expect(state.frame.size).toEqual({ cols: 512, rows: 512 });
      expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(8388608);
    } catch (error) {
      failure = String(error);
    }
    await Bun.write(
      join(live.directory, "irregular-frame-observation.json"),
      JSON.stringify({ cols: 512, rows: 512, cells: 262144, ceiling: 8388608, failure }, null, 2),
    );
    await live.resize(12, 3);
    expect((await live.state()).frame.size).toEqual({ cols: 12, rows: 3 });
    expect(failure).toBeNull();
  } finally {
    await live.close();
  }
}, 30000);

test("bounded paste reaches the real child once with one bracketed envelope", async () => {
  const live = await runtime();
  try {
    const state = await live.state();
    await live.output("\x1b[?2004h");
    const input: SemanticInput = {
      kind: "paste",
      bytes: Array.from({ length: 3 * 1024 * 1024 }, () => 120),
    };
    const queue = projectionInputQueue();
    queue.enqueue(input, state.stamp, (event, signal) => live.rawInput(event, signal));
    const charged = queue.bytes;
    let failure: string | null = null;
    try {
      await queue.flush(() => state.stamp);
    } catch (error) {
      failure = String(error);
    }
    const received = await live.state();
    const expected = createHash("sha256")
      .update("\x1b[200~")
      .update(Buffer.alloc(3145728, 120))
      .update("\x1b[201~")
      .digest("hex");
    await Bun.write(
      join(live.directory, "paste-transfer-observation.json"),
      JSON.stringify(
        {
          charged,
          maxInputRequestBytes: live.maxInputRequestBytes(),
          failure,
          inputBytes: received.inputBytes,
          inputHash: received.inputHash,
          expected,
        },
        null,
        2,
      ),
    );
    expect(charged).toBe(3 * 1024 * 1024 + 128);
    expect(queue.bytes).toBe(0);
    expect(live.maxInputRequestBytes()).toBeLessThan(90000);
    expect(failure).toBeNull();
    expect(received.inputBytes).toBe(3145740);
    expect(received.inputHash).toBe(expected);
    expect(Buffer.byteLength(JSON.stringify(received))).toBeLessThan(65536);
  } finally {
    await live.close();
  }
});

test("a chunked 1-MiB paste reaches the child with exact bracketed bytes", async () => {
  const live = await runtime();
  try {
    await live.output("\x1b[?2004h");
    await live.input({ kind: "paste", bytes: Array.from({ length: 1048576 }, () => 120) });
    const received = await live.state();
    expect(received.inputBytes).toBe(1048588);
    expect(received.inputHash).toBe(
      createHash("sha256")
        .update("\x1b[200~")
        .update(Buffer.alloc(1048576, 120))
        .update("\x1b[201~")
        .digest("hex"),
    );
  } finally {
    await live.close();
  }
});

test("stock native paste input ceiling is separate from bounded transport admission", async () => {
  const setup = await createTestRenderer({ width: 12, height: 3 });
  const reference = new EmbeddedTerminalRenderable(setup.renderer, { width: 12, height: 3 });
  try {
    expect(reference.encodePaste(Buffer.alloc(1048576, 120))).toHaveLength(1048576);
    expect(() => reference.encodePaste(Buffer.alloc(1048577, 120))).toThrow("InvalidArgument");
  } finally {
    reference.destroy();
    await setup.dispose();
  }
});

test("pending wire paste blocks ordinary input and revocation drops every uncommitted byte", async () => {
  const live = await runtime();
  try {
    const { stamp } = await live.state();
    const identity = { stamp, id: "held-paste" };
    await live.wireInput({ ...identity, type: "paste.begin", total: 3 });
    await live.wireInput({ ...identity, type: "paste.chunk", offset: 0, data: "YWJj" });
    await expect(
      live.wireInput({ stamp, input: { kind: "key", key: { key: "key_x", text: "x" } } }),
    ).rejects.toThrow("pending");
    expect((await live.state()).input).toEqual([]);
    await live.revoke("navigation");
    await live.revoke("navigation");
    await expect(live.wireInput({ ...identity, type: "paste.commit" })).rejects.toThrow();
    expect((await live.state()).input).toEqual([]);
  } finally {
    await live.close();
  }
});

test("paste chunk boundaries preserve native sanitization and UTF8 bytes", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  const reference = new EmbeddedTerminalRenderable(setup.renderer, { width: 12, height: 3 });
  try {
    const prefix = Buffer.alloc(65535, 120);
    const bytes = Buffer.concat([prefix, Buffer.from("🙂\u0000\x1b[<0;3;2M\x1b[201~")]);
    await live.output("\x1b[?2004h");
    reference.write("\x1b[?2004h");
    const expected = reference.encodePaste(bytes);
    await live.input({ kind: "paste", bytes: [...bytes] });
    const received = await live.state();
    expect(received.inputBytes).toBe(expected.length);
    expect(received.inputHash).toBe(createHash("sha256").update(expected).digest("hex"));
  } finally {
    reference.destroy();
    await setup.dispose();
    await live.close();
  }
});

test("an unacknowledged paste commit excludes another full-budget transfer", async () => {
  const live = await runtime();
  let pid: number | undefined;
  let committing: Promise<unknown> | undefined;
  try {
    const state = await live.state();
    pid = state.pid;
    process.kill(pid, "SIGSTOP");
    const identity = { stamp: state.stamp, id: "in-flight-paste" };
    await live.wireInput({ ...identity, type: "paste.begin", total: 1048576 });
    for (let offset = 0; offset < 1048576; offset += 65536) {
      await live.wireInput({
        ...identity,
        type: "paste.chunk",
        offset,
        data: Buffer.alloc(65536, 120).toString("base64"),
      });
    }
    committing = live
      .wireInput({ ...identity, type: "paste.commit" })
      .catch((error) => ({ error: String(error) }));
    await waitFor(live.state, (s) => s.inputFrontier === 1048576);
    await expect(
      live.wireInput({ type: "paste.begin", id: "next-paste", stamp: state.stamp, total: 8388480 }),
    ).rejects.toThrow("flight");
    process.kill(pid, "SIGCONT");
    pid = undefined;
    await committing;
    expect((await live.state()).inputBytes).toBe(1048576);
    await live.wireInput({ type: "paste.begin", id: "after-ack", stamp: state.stamp, total: 0 });
    await live.wireInput({ type: "paste.commit", id: "after-ack", stamp: state.stamp });
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGCONT");
      } catch {}
    }
    await committing;
    await live.close();
  }
});

test("regional-indicator material preserves native following-text columns", async () => {
  const live = await runtime();
  const setup = await createTestRenderer({ width: 12, height: 3 });
  const reference = new EmbeddedTerminalRenderable(setup.renderer, { width: 12, height: 3 });
  let failure: string | null = null;
  let nativeColumns = -1;
  let materialColumns = -1;
  try {
    const output = "🇦🇧\x1b[31mX";
    reference.write(output);
    setup.renderer.root.add(reference);
    await setup.flush();
    const spans = setup.captureSpans().lines[0]!.spans;
    nativeColumns = spans[0]!.width;
    reference.destroy();
    await live.output(output);
    try {
      const state = await live.state();
      setup.renderer.root.add(new NoForkMaterialView(setup.renderer, state.frame));
      await setup.flush();
      materialColumns = setup.captureSpans().lines[0]!.spans[0]!.width;
    } catch (error) {
      failure = String(error);
    }
    await Bun.write(
      join(live.directory, "regional-indicator-observation.json"),
      JSON.stringify({ nativeColumns, materialColumns, failure }, null, 2),
    );
    expect(failure).toBeNull();
    expect(materialColumns).toBe(nativeColumns);
  } finally {
    reference.destroy();
    await setup.dispose();
    await live.close();
  }
});

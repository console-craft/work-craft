import { expect, spyOn, test } from "bun:test";

import { resolveRenderLib } from "@opentui/core";

import type { CompactMaterialFrame } from "../../api/terminal-material";
import { restoreColdProjection } from "../cold-history";
import type { HistoryReplay } from "../history";
import { StoppedDisplay, type StoppedDisplayKey } from "../stopped-display";

const size = { cols: 20, rows: 5 };
const key: StoppedDisplayKey = {
  paneId: "a",
  runtimeGeneration: 1,
  cursor: 0,
  gridSequence: 1,
  size,
};
const current = () => true;

function replay(text: string): HistoryReplay {
  const data = new TextEncoder().encode(text);
  return {
    paneId: "a",
    data,
    cursor: data.length,
    startCursor: 0,
    prefixBytes: 0,
    truncated: false,
    initialSize: size,
    initialGridSequence: 1,
    resizes: [],
    starts: [],
  };
}

function text(frame: CompactMaterialFrame): string {
  return frame.rows
    .map((row) => row.map(([n, value, width]) => (width ? value.repeat(n) : "")).join(""))
    .join("\n");
}

test("same-key readers reconstruct once and browse independent native offsets", async () => {
  const display = new StoppedDisplay();
  const gate = Promise.withResolvers<void>();
  let builds = 0;
  const build = async () => {
    builds++;
    await gate.promise;
    return restoreColdProjection(
      replay(
        Array.from({ length: 80 }, (_, i) => `ROW-${i}`).join("\r\n") + "\r\n\x1b[7mEND \x1b[0m",
      ),
      size,
    );
  };
  try {
    const tail = display.read(key, 0, build, current);
    const middle = display.read(key, 40, build, current);
    gate.resolve();
    const [a, b] = await Promise.all([tail, middle]);
    expect(builds).toBe(1);
    expect(text(a)).toContain("END");
    expect(text(b)).toContain("ROW-40");
    expect(a.cursor.visible).toBe(false);
    const first = await display.read(key, 10000, build, current);
    expect(text(first)).toContain("ROW-0");
    expect(builds).toBe(1);
  } finally {
    await display.clear();
  }
});

test("switching displays destroys the old parser before allocating another", async () => {
  const display = new StoppedDisplay();
  const events: string[] = [];
  async function build(id: string) {
    events.push(`build:${id}`);
    const parser = await restoreColdProjection(replay(id), size);
    return {
      frame: parser.frame,
      destroy() {
        events.push(`destroy:${id}`);
        parser.destroy();
      },
    };
  }
  try {
    await display.read(key, 0, () => build("a"), current);
    await display.read({ ...key, paneId: "b" }, 0, () => build("b"), current);
    expect(events).toEqual(["build:a", "destroy:a", "build:b"]);
  } finally {
    await display.clear();
  }
  expect(events.at(-1)).toBe("destroy:b");
});

test("a stale reader cannot cancel a valid reader and abandoned work is never cached", async () => {
  const display = new StoppedDisplay();
  let valid = true;
  let builds = 0;
  const gate = Promise.withResolvers<void>();
  const build = async () => {
    builds++;
    await gate.promise;
    return restoreColdProjection(replay("OK"), size);
  };
  const stale = display.read(key, 0, build, () => valid).catch((error) => error);
  const live = display.read(key, 0, build, current);
  valid = false;
  gate.resolve();
  expect(await stale).toBeInstanceOf(Error);
  expect(text(await live)).toContain("OK");
  expect(builds).toBe(1);
  display.invalidate("a");
  const abandoned = display.read(key, 0, build, () => valid).catch((error) => error);
  expect(await abandoned).toBeInstanceOf(Error);
  expect(builds).toBe(1);
  await display.clear();
});

test("preparation shares the finite lane and coalesced readers count toward overload", async () => {
  const display = new StoppedDisplay();
  const gate = Promise.withResolvers<void>();
  const events: string[] = [];
  const work = display.prepare(async () => {
    events.push("prepare");
    await gate.promise;
  });
  const build = async () => {
    events.push("build");
    return restoreColdProjection(replay("OK"), size);
  };
  const reads = Array.from({ length: 127 }, () => display.read(key, 0, build, current));
  await expect(display.read(key, 0, build, current)).rejects.toThrow(/limit/i);
  expect(events).toEqual(["prepare"]);
  gate.resolve();
  await work;
  await Promise.all(reads);
  expect(events).toEqual(["prepare", "build"]);
  await display.clear();
});

test("clear and invalidation destroy late results, drain shutdown and permit reuse", async () => {
  const display = new StoppedDisplay();
  const gate = Promise.withResolvers<void>();
  let destroyed = 0;
  const read = display
    .read(
      key,
      0,
      async () => {
        await gate.promise;
        const parser = await restoreColdProjection(replay("OLD"), size);
        return {
          frame: parser.frame,
          destroy() {
            destroyed++;
            parser.destroy();
          },
        };
      },
      current,
    )
    .catch((error) => error);
  display.invalidate("a");
  let cleared = false;
  const clear = display.clear().then(() => {
    cleared = true;
  });
  await Bun.sleep(0);
  expect(cleared).toBe(false);
  gate.resolve();
  expect(await read).toBeInstanceOf(Error);
  await clear;
  expect(destroyed).toBe(1);
  await expect(
    display.read(
      key,
      0,
      async () => {
        throw new Error("forced build");
      },
      current,
    ),
  ).rejects.toThrow("forced build");
  expect(
    text(await display.read(key, 0, () => restoreColdProjection(replay("NEW"), size), current)),
  ).toContain("NEW");
  await display.clear();
});

test("failed native reconstruction balances contexts and leases without poisoning other panes", async () => {
  const lib = resolveRenderLib();
  const create = spyOn(lib, "createContext");
  const destroy = spyOn(lib, "destroyContext");
  const acquire = spyOn(lib, "contextAcquireBufferLease");
  const release = spyOn(lib, "contextReleaseBufferLease");
  const display = new StoppedDisplay();
  try {
    acquire.mockImplementationOnce(() => {
      throw new Error("forced lease");
    });
    await expect(
      display.read(key, 0, () => restoreColdProjection(replay("FAIL"), size), current),
    ).rejects.toThrow("forced lease");
    expect(
      text(
        await display.read(
          { ...key, paneId: "b" },
          0,
          () => restoreColdProjection(replay("GOOD"), size),
          current,
        ),
      ),
    ).toContain("GOOD");
    await display.clear();
    expect(create.mock.calls.length).toBe(destroy.mock.calls.length);
    expect(acquire.mock.calls.length - 1).toBe(release.mock.calls.length);
  } finally {
    await display.clear();
    create.mockRestore();
    destroy.mockRestore();
    acquire.mockRestore();
    release.mockRestore();
  }
});

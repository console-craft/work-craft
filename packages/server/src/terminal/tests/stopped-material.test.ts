import { expect, spyOn, test } from "bun:test";

import { resolveRenderLib } from "@opentui/core";

import { openDatabase } from "../../persistence/database";
import { TerminalHistory } from "../history";
import { RuntimeRegistry } from "../runtime";

function fixture() {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO workspaces VALUES ('w','W'); INSERT INTO items VALUES ('i','w','design',NULL,'generic','I',0,0,'{}');
    INSERT INTO surfaces VALUES ('s','i');
    INSERT INTO panes (id,surface_id,kind,title,cwd,restore_policy_json,process_status) VALUES
    ('p','s','terminal','Shell','/','{"type":"shell","executable":"/bin/sh","args":[]}','exited');`);
  const history = new TerminalHistory(db);
  const registry = new RuntimeRegistry({
    onOutput: (id, bytes) => {
      history.append(id, bytes);
    },
    onStatus() {},
    historyState: (id) => history.displayState(id),
    readHistory: (id) => history.readForRecovery(id),
  });
  return {
    history,
    registry,
    async close() {
      await registry.stopAll();
      await history.close();
      db.close();
    },
  };
}

function text(frame: { rows: [number, string, number, number][][] }): string {
  return frame.rows
    .map((row) => row.map(([n, value, width]) => (width ? value.repeat(n) : "")).join(""))
    .join("\n");
}

test("exit retains an immediate final picture and lazily reconstructs older material once", async () => {
  const f = fixture();
  const read = spyOn(f.history, "readForRecovery");
  const native = resolveRenderLib();
  const create = spyOn(native, "createContext");
  const destroy = spyOn(native, "destroyContext");
  try {
    f.history.recordGrid("p", { cols: 20, rows: 5 }, "fresh");
    await f.registry.start(
      {
        id: "p",
        cwd: process.cwd(),
        restorePolicy: {
          type: "shell",
          executable: "/bin/sh",
          args: ["-c", "i=0; while [ $i -lt 80 ]; do printf 'ROW-%03d\\n' $i; i=$((i+1)); done"],
        },
      },
      { cols: 20, rows: 5 },
    );
    await f.registry.waitForExit("p");
    expect(create.mock.calls.length).toBe(destroy.mock.calls.length);
    expect(text((await f.registry.readMaterial("p", 0, () => true)).frame)).toContain("ROW-079");
    expect((await f.registry.readMaterial("p", 0, () => true)).frame.cursor.visible).toBe(false);
    expect(read.mock.calls).toHaveLength(0);
    const [first, middle] = await Promise.all([
      f.registry.readMaterial("p", 10000, () => true),
      f.registry.readMaterial("p", 40, () => true),
    ]);
    expect(text(first.frame)).toContain("ROW-000");
    expect(text(middle.frame)).toContain("ROW-040");
    await f.registry.readMaterial("p", 3, () => true);
    expect(read.mock.calls).toHaveLength(1);
    await f.registry.stopAll();
    expect(create.mock.calls.length).toBe(destroy.mock.calls.length);
  } finally {
    read.mockRestore();
    create.mockRestore();
    destroy.mockRestore();
    await f.close();
  }
});

test("stopped history without any runtime reconstructs at its recorded grid or legacy fallback", async () => {
  const f = fixture();
  try {
    const empty = await f.registry.readMaterial("p", 0, () => true);
    expect(empty.frame.size).toEqual({ cols: 80, rows: 24 });
    expect(empty.frame.cursor.visible).toBe(false);
    expect(text(empty.frame).trim()).toBe("");
    f.history.append("p", Buffer.from("LEGACY"));
    expect(text((await f.registry.readMaterial("p", 0, () => true)).frame)).toContain("LEGACY");
    f.history.recordGrid("p", { cols: 30, rows: 6 });
    expect((await f.registry.readMaterial("p", 0, () => true)).frame.size).toEqual({
      cols: 30,
      rows: 6,
    });
    expect(f.registry.generation("p")).toBe(0);
    expect(f.registry.isLive("p")).toBe(false);
    await expect(f.registry.readMaterial("p", 2, () => false)).rejects.toThrow(/scope|obsolete/i);
  } finally {
    await f.close();
  }
});

for (const failure of ["prepare", "capture", "spawn"] as const) {
  // Quarantined macOS native exit hang; keep assertions for the tracked follow-up:
  // docs/superpowers/handovers/2026-10-23-native-pty-exit-hang.md
  test.skipIf(process.platform === "darwin")(
    `failed ${failure} during Reactivate preserves the prior final picture across generations`,
    async () => {
      const f = fixture();
      const pane = {
        id: "p",
        cwd: process.cwd(),
        restorePolicy: {
          type: "shell" as const,
          executable: "/bin/sh",
          args: ["-c", "printf FINAL-PICTURE"],
        },
      };
      let forced: ReturnType<typeof spyOn> | undefined;
      try {
        await f.registry.start(pane);
        await f.registry.waitForExit("p");
        const before = (await f.registry.readMaterial("p", 0, () => true)).frame;
        if (failure === "capture") {
          forced = spyOn(resolveRenderLib(), "contextAcquireBufferLease").mockImplementationOnce(
            () => {
              throw new Error("forced capture");
            },
          );
        } else if (failure === "spawn") {
          forced = spyOn(Bun, "spawn").mockImplementationOnce(() => {
            throw new Error("forced spawn");
          });
        }
        await expect(
          f.registry.start(pane, undefined, async () => {
            if (failure === "prepare") {
              throw new Error("forced prepare");
            }
            return f.history.readForRecovery("p");
          }),
        ).rejects.toThrow(`forced ${failure}`);
        forced?.mockRestore();
        expect(f.registry.generation("p")).toBe(2);
        expect(f.registry.isLive("p")).toBe(false);
        const read = spyOn(f.history, "readForRecovery").mockImplementation(() => {
          throw new Error("history remains unsupported");
        });
        try {
          expect((await f.registry.readMaterial("p", 0, () => true)).frame).toEqual(before);
          await expect(f.registry.readMaterial("p", 10, () => true)).rejects.toThrow(
            "history remains unsupported",
          );
          expect(text((await f.registry.readMaterial("p", 0, () => true)).frame)).toContain(
            "FINAL-PICTURE",
          );
        } finally {
          read.mockRestore();
        }
      } finally {
        forced?.mockRestore();
        await f.close();
      }
    },
  );
}

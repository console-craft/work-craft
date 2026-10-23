import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../application/app";
import {
  normalizeSessionNavigations,
  readNavigationCatalog,
} from "../application/navigation-store";
import { createClient } from "../client";
import { openDatabase } from "../persistence/database";
import { startHttpServer } from "./http";
import type { TerminalProjectionContext } from "./terminal-projection-protocol";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-stopped-"));
  const db = openDatabase(join(directory, "db.sqlite"));
  db.exec(`INSERT INTO sessions VALUES ('session','Main',0); INSERT INTO workspaces VALUES ('w','W');
    INSERT INTO session_workspaces VALUES ('session','w',0);
    INSERT INTO items VALUES ('item','w','design',NULL,'generic','I',0,0,'{}');
    INSERT INTO surfaces VALUES ('surface','item');
    INSERT INTO tabs VALUES ('tab','surface','Main',0,'{"type":"pane","paneId":"p"}');
    INSERT INTO panes (id,surface_id,kind,title,cwd,restore_policy_json,process_status) VALUES
    ('p','surface','terminal','Shell','/','{"type":"shell","executable":"/bin/sh","args":[]}','exited');`);
  normalizeSessionNavigations(db, readNavigationCatalog(db));
  const app = createApp({ db });
  await app.execute({
    type: "session.navigate",
    sessionId: "session",
    target: { kind: "pane", paneId: "p" },
  });
  app.history.recordGrid("p", { cols: 20, rows: 5 }, "fresh");
  app.history.append(
    "p",
    Buffer.from(Array.from({ length: 80 }, (_, i) => `SOCKET-${i}`).join("\r\n")),
  );
  const socketPath = join(directory, "d.sock");
  const server = startHttpServer(app, socketPath);
  const client = createClient({ socketPath });
  const stream = await client.stream({ onMessage() {} });
  const attached = await stream.attach("session");
  async function context(): Promise<TerminalProjectionContext> {
    const snapshot = await client.snapshot();
    return {
      epoch: snapshot.epoch,
      attachmentGeneration: attached.generation,
      navigationGeneration: snapshot.navigation[0]!.generation,
      geometrySequence: snapshot.geometry.tabs[0]!.generation,
      runtimeGeneration: app.runtime.generation("p"),
    };
  }
  return {
    app,
    db,
    client,
    stream,
    context,
    attached,
    async close() {
      stream.close();
      await app.runtime.stopAll();
      await server.stop(true);
      await app.history.close();
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("real stopped socket reads are inert and revalidate archival after asynchronous work", async () => {
  const f = await fixture();
  const write = spyOn(f.app.runtime, "write");
  const start = spyOn(f.app.runtime, "start");
  const semantic = spyOn(f.app.runtime, "writeSemantic");
  let delayed: ReturnType<typeof spyOn> | undefined;
  const gate = Promise.withResolvers<void>();
  try {
    const scope = await f.context();
    const frame = (await f.stream.requestMaterial("p", scope, 10000)).frame;
    expect(frame.rows.flat().some((run) => run[1] === "S")).toBe(true);
    expect(frame.cursor.visible).toBe(false);
    const before = f.app.history.displayState("p");
    f.stream.sendInput("p", Buffer.from("x"), {
      ...scope,
      source: "input",
      kind: "key",
      activitySequence: 1,
    });
    for (const input of [
      { kind: "key", key: { text: "x" } },
      { kind: "focus", focused: true },
      { kind: "mouse", mouse: { action: "press", button: "four", x: 0, y: 0 } },
      { kind: "paste", bytes: [120] },
    ] as const) {
      await expect(
        f.stream.sendSemantic("p", input, { ...scope, source: "input", kind: input.kind }),
      ).rejects.toThrow();
    }
    expect(write.mock.calls).toHaveLength(0);
    expect(semantic.mock.calls).toHaveLength(0);
    expect(start.mock.calls).toHaveLength(0);
    expect(f.app.history.displayState("p")).toEqual(before);
    const readMaterial = f.app.runtime.readMaterial.bind(f.app.runtime);
    const entered = Promise.withResolvers<void>();
    delayed = spyOn(f.app.runtime, "readMaterial").mockImplementation(async (...args) => {
      const result = await readMaterial(...args);
      entered.resolve();
      await gate.promise;
      return result;
    });
    const pending = f.stream.requestMaterial("p", scope, 4).catch((error) => error);
    await entered.promise;
    await f.client.command({ type: "item.setArchived", itemId: "item", archived: true });
    gate.resolve();
    expect(await pending).toBeInstanceOf(Error);
  } finally {
    gate.resolve();
    delayed?.mockRestore();
    write.mockRestore();
    start.mockRestore();
    semantic.mockRestore();
    await f.close();
  }
});

test("stopped viewer grids never become historical runtime resize markers", async () => {
  const f = await fixture();
  try {
    const split = await f.client.command({
      type: "pane.split",
      paneId: "p",
      direction: "vertical",
      cwd: process.cwd(),
    });
    expect(f.app.runtime.isLive(split.result.paneId!)).toBe(true);
    const before = f.app.history.readForRecovery("p");
    const scope = await f.context();
    f.stream.reportViewport(
      { ...scope, tabId: "tab", canvas: { cols: 120, rows: 30 }, eligible: true },
      scope,
    );
    await f.stream.command(
      { type: "session.navigate", sessionId: "session", target: { kind: "pane", paneId: "p" } },
      f.attached.generation,
    );
    const after = f.app.history.readForRecovery("p");
    expect(after.resizes).toEqual(before.resizes);
    expect(after.cursor).toBe(before.cursor);
    const material = await f.stream.requestMaterial("p", await f.context(), 1);
    expect(material.frame.size).toEqual({ cols: 20, rows: 5 });
    await f.client.command({ type: "process.restart", paneId: "p" });
    const elected = f.app
      .controlSnapshot()
      .geometry.panes.find((pane) => pane.paneId === "p")!.size;
    expect(f.app.history.displayState("p").size).toEqual(elected);
    expect(f.app.history.readForRecovery("p").starts.at(-1)).toMatchObject({
      ...elected,
      runtimeStart: "restored",
    });
  } finally {
    await f.close();
  }
});

import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

import type { ServerMessage } from "../../api/protocol.ts";
import { openDatabase } from "../../persistence/database.ts";
import { createApp } from "../app.ts";

test("Open commits cursor before process effects and returns that exact selection revision", async () => {
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  const messages: ServerMessage[] = [];
  const socket = {
    send(text: string) {
      messages.push(JSON.parse(text));
    },
  } as Bun.ServerWebSocket;
  try {
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    const itemId = (
      await app.execute({ type: "item.create", workspaceId, category: "design", title: "Open me" })
    ).result.id;
    app.subscribe(socket);
    const before = app.snapshot();
    await expect(
      app.execute({ type: "session.openItem", sessionId, itemId: "missing" }),
    ).rejects.toThrow();
    expect(app.snapshot()).toEqual(before);
    const response = await app.execute({
      type: "session.openItem",
      sessionId,
      itemId,
      cwd: tmpdir(),
    });
    const selection = messages.find(
      (message) => message.type === "snapshot" && message.snapshot.navigation[0]?.itemId === itemId,
    );
    expect(selection?.type).toBe("snapshot");
    if (selection?.type !== "snapshot") {
      throw new Error("missing selection commit");
    }
    expect(response.revision).toBe(selection.snapshot.revision);
    expect(selection.snapshot.navigation[0]).toMatchObject({
      itemId,
      paneId: response.result.paneId,
      tabId: response.result.tabId,
      generation: 2,
    });
    const status = messages.find(
      (message) =>
        message.type === "snapshot" && message.snapshot.panes[0]?.processStatus === "starting",
    );
    expect(status?.type === "snapshot" && status.snapshot.revision).toBeGreaterThan(
      response.revision,
    );
    expect(app.snapshot().navigation[0]).toEqual(response.result.navigation!);
  } finally {
    app.unsubscribe(socket);
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
  }
});

test("generation-bound automatic Open rejects a navigation round trip without creating a runtime", async () => {
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  try {
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    const itemId = (
      await app.execute({ type: "item.create", workspaceId, category: "design", title: "Created" })
    ).result.id;
    const generation = app.snapshot().navigation[0]!.generation;
    for (const category of ["operations", "inbox"]) {
      await app.execute({
        type: "session.navigate",
        sessionId,
        target: { kind: "category", category },
      });
    }
    const before = app.snapshot();
    await expect(
      app.execute({
        type: "session.navigate",
        sessionId,
        target: { kind: "workspace", workspaceId },
        navigationGeneration: generation,
      }),
    ).rejects.toThrow("Navigation changed");
    await expect(
      app.execute({
        type: "session.openItem",
        sessionId,
        itemId,
        navigationGeneration: generation,
        cwd: tmpdir(),
      }),
    ).rejects.toThrow("Navigation changed");
    expect(app.snapshot()).toEqual(before);
    const opened = await app.execute({
      type: "session.openItem",
      sessionId,
      itemId,
      navigationGeneration: before.navigation[0]!.generation,
      cwd: tmpdir(),
    });
    expect(opened.result.navigation?.itemId).toBe(itemId);
  } finally {
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
  }
});

test("rapid relative steps resolve current daemon navigation and sessions retain independent tabs", async () => {
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  try {
    const first = (await app.execute({ type: "session.create", name: "First" })).result.id;
    const second = (await app.execute({ type: "session.create", name: "Second" })).result.id;
    const workspaceId = (
      await app.execute({ type: "workspace.create", sessionId: first, name: "Work" })
    ).result.id;
    await app.execute({ type: "session.workspace.add", sessionId: second, workspaceId });
    const itemId = (
      await app.execute({ type: "item.create", workspaceId, category: "design", title: "Shared" })
    ).result.id;
    const opened = await app.execute({
      type: "session.openItem",
      sessionId: first,
      itemId,
      cwd: tmpdir(),
    });
    await app.execute({
      type: "session.navigate",
      sessionId: second,
      target: { kind: "item", itemId },
    });
    for (const title of ["Two", "Three"]) {
      await app.execute({ type: "tab.create", surfaceId: opened.result.surfaceId!, title });
    }
    const before = app.health().revision;
    await Promise.all(
      [1, 2].map(() =>
        app.execute({ type: "session.step", sessionId: first, level: "tab", direction: 1 }),
      ),
    );
    const snapshot = app.snapshot();
    expect(snapshot.navigation.find(({ sessionId }) => sessionId === first)?.tabId).toBe(
      snapshot.tabs[2]!.id,
    );
    expect(snapshot.navigation.find(({ sessionId }) => sessionId === second)?.tabId).toBe(
      opened.result.tabId,
    );
    const clamped = await app.execute({
      type: "session.step",
      sessionId: first,
      level: "tab",
      direction: 1,
    });
    expect(clamped.revision).toBe(before + 2);
  } finally {
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
  }
});

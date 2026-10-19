import { afterEach, expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeBytes, ProtocolError } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import { readSnapshot } from "./snapshot.ts";

const apps: WorkCraftApp[] = [];

function organizationalFixture() {
  const db = openDatabase(":memory:");
  const sessionId = applyCommand(db, { type: "session.create", name: "Main" }).result.id;
  const workspaceId = applyCommand(db, {
    type: "workspace.create",
    sessionId,
    name: "Work",
  }).result.id;
  const rootId = applyCommand(db, {
    type: "item.create",
    workspaceId,
    category: "design",
    title: "Work Craft",
  }).result.id;
  const itemId = applyCommand(db, {
    type: "item.create",
    workspaceId,
    category: "design",
    parentId: rootId,
    title: "First slice",
  }).result.id;
  return { db, workspaceId, rootId, itemId };
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async ({ history, runtime }) => {
      await runtime.stopAll();
      await history.close();
    }),
  );
});

test("creates the durable navigation hierarchy transactionally", () => {
  const db = openDatabase(":memory:");
  const session = applyCommand(db, { type: "session.create", name: "Main" }).result;
  const workspace = applyCommand(db, {
    type: "workspace.create",
    sessionId: session.id,
    name: "Work",
  }).result;
  const root = applyCommand(db, {
    type: "item.create",
    workspaceId: workspace.id,
    category: "design",
    title: "Work Craft",
  }).result;
  applyCommand(db, {
    type: "item.create",
    workspaceId: workspace.id,
    category: "design",
    parentId: root.id,
    title: "First slice",
  });

  const snapshot = readSnapshot(db, "epoch", 4);
  expect(snapshot.workspaces).toContainEqual({ id: workspace.id, name: "Work" });
  expect(snapshot.sessionWorkspaces).toContainEqual({
    sessionId: session.id,
    workspaceId: workspace.id,
    position: 0,
  });
  expect(snapshot.categories.filter((entry) => entry.workspaceId === workspace.id)).toHaveLength(6);
  expect(snapshot.items.find((item) => item.parentId === root.id)?.title).toBe("First slice");
});

test("does not mutate when a parent is missing", () => {
  const db = openDatabase(":memory:");
  expect(() =>
    applyCommand(db, { type: "workspace.create", sessionId: "missing", name: "Nope" }),
  ).toThrow("session not found");
  expect(readSnapshot(db, "epoch", 0).workspaces).toEqual([]);
});

test("directory command returns exact requested and root IDs without runtime effects", () => {
  const { db, workspaceId } = organizationalFixture();
  try {
    const registered = applyCommand(
      db,
      { type: "directory.register", workspaceId, path: "/linked" },
      {
        path: "/linked",
        available: true,
        git: {
          commonDir: "/primary/.git",
          branch: "feature",
          primary: { path: "/primary", branch: null, available: true },
          worktrees: [{ path: "/primary", branch: null, available: true }],
        },
      },
    );
    const snapshot = readSnapshot(db, "e", 0);
    const root = snapshot.items.find((item) => item.kind === "directory")!;
    const child = snapshot.items.find((item) => item.kind === "worktree")!;
    expect(registered.result).toEqual({ id: child.id, itemId: child.id, rootItemId: root.id });
    expect(registered.effects).toEqual([]);
    expect(snapshot.surfaces).toEqual([]);
    expect(snapshot.panes).toEqual([]);
  } finally {
    db.close();
  }
});

test("updates and deletes sessions with contiguous ordering and atomic validation", () => {
  const db = openDatabase(":memory:");
  const first = applyCommand(db, { type: "session.create", name: "First" }).result;
  const second = applyCommand(db, { type: "session.create", name: "Second" }).result;
  const third = applyCommand(db, { type: "session.create", name: "Third" }).result;

  applyCommand(db, {
    type: "session.update",
    sessionId: third.id,
    name: "Renamed",
    position: 0,
  });
  expect(readSnapshot(db, "epoch", 0).sessions).toEqual([
    expect.objectContaining({ id: third.id, name: "Renamed", position: 0 }),
    expect.objectContaining({ id: first.id, position: 1 }),
    expect.objectContaining({ id: second.id, position: 2 }),
  ]);

  expect(() =>
    applyCommand(db, { type: "session.update", sessionId: "missing", name: "Nope" }),
  ).toThrow(new ProtocolError("session not found"));
  expect(() =>
    applyCommand(db, {
      type: "session.update",
      sessionId: third.id,
      name: "Must not rename",
      position: 3,
    }),
  ).toThrow(new ProtocolError("session position out of range"));
  expect(readSnapshot(db, "epoch", 0).sessions[0]?.name).toBe("Renamed");

  applyCommand(db, { type: "session.delete", sessionId: first.id });
  expect(readSnapshot(db, "epoch", 0).sessions).toEqual([
    expect.objectContaining({ id: third.id, position: 0 }),
    expect.objectContaining({ id: second.id, position: 1 }),
  ]);
  expect(() => applyCommand(db, { type: "session.delete", sessionId: "missing" })).toThrow(
    new ProtocolError("session not found"),
  );
});

test("adds and removes workspace memberships idempotently without changing descendants", () => {
  const db = openDatabase(":memory:");
  const firstSessionId = applyCommand(db, { type: "session.create", name: "First" }).result.id;
  const secondSessionId = applyCommand(db, { type: "session.create", name: "Second" }).result.id;
  const workspaceId = applyCommand(db, {
    type: "workspace.create",
    sessionId: firstSessionId,
    name: "Shared",
  }).result.id;
  const rootId = applyCommand(db, {
    type: "item.create",
    workspaceId,
    category: "design",
    title: "Work Craft",
  }).result.id;

  expect(
    applyCommand(db, { type: "session.workspace.add", sessionId: secondSessionId, workspaceId }),
  ).toEqual({
    result: { id: workspaceId, sessionId: secondSessionId, workspaceId },
    effects: [],
    changed: true,
  });
  applyCommand(db, { type: "session.workspace.add", sessionId: secondSessionId, workspaceId });
  let snapshot = readSnapshot(db, "epoch", 0);
  expect(
    snapshot.sessionWorkspaces.filter(
      (membership) =>
        membership.sessionId === secondSessionId && membership.workspaceId === workspaceId,
    ),
  ).toHaveLength(1);
  expect(snapshot.items.filter(({ id }) => id === rootId)).toHaveLength(1);

  applyCommand(db, { type: "session.workspace.remove", sessionId: secondSessionId, workspaceId });
  applyCommand(db, { type: "session.workspace.remove", sessionId: secondSessionId, workspaceId });
  snapshot = readSnapshot(db, "epoch", 0);
  expect(snapshot.sessionWorkspaces).toEqual([
    expect.objectContaining({ sessionId: firstSessionId, workspaceId }),
  ]);
  expect(snapshot.workspaces).toContainEqual({ id: workspaceId, name: "Shared" });
  expect(snapshot.items).toContainEqual(expect.objectContaining({ id: rootId, workspaceId }));

  for (const command of [
    { type: "session.workspace.add", sessionId: "missing", workspaceId },
    { type: "session.workspace.remove", sessionId: "missing", workspaceId },
  ] as const) {
    expect(() => applyCommand(db, command)).toThrow(new ProtocolError("session not found"));
  }
  for (const command of [
    { type: "session.workspace.add", sessionId: firstSessionId, workspaceId: "missing" },
    { type: "session.workspace.remove", sessionId: firstSessionId, workspaceId: "missing" },
  ] as const) {
    expect(() => applyCommand(db, command)).toThrow(new ProtocolError("workspace not found"));
  }
});

test("deleting a session preserves its workspace, history, and live runtime", async () => {
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  apps.push(app);
  const sessionId = (await app.execute({ type: "session.create", name: "Only" })).result.id;
  const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Shared" }))
    .result.id;
  const rootId = (
    await app.execute({
      type: "item.create",
      workspaceId,
      category: "design",
      title: "Work Craft",
    })
  ).result.id;
  const itemId = (
    await app.execute({
      type: "item.create",
      workspaceId,
      category: "design",
      parentId: rootId,
      title: "Shell",
    })
  ).result.id;
  const paneId = (await app.execute({ type: "surface.ensure", itemId })).result.paneId!;
  app.history.append(paneId, new TextEncoder().encode("preserved-history"));
  await app.history.flush();

  await app.execute({ type: "session.delete", sessionId });
  const snapshot = app.snapshot();

  expect(app.runtime.isLive(paneId)).toBe(true);
  expect(snapshot.sessions).toEqual([]);
  expect(snapshot.sessionWorkspaces).toEqual([]);
  expect(snapshot.workspaces).toContainEqual({ id: workspaceId, name: "Shared" });
  expect(snapshot.panes).toContainEqual(expect.objectContaining({ id: paneId }));
  expect(
    new TextDecoder().decode(
      decodeBytes(snapshot.terminalHistories.find((entry) => entry.paneId === paneId)!.data),
    ),
  ).toContain("preserved-history");
});

test("stops the daemon without durable state", () => {
  const db = openDatabase(":memory:");
  expect(applyCommand(db, { type: "daemon.stop" })).toEqual({
    result: { id: "daemon", stopping: true },
    effects: [{ type: "stop-daemon" }],
    changed: false,
  });
  expect(readSnapshot(db, "epoch", 0).sessions).toEqual([]);
});

test("requests daemon destruction without mutating durable state", () => {
  const db = openDatabase(":memory:");
  expect(applyCommand(db, { type: "daemon.destroy" })).toEqual({
    result: { id: "daemon", destroying: true },
    effects: [{ type: "destroy-daemon" }],
    changed: false,
  });
  expect(readSnapshot(db, "epoch", 0).sessions).toEqual([]);
});

test("ensuring an item lazily creates one surface, tab, and shell pane", () => {
  const fixture = organizationalFixture();
  const opened = applyCommand(fixture.db, {
    type: "surface.ensure",
    itemId: fixture.itemId,
    cwd: process.cwd(),
  });
  const reopened = applyCommand(fixture.db, {
    type: "surface.ensure",
    itemId: fixture.itemId,
    cwd: "/must-not-replace-the-original-cwd",
  });
  const snapshot = readSnapshot(fixture.db, "epoch", 0);

  expect(reopened.result.surfaceId).toBe(opened.result.surfaceId);
  expect(reopened.result.itemId).toBe(opened.result.itemId);
  expect(opened.effects).toEqual([{ type: "spawn-pane", paneId: opened.result.paneId! }]);
  expect(reopened.effects).toEqual([]);
  expect(snapshot.surfaces).toHaveLength(1);
  expect(snapshot.tabs).toEqual([
    expect.objectContaining({
      surfaceId: opened.result.surfaceId,
      title: "Main",
      position: 0,
      layout: { type: "pane", paneId: opened.result.paneId },
    }),
  ]);
  expect(snapshot.panes).toEqual([
    expect.objectContaining({
      id: opened.result.paneId,
      cwd: process.cwd(),
      processStatus: "interrupted",
      restorePolicy: {
        type: "shell",
        executable: process.env.SHELL ?? "/bin/sh",
        args: [],
      },
    }),
  ]);
});

test("a generic root directly owns a surface without a synthetic child", () => {
  const fixture = organizationalFixture();
  applyCommand(fixture.db, {
    type: "item.create",
    workspaceId: fixture.workspaceId,
    category: "design",
    parentId: fixture.rootId,
    title: "Other surface",
    data: { scope: "other" },
  });

  const opened = applyCommand(fixture.db, {
    type: "surface.ensure",
    itemId: fixture.rootId,
  });
  const reopened = applyCommand(fixture.db, {
    type: "surface.ensure",
    itemId: fixture.rootId,
    cwd: "/must-not-replace-the-original-cwd",
  });
  const snapshot = readSnapshot(fixture.db, "epoch", 0);

  expect(reopened.result.surfaceId).toBe(opened.result.surfaceId);
  expect(reopened.result.itemId).toBe(opened.result.itemId);
  expect(reopened.effects).toEqual([]);
  expect(snapshot.items).toHaveLength(3);
  expect(opened.result.itemId).toBe(fixture.rootId);
  expect(snapshot.surfaces).toHaveLength(1);
});

test("creates and selects tabs only within their owning surface", () => {
  const fixture = organizationalFixture();
  const secondItemId = applyCommand(fixture.db, {
    type: "item.create",
    workspaceId: fixture.workspaceId,
    category: "design",
    parentId: fixture.rootId,
    title: "Second",
  }).result.id;
  const first = applyCommand(fixture.db, { type: "surface.ensure", itemId: fixture.itemId });
  const second = applyCommand(fixture.db, { type: "surface.ensure", itemId: secondItemId });
  const created = applyCommand(fixture.db, {
    type: "tab.create",
    surfaceId: first.result.surfaceId!,
    title: "Logs",
  });

  expect(created.effects).toEqual([{ type: "spawn-pane", paneId: created.result.paneId! }]);
  expect(
    readSnapshot(fixture.db, "epoch", 0).surfaces.find(({ id }) => id === first.result.surfaceId)
      ?.activeTabId,
  ).toBe(created.result.tabId);

  applyCommand(fixture.db, {
    type: "surface.selectTab",
    surfaceId: first.result.surfaceId!,
    tabId: first.result.tabId!,
  });
  expect(() =>
    applyCommand(fixture.db, {
      type: "surface.selectTab",
      surfaceId: first.result.surfaceId!,
      tabId: second.result.tabId!,
    }),
  ).toThrow(new ProtocolError("tab not found for surface"));
  expect(
    readSnapshot(fixture.db, "epoch", 0).surfaces.find(({ id }) => id === first.result.surfaceId)
      ?.activeTabId,
  ).toBe(first.result.tabId);
});

test("splits a pane with a resolved cwd and its source restore policy", () => {
  const fixture = organizationalFixture();
  const opened = applyCommand(fixture.db, {
    type: "surface.ensure",
    itemId: fixture.itemId,
    cwd: "/tmp",
  });
  fixture.db
    .query("UPDATE panes SET restore_policy_json = ? WHERE id = ?")
    .run(
      JSON.stringify({ type: "shell", executable: "/bin/sh", args: ["-l"] }),
      opened.result.paneId!,
    );
  const inherited = applyCommand(fixture.db, {
    type: "pane.split",
    paneId: opened.result.paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  });
  const overridden = applyCommand(fixture.db, {
    type: "pane.split",
    paneId: inherited.result.paneId!,
    direction: "horizontal",
    cwd: process.cwd(),
  });
  const snapshot = readSnapshot(fixture.db, "epoch", 0);

  expect(inherited.effects).toEqual([{ type: "spawn-pane", paneId: inherited.result.paneId! }]);
  expect(snapshot.panes.find(({ id }) => id === inherited.result.paneId)).toMatchObject({
    surfaceId: opened.result.surfaceId,
    cwd: process.cwd(),
    restorePolicy: { type: "shell", executable: "/bin/sh", args: ["-l"] },
  });
  expect(snapshot.panes.find(({ id }) => id === overridden.result.paneId)).toMatchObject({
    cwd: process.cwd(),
    restorePolicy: { type: "shell", executable: "/bin/sh", args: ["-l"] },
  });
  expect(snapshot.tabs[0]?.layout).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: opened.result.paneId! },
    second: {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "pane", paneId: inherited.result.paneId! },
      second: { type: "pane", paneId: overridden.result.paneId! },
    },
  });
});

test("unresolved domain split cannot silently inherit startup cwd", () => {
  const { db, itemId } = organizationalFixture();
  const { paneId } = applyCommand(db, { type: "surface.ensure", itemId }).result;
  const before = readSnapshot(db, "epoch", 0);
  expect(() =>
    applyCommand(db, { type: "pane.split", paneId: paneId!, direction: "vertical" }),
  ).toThrow();
  expect(readSnapshot(db, "epoch", 0)).toEqual(before);
});

for (const target of ["itemId", "rootId"] as const) {
  test(`domain split rejects an archived ${target} without changing layout`, () => {
    const fixture = organizationalFixture();
    const { paneId } = applyCommand(fixture.db, {
      type: "surface.ensure",
      itemId: fixture.itemId,
    }).result;
    applyCommand(fixture.db, {
      type: "item.setArchived",
      itemId: fixture[target],
      archived: true,
    });
    const before = readSnapshot(fixture.db, "epoch", 0);
    expect(() =>
      applyCommand(fixture.db, {
        type: "pane.split",
        paneId: paneId!,
        direction: "vertical",
        cwd: process.cwd(),
      }),
    ).toThrow(/archived/);
    expect(readSnapshot(fixture.db, "epoch", 0)).toEqual(before);
  });
}

for (const membership of ["missing", "duplicate", "foreign", "duplicate leaf"] as const) {
  test(`split rolls back when source tab membership is ${membership}`, () => {
    const { db, rootId, itemId } = organizationalFixture();
    const { paneId, tabId } = applyCommand(db, { type: "surface.ensure", itemId }).result;
    const other = applyCommand(db, { type: "surface.ensure", itemId: rootId }).result;
    const leaf = { type: "pane", paneId };
    if (membership === "missing" || membership === "foreign") {
      db.query("UPDATE tabs SET layout_json = NULL WHERE id = ?").run(tabId!);
    }
    if (membership === "duplicate" || membership === "foreign") {
      db.query("UPDATE tabs SET layout_json = ? WHERE id = ?").run(
        JSON.stringify(leaf),
        other.tabId!,
      );
    }
    if (membership === "duplicate leaf") {
      db.query("UPDATE tabs SET layout_json = ? WHERE id = ?").run(
        JSON.stringify({
          type: "split",
          direction: "vertical",
          ratio: 0.8,
          first: leaf,
          second: leaf,
        }),
        tabId!,
      );
    }
    const before = readSnapshot(db, "epoch", 0);
    expect(() =>
      applyCommand(db, {
        type: "pane.split",
        paneId: paneId!,
        direction: "vertical",
        cwd: process.cwd(),
      }),
    ).toThrow();
    expect(readSnapshot(db, "epoch", 0)).toEqual(before);
  });
}

test("failed live-cwd preflight preserves all structural state and existing runtime", async () => {
  const { db, itemId } = organizationalFixture();
  const app = createApp({ db });
  apps.push(app);
  const { paneId, tabId } = (await app.execute({ type: "surface.ensure", itemId })).result;
  const oldSplit = await app.execute({
    type: "pane.split",
    paneId: paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  });
  db.query("UPDATE tabs SET layout_json = json_set(layout_json, '$.ratio', 0.8) WHERE id = ?").run(
    tabId!,
  );
  const inspect = spyOn(app.runtime, "currentDirectory").mockRejectedValue(
    new Error("cwd inspection unavailable"),
  );
  try {
    const before = app.snapshot();
    await expect(
      app.execute({ type: "pane.split", paneId: paneId!, direction: "vertical" }),
    ).rejects.toThrow(new ProtocolError("cwd inspection unavailable"));
    const after = app.snapshot();
    expect(after.panes).toEqual(before.panes);
    expect(after.tabs).toEqual(before.tabs);
    expect(after.revision).toBe(before.revision);
    expect(app.runtime.isLive(paneId!)).toBe(true);
    expect(app.runtime.isLive(oldSplit.result.id)).toBe(true);
  } finally {
    inspect.mockRestore();
  }
});

test("explicit split cwd bypasses discovery even for a stopped source", async () => {
  const { db, itemId } = organizationalFixture();
  const { paneId } = applyCommand(db, { type: "surface.ensure", itemId }).result;
  const app = createApp({ db });
  apps.push(app);
  const inspect = spyOn(app.runtime, "currentDirectory").mockRejectedValue(
    new Error("discovery must not run for an override"),
  );
  try {
    const before = app.snapshot();
    await expect(
      app.execute({ type: "pane.split", paneId: paneId!, direction: "vertical" }),
    ).rejects.toThrow();
    expect(app.snapshot()).toEqual(before);
    const split = await app.execute({
      type: "pane.split",
      paneId: paneId!,
      direction: "vertical",
      cwd: process.cwd(),
    });
    expect(app.snapshot().panes.find(({ id }) => id === split.result.id)?.cwd).toBe(process.cwd());
    expect(app.runtime.isLive(split.result.id)).toBe(true);
    expect(app.runtime.isLive(paneId!)).toBe(false);
  } finally {
    inspect.mockRestore();
  }
});

test("unknown or missing split cwd rejects before mutation", async () => {
  const { db, itemId } = organizationalFixture();
  const { paneId } = applyCommand(db, { type: "surface.ensure", itemId }).result;
  const app = createApp({ db });
  apps.push(app);
  const before = app.snapshot();
  for (const command of [
    { paneId: "missing", cwd: process.cwd() },
    { paneId: paneId! },
    { paneId: paneId!, cwd: join(tmpdir(), `missing-${crypto.randomUUID()}`) },
    { paneId: paneId!, cwd: "relative" },
  ]) {
    await expect(
      app.execute({ type: "pane.split", direction: "vertical", ...command }),
    ).rejects.toThrow();
    expect(app.snapshot()).toEqual(before);
  }
});

for (const target of ["itemId", "rootId"] as const) {
  test(`split rechecks ${target} archival after live-cwd await`, async () => {
    const fixture = organizationalFixture();
    const { paneId } = applyCommand(fixture.db, {
      type: "surface.ensure",
      itemId: fixture.itemId,
    }).result;
    const app = createApp({ db: fixture.db });
    apps.push(app);
    let resolve!: (cwd: string) => void;
    const cwd = new Promise<string>((ready) => {
      resolve = ready;
    });
    const inspect = spyOn(app.runtime, "currentDirectory").mockReturnValue(cwd);
    try {
      const initial = app.snapshot();
      const pending = app.execute({ type: "pane.split", paneId: paneId!, direction: "vertical" });
      expect(fixture.db.inTransaction).toBe(false);
      expect(app.snapshot()).toEqual(initial);
      await app.execute({ type: "item.setArchived", itemId: fixture[target], archived: true });
      const before = app.snapshot();
      resolve(process.cwd());
      await expect(pending).rejects.toThrow(/archived/);
      expect(app.snapshot()).toEqual(before);
    } finally {
      inspect.mockRestore();
    }
  });
}

test("valid live cwd is not gated by stale directory availability", async () => {
  const { db, workspaceId } = organizationalFixture();
  const { itemId } = applyCommand(
    db,
    { type: "directory.register", workspaceId, path: process.cwd() },
    { path: process.cwd(), available: true, git: null },
  ).result;
  const app = createApp({ db });
  apps.push(app);
  const { paneId } = (await app.execute({ type: "surface.ensure", itemId: itemId! })).result;
  db.query(
    "UPDATE items SET data_json = json_set(data_json, '$.availability', 'unavailable') WHERE id = ?",
  ).run(itemId!);
  const split = await app.execute({ type: "pane.split", paneId: paneId!, direction: "vertical" });
  expect(app.runtime.isLive(paneId!)).toBe(true);
  expect(app.runtime.isLive(split.result.id)).toBe(true);
});

test("split equalizes untouched branches in its tab but preserves other tab ratios", () => {
  const { db, itemId } = organizationalFixture();
  const opened = applyCommand(db, { type: "surface.ensure", itemId }).result;
  const second = applyCommand(db, {
    type: "pane.split",
    paneId: opened.paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  }).result;
  const third = applyCommand(db, {
    type: "pane.split",
    paneId: second.paneId!,
    direction: "horizontal",
    cwd: process.cwd(),
  }).result;
  const other = applyCommand(db, {
    type: "tab.create",
    surfaceId: opened.surfaceId!,
    title: "Unchanged",
  }).result;
  applyCommand(db, {
    type: "pane.split",
    paneId: other.paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  });
  db.query(
    "UPDATE tabs SET layout_json = json_set(layout_json, '$.ratio', 0.8, '$.second.ratio', 0.7) WHERE id = ?",
  ).run(opened.tabId!);
  db.query("UPDATE tabs SET layout_json = json_set(layout_json, '$.ratio', 0.9) WHERE id = ?").run(
    other.tabId!,
  );
  const before = readSnapshot(db, "epoch", 0);
  const split = applyCommand(db, {
    type: "pane.split",
    paneId: opened.paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  });
  const after = readSnapshot(db, "epoch", 0);
  expect(after.tabs.find(({ id }) => id === other.tabId)).toEqual(
    before.tabs.find(({ id }) => id === other.tabId),
  );
  expect(after.surfaces).toEqual(before.surfaces);
  expect(after.panes.filter(({ id }) => id !== split.result.id)).toEqual(before.panes);
  expect(after.tabs.find(({ id }) => id === opened.tabId)?.layout).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 2 / 3,
    first: {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: opened.paneId! },
      second: { type: "pane", paneId: split.result.id },
    },
    second: {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "pane", paneId: second.paneId! },
      second: { type: "pane", paneId: third.paneId! },
    },
  });
});

test("committed spawn failure keeps the equalized pane and all old runtimes", async () => {
  const { db, itemId } = organizationalFixture();
  const app = createApp({ db });
  apps.push(app);
  const opened = (await app.execute({ type: "surface.ensure", itemId })).result;
  const second = (
    await app.execute({
      type: "pane.split",
      paneId: opened.paneId!,
      direction: "vertical",
      cwd: process.cwd(),
    })
  ).result;
  db.query("UPDATE tabs SET layout_json = json_set(layout_json, '$.ratio', 0.8) WHERE id = ?").run(
    opened.tabId!,
  );
  db.query("UPDATE panes SET restore_policy_json = ? WHERE id = ?").run(
    JSON.stringify({ type: "shell", executable: "/missing-work-craft-shell", args: [] }),
    opened.paneId!,
  );
  const before = app.snapshot();
  const split = await app.execute({
    type: "pane.split",
    paneId: opened.paneId!,
    direction: "vertical",
    cwd: process.cwd(),
  });
  const after = app.snapshot();
  expect(split.ok).toBe(true);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.panes.find(({ id }) => id === split.result.id)).toMatchObject({
    processStatus: "failed",
    errorText: expect.any(String),
  });
  expect(after.panes.filter(({ id }) => id !== split.result.id)).toEqual(before.panes);
  expect(after.tabs[0]?.layout).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 2 / 3,
    first: {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: opened.paneId! },
      second: { type: "pane", paneId: split.result.id },
    },
    second: { type: "pane", paneId: second.paneId! },
  });
  expect(app.runtime.isLive(opened.paneId!)).toBe(true);
  expect(app.runtime.isLive(second.paneId!)).toBe(true);
});

test("restart validates the pane and returns a spawn intent without runtime ownership", () => {
  const fixture = organizationalFixture();
  expect(() => applyCommand(fixture.db, { type: "process.restart", paneId: "missing" })).toThrow(
    new ProtocolError("pane not found"),
  );
  const opened = applyCommand(fixture.db, { type: "surface.ensure", itemId: fixture.itemId });

  expect(
    applyCommand(fixture.db, { type: "process.restart", paneId: opened.result.paneId! }),
  ).toEqual({
    result: { id: opened.result.paneId!, paneId: opened.result.paneId! },
    effects: [{ type: "spawn-pane", paneId: opened.result.paneId! }],
    changed: false,
  });
});

test("app starts committed panes once and suppresses a live restart without a revision", async () => {
  const fixture = organizationalFixture();
  const app = createApp({ db: fixture.db });
  apps.push(app);

  const opened = await app.execute({ type: "surface.ensure", itemId: fixture.itemId });
  const revision = opened.revision;
  const paneId = opened.result.paneId!;
  expect(app.runtime.isLive(paneId)).toBe(true);

  expect((await app.execute({ type: "surface.ensure", itemId: fixture.itemId })).revision).toBe(
    revision,
  );
  expect((await app.execute({ type: "process.restart", paneId })).revision).toBe(revision);
  expect(app.runtime.isLive(paneId)).toBe(true);
});

test("app keeps committed surface state when spawning fails", async () => {
  const fixture = organizationalFixture();
  const app = createApp({ db: fixture.db });
  apps.push(app);
  const cwd = join(tmpdir(), `work-craft-missing-${crypto.randomUUID()}`);

  const response = await app.execute({ type: "surface.ensure", itemId: fixture.itemId, cwd });
  const snapshot = app.snapshot();

  expect(response.ok).toBe(true);
  expect(snapshot.surfaces).toHaveLength(1);
  expect(snapshot.tabs).toHaveLength(1);
  expect(snapshot.panes).toEqual([
    expect.objectContaining({
      id: response.result.paneId,
      cwd,
      processStatus: "failed",
      errorText: expect.stringContaining(cwd),
    }),
  ]);
});

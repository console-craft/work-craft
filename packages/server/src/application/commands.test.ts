import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import { openDatabase } from "../persistence/database.ts";
import { ProtocolError } from "../api/protocol.ts";
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
  const projectId = applyCommand(db, {
    type: "project.create",
    workspaceId,
    category: "implementation",
    name: "Work Craft",
  }).result.id;
  const itemId = applyCommand(db, {
    type: "item.create",
    projectId,
    kind: "generic",
    title: "First slice",
  }).result.id;
  return { db, projectId, itemId };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(({ runtime }) => runtime.stopAll()));
});

test("creates the durable navigation hierarchy transactionally", () => {
  const db = openDatabase(":memory:");
  const session = applyCommand(db, { type: "session.create", name: "Main" }).result;
  const workspace = applyCommand(db, {
    type: "workspace.create",
    sessionId: session.id,
    name: "Work",
  }).result;
  const project = applyCommand(db, {
    type: "project.create",
    workspaceId: workspace.id,
    category: "implementation",
    name: "Work Craft",
  }).result;
  applyCommand(db, {
    type: "item.create",
    projectId: project.id,
    kind: "generic",
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
  expect(snapshot.items[0]?.title).toBe("First slice");
});

test("does not mutate when a parent is missing", () => {
  const db = openDatabase(":memory:");
  expect(() =>
    applyCommand(db, { type: "workspace.create", sessionId: "missing", name: "Nope" }),
  ).toThrow("session not found");
  expect(readSnapshot(db, "epoch", 0).workspaces).toEqual([]);
});

test("stops the daemon without durable state", () => {
  const db = openDatabase(":memory:");
  expect(applyCommand(db, { type: "daemon.stop" })).toEqual({
    result: { id: "daemon", stopping: true },
    effects: [{ type: "stop-daemon" }],
  });
  expect(readSnapshot(db, "epoch", 0).sessions).toEqual([]);
});

test("requests daemon destruction without mutating durable state", () => {
  const db = openDatabase(":memory:");
  expect(applyCommand(db, { type: "daemon.destroy" })).toEqual({
    result: { id: "daemon", destroying: true },
    effects: [{ type: "destroy-daemon" }],
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

test("ensureHere creates and reuses only the project-terminal item", () => {
  const fixture = organizationalFixture();
  applyCommand(fixture.db, {
    type: "item.create",
    projectId: fixture.projectId,
    kind: "surface",
    title: "Other surface",
    data: { scope: "other" },
  });

  const opened = applyCommand(fixture.db, {
    type: "surface.ensureHere",
    projectId: fixture.projectId,
  });
  const reopened = applyCommand(fixture.db, {
    type: "surface.ensureHere",
    projectId: fixture.projectId,
    cwd: "/must-not-replace-the-original-cwd",
  });
  const snapshot = readSnapshot(fixture.db, "epoch", 0);

  expect(reopened.result.surfaceId).toBe(opened.result.surfaceId);
  expect(reopened.result.itemId).toBe(opened.result.itemId);
  expect(reopened.effects).toEqual([]);
  expect(snapshot.items.filter(({ data }) => data.scope === "project-terminal")).toEqual([
    expect.objectContaining({ id: opened.result.itemId, projectId: fixture.projectId }),
  ]);
  expect(snapshot.surfaces).toHaveLength(1);
});

test("creates and selects tabs only within their owning surface", () => {
  const fixture = organizationalFixture();
  const secondItemId = applyCommand(fixture.db, {
    type: "item.create",
    projectId: fixture.projectId,
    kind: "generic",
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

test("splits a pane with its durable policy and inherits cwd unless overridden", () => {
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
    cwd: "/tmp",
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

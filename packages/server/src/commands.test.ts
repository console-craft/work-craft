import { expect, test } from "bun:test";
import { applyCommand } from "./commands.ts";
import { openDatabase } from "./database.ts";
import { ProtocolError } from "./protocol.ts";
import type { Command } from "./protocol.ts";
import { readSnapshot } from "./snapshot.ts";

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
  expect(snapshot.workspaces[0]?.name).toBe("Work");
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

test("rejects surface commands before the runtime phase", () => {
  const db = openDatabase(":memory:");
  const commands: Command[] = [
    { type: "surface.open", itemId: "item" },
    { type: "surface.openHere", projectId: "project" },
    { type: "tab.create", surfaceId: "surface", title: "Tab" },
    { type: "surface.selectTab", surfaceId: "surface", tabId: "tab" },
    { type: "pane.split", paneId: "pane", direction: "horizontal" },
    { type: "process.restart", paneId: "pane" },
  ];

  for (const command of commands) {
    expect(() => applyCommand(db, command)).toThrow(
      new ProtocolError("surface commands are not available before the runtime phase"),
    );
  }
});

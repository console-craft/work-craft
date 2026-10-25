import { expect, test } from "bun:test";

import {
  decodeBytes,
  encodeBytes,
  parseClientMessage,
  parseCommand,
  ProtocolError,
} from "../protocol.ts";

test("parses ensure and destroy commands", () => {
  expect(parseCommand({ type: "surface.ensure", itemId: "item-1", cwd: "/tmp" })).toEqual({
    type: "surface.ensure",
    itemId: "item-1",
    cwd: "/tmp",
  });
  expect(
    parseCommand({ type: "directory.register", workspaceId: "workspace-1", path: "/tmp" }),
  ).toEqual({
    type: "directory.register",
    workspaceId: "workspace-1",
    path: "/tmp",
  });
  expect(parseCommand({ type: "daemon.destroy" })).toEqual({ type: "daemon.destroy" });
});

test("automatic Open preserves a valid navigation generation and rejects malformed guards", () => {
  const command = {
    type: "session.openItem" as const,
    sessionId: "s",
    itemId: "i",
    navigationGeneration: 2,
  };
  expect(parseCommand(command)).toEqual(command);
  const selection = {
    type: "session.navigate" as const,
    sessionId: "s",
    target: { kind: "workspace" as const, workspaceId: "w" },
    navigationGeneration: 2,
  };
  expect(parseCommand(selection)).toEqual(selection);
  for (const navigationGeneration of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
    expect(() => parseCommand({ ...command, navigationGeneration })).toThrow(ProtocolError);
    expect(() => parseCommand({ ...selection, navigationGeneration })).toThrow(ProtocolError);
  }
});

test("parses session and workspace membership commands", () => {
  expect(
    parseCommand({ type: "session.update", sessionId: "s1", name: "Work", position: 0 }),
  ).toEqual({
    type: "session.update",
    sessionId: "s1",
    name: "Work",
    position: 0,
  });
  expect(parseCommand({ type: "session.delete", sessionId: "s1" })).toEqual({
    type: "session.delete",
    sessionId: "s1",
  });
  expect(
    parseCommand({ type: "session.workspace.add", sessionId: "s1", workspaceId: "w1" }),
  ).toEqual({
    type: "session.workspace.add",
    sessionId: "s1",
    workspaceId: "w1",
  });
  expect(
    parseCommand({ type: "session.workspace.remove", sessionId: "s1", workspaceId: "w1" }),
  ).toEqual({
    type: "session.workspace.remove",
    sessionId: "s1",
    workspaceId: "w1",
  });
});

test("parses protocol messages and rejects invalid boundaries", () => {
  const context = {
    epoch: "e",
    attachmentGeneration: 1,
    navigationGeneration: 2,
    geometrySequence: 3,
    source: "input" as const,
    kind: "key" as const,
  };
  expect(
    parseClientMessage({ type: "terminal.input", paneId: "pane-1", data: "bHMK", context }),
  ).toEqual({
    type: "terminal.input",
    paneId: "pane-1",
    data: "bHMK",
    context,
  });

  const invalidValues = [
    () => parseCommand({ type: "session.create", name: "  " }),
    () => parseCommand({ type: "session.update", sessionId: "s1" }),
    () => parseCommand({ type: "session.update", sessionId: "s1", name: "  " }),
    () => parseCommand({ type: "session.update", sessionId: "s1", position: -1 }),
    () => parseCommand({ type: "session.update", sessionId: "s1", position: 0.5 }),
    () => parseCommand({ type: "session.update", name: "Work" }),
    () => parseCommand({ type: "session.delete" }),
    () => parseCommand({ type: "session.workspace.add", sessionId: "s1" }),
    () => parseCommand({ type: "session.workspace.remove", workspaceId: "w1" }),
    () => parseCommand({ type: "tab.create", surfaceId: "surface-1", title: "" }),
    () => parseCommand({ type: "pane.split", direction: "horizontal" }),
    () => parseCommand({ type: "surface.open", itemId: "item-1" }),
    () => parseCommand({ type: "surface.openHere", projectId: "project-1" }),
    () => parseCommand({ type: "not-a-command" }),
    () => parseCommand({ type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-1" }),
    () => parseClientMessage({ type: "terminal.input", paneId: "pane-1", data: "not base64" }),
    () => parseClientMessage({ type: "terminal.resize", paneId: "pane-1", cols: 0, rows: 24 }),
  ];
  for (const parse of invalidValues) {
    expect(parse).toThrow(ProtocolError);
  }
});

test("round-trips raw terminal bytes through base64", () => {
  const bytes = Uint8Array.from([0, 255, 27, 91, 109]);
  expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
});

test("validation errors retain an optional field without changing operational errors", () => {
  expect(new ProtocolError("invalid", "path").field).toBe("path");
  expect(new ProtocolError("failed").field).toBeUndefined();
});

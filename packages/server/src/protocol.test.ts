import { expect, test } from "bun:test";
import {
  ProtocolError,
  decodeBytes,
  encodeBytes,
  parseClientMessage,
  parseCommand,
} from "./protocol.ts";

test("parses protocol messages and rejects invalid boundaries", () => {
  expect(parseCommand({ type: "surface.open", itemId: "item-1", cwd: "/tmp" })).toEqual({
    type: "surface.open",
    itemId: "item-1",
    cwd: "/tmp",
  });
  expect(parseClientMessage({ type: "terminal.input", paneId: "pane-1", data: "ls\n" })).toEqual({
    type: "terminal.input",
    paneId: "pane-1",
    data: "ls\n",
  });

  const invalidValues = [
    () => parseCommand({ type: "session.create", name: "  " }),
    () => parseCommand({ type: "tab.create", surfaceId: "surface-1", title: "" }),
    () => parseCommand({ type: "pane.split", direction: "horizontal" }),
    () => parseCommand({ type: "not-a-command" }),
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

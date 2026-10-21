import { expect, test } from "bun:test";

import { CATEGORIES } from "../application/categories.ts";
import { createTerminalSizing } from "../application/sizing.ts";
import { type CommandOrigin, createConnections, type InteractiveSnapshot } from "./connections.ts";
import {
  type CommandResponse,
  encodeBytes,
  type InputStamp,
  type InteractiveServerMessage,
  ProtocolError,
} from "./protocol.ts";

function socketFixture() {
  const messages: InteractiveServerMessage[] = [];
  const closed: number[] = [];
  const socket = {
    send: (body: string) => {
      messages.push(JSON.parse(body));
      return body.length;
    },
    close: (code: number) => {
      closed.push(code);
    },
  } as unknown as Bun.ServerWebSocket;
  return { socket, messages, closed };
}

function fixture() {
  const data: Omit<InteractiveSnapshot, "geometry"> = {
    epoch: "e",
    revision: 1,
    sessions: [
      { id: "s", name: "First", position: 0 },
      { id: "other", name: "Other", position: 1 },
    ],
    workspaces: [{ id: "w", name: "Work" }],
    sessionWorkspaces: [
      { sessionId: "s", workspaceId: "w", position: 0 },
      { sessionId: "other", workspaceId: "w", position: 0 },
    ],
    categories: CATEGORIES.map((category) => ({ ...category, workspaceId: "w" })),
    items: [
      {
        id: "item",
        workspaceId: "w",
        category: "inbox",
        parentId: null,
        kind: "generic",
        title: "Item",
        position: 0,
        archived: false,
        data: {},
      },
    ],
    surfaces: [{ id: "surface", itemId: "item" }],
    tabs: [1, 2].map((n) => ({
      id: `tab-${n}`,
      surfaceId: "surface",
      title: "Tab",
      position: n,
      layout: { type: "pane" as const, paneId: `pane-${n}` },
    })),
    panes: [1, 2].map((n) => ({
      id: `pane-${n}`,
      surfaceId: "surface",
      kind: "terminal" as const,
      title: "Shell",
      cwd: "/",
      restorePolicy: { type: "shell" as const, executable: "/bin/sh", args: [] },
      processStatus: "running" as const,
      errorText: null,
      startedAt: null,
      exitedAt: null,
    })),
    navigation: ["s", "other"].map((sessionId) => ({
      sessionId,
      generation: 0,
      workspaceId: "w",
      category: "inbox" as const,
      itemId: "item",
      tabId: "tab-1",
      paneId: "pane-1",
    })),
  };
  const sizing = createTerminalSizing(data);
  const inputs: { paneId: string; data: string; source: string; owner: string | null }[] = [];
  const reports: unknown[] = [];
  const disconnected: string[] = [];
  let execute = async (_value: unknown, _origin: CommandOrigin): Promise<CommandResponse> => ({
    ok: true,
    revision: 1,
    result: { id: "result" },
  });
  const snapshot = (): InteractiveSnapshot => ({ ...data, geometry: sizing.current() });
  const registry = createConnections({
    epoch: "e",
    snapshot,
    execute: (value, origin) => execute(value, origin),
    onViewer(id, report) {
      reports.push(report);
      sizing.report(id, report);
    },
    onAttachActivity(id) {
      sizing.attachmentActivity(id);
    },
    onActivity(id, sequence) {
      sizing.activity(id, sequence);
    },
    onDisconnect(id) {
      disconnected.push(id);
      sizing.remove(id);
    },
    onInput(paneId, bytes, source) {
      inputs.push({
        paneId,
        data: new TextDecoder().decode(bytes),
        source,
        owner: sizing.current().tabs[0]?.ownerConnectionId ?? null,
      });
    },
  });
  function stamp(socket: Bun.ServerWebSocket): InputStamp {
    const attachment = registry.attachment(socket)!;
    const navigation = data.navigation.find(({ sessionId }) => sessionId === attachment.sessionId)!;
    return {
      epoch: "e",
      attachmentGeneration: attachment.generation,
      navigationGeneration: navigation.generation,
      geometrySequence:
        sizing.current().tabs.find(({ tabId }) => tabId === navigation.tabId)?.generation ?? 0,
    };
  }
  async function attach(socket: Bun.ServerWebSocket, sessionId = "s", requestId = 1) {
    await registry.receive(socket, { type: "client.attach", requestId, sessionId });
  }
  async function report(socket: Bun.ServerWebSocket, cols = 100, rows = 30) {
    const current = stamp(socket);
    await registry.receive(socket, {
      type: "client.viewport",
      stamp: current,
      report: { ...current, tabId: "tab-1", canvas: { cols, rows }, eligible: true },
    });
  }
  async function input(
    socket: Bun.ServerWebSocket,
    captured = stamp(socket),
    source: "input" | "response" = "input",
    paneId = "pane-1",
    activitySequence?: number,
  ) {
    await registry.receive(socket, {
      type: "terminal.input",
      paneId,
      data: encodeBytes(new TextEncoder().encode("x")),
      context:
        source === "response"
          ? { ...captured, source }
          : { ...captured, source, kind: "key", activitySequence },
    });
  }
  return {
    registry,
    sizing,
    data,
    inputs,
    reports,
    disconnected,
    snapshot,
    stamp,
    attach,
    report,
    input,
    setExecute(next: typeof execute) {
      execute = next;
    },
  };
}

test("an obsolete attachment cannot write or withdraw a new session's viewer", async () => {
  const setup = fixture();
  const a = socketFixture();
  const b = socketFixture();
  setup.registry.open(a.socket);
  setup.registry.open(b.socket);
  await setup.attach(a.socket);
  await setup.attach(b.socket);
  const old = setup.stamp(a.socket);
  await setup.attach(a.socket, "other", 2);
  await setup.report(a.socket);
  const count = setup.reports.length;
  await setup.input(a.socket, old);
  await setup.registry.receive(a.socket, { type: "client.viewport", stamp: old, report: null });
  await setup.registry.receive(a.socket, {
    type: "client.command",
    requestId: 3,
    attachmentGeneration: old.attachmentGeneration,
    command: { type: "session.create", name: "stale" },
  });
  expect(setup.inputs).toEqual([]);
  expect(setup.reports).toHaveLength(count);
  expect(setup.registry.attachment(b.socket)?.sessionId).toBe("s");
  expect(a.messages.at(-1)).toMatchObject({ type: "command.error", requestId: 3 });
  expect(a.closed).toEqual([]);
});

test("selection away and back never revalidates captured input", async () => {
  const setup = fixture();
  const a = socketFixture();
  setup.registry.open(a.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  const old = setup.stamp(a.socket);
  setup.data.navigation[0]!.generation += 2;
  await setup.input(a.socket, old);
  await setup.input(a.socket);
  expect(setup.inputs.map(({ data }) => data)).toEqual(["x"]);
});

test("sizing handoff applies before the first accepted key without dropping it", async () => {
  const setup = fixture();
  const a = socketFixture();
  const b = socketFixture();
  const idA = setup.registry.open(a.socket);
  setup.registry.open(b.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  await setup.attach(b.socket);
  await setup.report(b.socket, 70, 20);
  await setup.input(a.socket, setup.stamp(a.socket), "input", "pane-1", 1);
  expect(setup.inputs).toEqual([{ paneId: "pane-1", data: "x", source: "input", owner: idA }]);
  expect(setup.sizing.current().panes[0]?.size).toEqual({ cols: 100, rows: 29 });
});

test("only the current owner can answer terminal queries, including an unselected sibling", async () => {
  const setup = fixture();
  setup.data.tabs[0]!.layout = {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: "pane-1" },
    second: { type: "pane", paneId: "pane-2" },
  };
  setup.data.tabs.splice(1);
  setup.sizing.reconcile(setup.data);
  const a = socketFixture();
  const b = socketFixture();
  setup.registry.open(a.socket);
  setup.registry.open(b.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  const old = setup.stamp(a.socket);
  await setup.attach(b.socket);
  await setup.report(b.socket);
  await setup.input(a.socket, old, "response", "pane-2");
  await setup.input(a.socket, setup.stamp(a.socket), "response", "pane-2");
  await setup.input(b.socket, setup.stamp(b.socket), "response", "pane-2");
  expect(setup.inputs.map(({ paneId, source }) => ({ paneId, source }))).toEqual([
    { paneId: "pane-2", source: "response" },
  ]);
});

test("programmatic focus does not count as new sizing activity", async () => {
  const setup = fixture();
  const a = socketFixture();
  const b = socketFixture();
  setup.registry.open(a.socket);
  const idB = setup.registry.open(b.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  await setup.attach(b.socket);
  await setup.report(b.socket);
  await setup.registry.receive(a.socket, {
    type: "terminal.input",
    paneId: "pane-1",
    data: encodeBytes(new TextEncoder().encode("\x1b[I")),
    context: { ...setup.stamp(a.socket), source: "input", kind: "focus" },
  });
  expect(setup.sizing.current().tabs[0]?.ownerConnectionId).toBe(idB);
});

test("session deletion detaches to null and disconnect removes its sizing candidate", async () => {
  const setup = fixture();
  const a = socketFixture();
  const id = setup.registry.open(a.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  setup.data.sessions = setup.data.sessions.filter(({ id }) => id !== "s");
  setup.registry.reconcile();
  expect(setup.registry.attachment(a.socket)).toMatchObject({ sessionId: null, generation: 2 });
  expect(a.messages.at(-1)).toMatchObject({
    type: "client.attached",
    requestId: null,
    attachment: { sessionId: null },
  });
  setup.registry.close(a.socket);
  expect(setup.disconnected).toEqual([id]);
  expect(setup.registry.attachment(a.socket)).toBeNull();
});

test("an asynchronous RPC does not block attachment changes and retains its original origin", async () => {
  const setup = fixture();
  const a = socketFixture();
  setup.registry.open(a.socket);
  await setup.attach(a.socket);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  setup.setExecute(async (_command, origin) => {
    await pending;
    if (!setup.registry.isCurrent(origin)) {
      throw new ProtocolError("Attachment changed during preflight");
    }
    return { ok: true, revision: 1, result: { id: "wrong" } };
  });
  const rpc = setup.registry.receive(a.socket, {
    type: "client.command",
    requestId: 2,
    attachmentGeneration: 1,
    command: {},
  });
  await setup.attach(a.socket, "other", 3);
  finish();
  await rpc;
  expect(a.messages.at(-1)).toMatchObject({
    type: "command.error",
    requestId: 2,
    message: "Attachment changed during preflight",
  });
});

for (const bad of [
  null,
  { type: "terminal.resize", paneId: "pane-1", cols: 80, rows: 24 },
  { type: "client.attach", requestId: 1.5, sessionId: "s" },
]) {
  test(`malformed interactive payload closes the stream: ${JSON.stringify(bad)}`, async () => {
    const setup = fixture();
    const a = socketFixture();
    setup.registry.open(a.socket);
    await setup.registry.receive(a.socket, bad);
    expect(a.closed).toEqual([1008]);
  });
}

test("reused request IDs close the connection rather than execute twice", async () => {
  const setup = fixture();
  const a = socketFixture();
  setup.registry.open(a.socket);
  await setup.attach(a.socket);
  await setup.attach(a.socket, "other", 1);
  expect(a.closed).toEqual([1008]);
  expect(setup.registry.attachment(a.socket)).toBeNull();
});

test("in-flight RPCs are bounded without blocking later input", async () => {
  const setup = fixture();
  const a = socketFixture();
  setup.registry.open(a.socket);
  await setup.attach(a.socket);
  await setup.report(a.socket);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  setup.setExecute(async () => {
    await wait;
    return { ok: true, revision: 1, result: { id: "done" } };
  });
  const requests = Array.from({ length: 129 }, (_, i) =>
    setup.registry.receive(a.socket, {
      type: "client.command",
      requestId: i + 2,
      attachmentGeneration: 1,
      command: {},
    }),
  );
  try {
    expect(a.messages.at(-1)).toMatchObject({
      type: "command.error",
      requestId: 130,
      message: "Too many interactive requests in flight",
    });
    await setup.input(a.socket);
    expect(setup.inputs).toHaveLength(1);
  } finally {
    release();
    await Promise.all(requests);
  }
});

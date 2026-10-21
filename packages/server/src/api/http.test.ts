import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import WebSocket from "ws";

import { sendTerminalInput } from "../../../../scripts/test-support/terminal-input.ts";
import { createApp } from "../application/app.ts";
import { applyCommand } from "../application/commands.ts";
import {
  normalizeSessionNavigations,
  readNavigationCatalog,
} from "../application/navigation-store.ts";
import { ApiError, createClient } from "../client.ts";
import { openDatabase } from "../persistence/database.ts";
import { TerminalHistory } from "../terminal/history.ts";
import { startHttpServer } from "./http.ts";
import { type Command, decodeBytes, type ServerMessage, type Snapshot } from "./protocol.ts";

function seedPane(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sessions VALUES ('session-1', 'Main', 0);
    INSERT INTO workspaces VALUES ('workspace-1', 'Work');
    INSERT INTO session_workspaces VALUES ('session-1', 'workspace-1', 0);
    INSERT INTO items VALUES ('item-1', 'workspace-1', 'design', NULL, 'generic', 'Build', 0, 0, '{}');
    INSERT INTO surfaces VALUES ('surface-1', 'item-1');
    INSERT INTO tabs VALUES ('tab-1', 'surface-1', 'Main', 0, '{"type":"pane","paneId":"pane-1"}');
    INSERT INTO panes VALUES ('pane-1', 'surface-1', 'terminal', 'Shell', '/tmp', '{"type":"shell","executable":"/bin/sh","args":[]}', 'interrupted', NULL, NULL, NULL);
  `);
  normalizeSessionNavigations(db, readNavigationCatalog(db));
  applyCommand(db, {
    type: "session.navigate",
    sessionId: "session-1",
    target: { kind: "pane", paneId: "pane-1" },
  });
}

async function startTestServer(options: { withPane?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-http-"));
  const db = openDatabase(join(directory, "work-craft.db"));
  if (options.withPane) {
    seedPane(db);
  }
  const history = new TerminalHistory(db);
  const app = createApp({ db, history });
  const socketPath = join(directory, "work-craft.sock");
  const server = startHttpServer(app, socketPath);

  return {
    app,
    client: createClient({ socketPath }),
    db,
    history,
    socketPath,
    async close() {
      await server.stop(true);
      await history.close();
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a reconnect receives one coherent current snapshot", async () => {
  const fixture = await startTestServer();
  try {
    const first = await fixture.client.streamOnce();
    expect(first.type).toBe("snapshot");

    await fixture.client.command({ type: "session.create", name: "Main" });

    const reconnected = await fixture.client.streamOnce();
    expect(reconnected.type).toBe("snapshot");
    if (reconnected.type === "snapshot") {
      expect(reconnected.snapshot.revision).toBe(1);
      expect(reconnected.snapshot.sessions[0]?.name).toBe("Main");
    }
  } finally {
    await fixture.close();
  }
});

test("the Unix socket is owner-only", async () => {
  const fixture = await startTestServer();
  try {
    expect((await stat(fixture.socketPath)).mode & 0o777).toBe(0o600);
  } finally {
    await fixture.close();
  }
});

test("the real stream rejects captured bytes after a navigation round trip but accepts current bytes", async () => {
  const fixture = await startTestServer({ withPane: true });
  await fixture.app.runtime.start(fixture.app.snapshot().panes[0]!);
  const write = spyOn(fixture.app.runtime, "write");
  const stream = await fixture.client.stream({ onMessage() {} });
  try {
    const attachment = await stream.attach("session-1");
    const attached = await fixture.client.snapshot();
    const reportStamp = {
      epoch: attached.epoch,
      attachmentGeneration: attachment.generation,
      navigationGeneration: attached.navigation[0]!.generation,
      geometrySequence: attached.geometry.tabs[0]!.generation,
    };
    stream.reportViewport(
      {
        epoch: attached.epoch,
        attachmentGeneration: attachment.generation,
        navigationGeneration: attached.navigation[0]!.generation,
        tabId: "tab-1",
        canvas: { cols: 80, rows: 25 },
        eligible: true,
      },
      reportStamp,
    );
    await stream.command(
      {
        type: "session.navigate",
        sessionId: "session-1",
        target: { kind: "pane", paneId: "pane-1" },
      },
      attachment.generation,
    );
    const before = await fixture.client.snapshot();
    const stamp = {
      epoch: before.epoch,
      attachmentGeneration: attachment.generation,
      navigationGeneration: before.navigation[0]!.generation,
      geometrySequence: before.geometry.tabs[0]!.generation,
    };
    stream.sendInput("pane-1", new TextEncoder().encode("current"), {
      ...stamp,
      source: "input",
      kind: "key",
    });
    await stream.command(
      {
        type: "session.navigate",
        sessionId: "session-1",
        target: { kind: "category", category: "operations" },
      },
      attachment.generation,
    );
    await stream.command(
      {
        type: "session.navigate",
        sessionId: "session-1",
        target: { kind: "pane", paneId: "pane-1" },
      },
      attachment.generation,
    );
    stream.sendInput("pane-1", new TextEncoder().encode("stale"), {
      ...stamp,
      source: "input",
      kind: "key",
    });
    const after = await stream.command(
      {
        type: "session.navigate",
        sessionId: "session-1",
        target: { kind: "pane", paneId: "pane-1" },
      },
      attachment.generation,
    );
    expect(after.result.navigation!.generation).toBeGreaterThan(stamp.navigationGeneration);
    expect(write.mock.calls.map(([, bytes]) => new TextDecoder().decode(bytes))).toEqual([
      "current",
    ]);
  } finally {
    stream.close();
    write.mockRestore();
    await fixture.app.runtime.stopAll();
    await fixture.close();
  }
});

test("directory registration exposes requested and root IDs without opening a surface", async () => {
  const fixture = await startTestServer();
  const target = await mkdtemp(join(tmpdir(), "work-craft-http-directory-"));
  try {
    const sessionId = (await fixture.client.command({ type: "session.create", name: "Main" }))
      .result.id;
    const workspaceId = (
      await fixture.client.command({ type: "workspace.create", sessionId, name: "Work" })
    ).result.id;
    const command = { type: "directory.register" as const, workspaceId, path: target };
    const registered = await fixture.client.command(command);
    expect(registered.result).toEqual({
      id: registered.result.id,
      itemId: registered.result.id,
      rootItemId: registered.result.id,
    });
    expect((await fixture.client.command(command)).revision).toBe(registered.revision);
    expect((await fixture.client.snapshot()).surfaces).toEqual([]);
    expect((await fixture.client.snapshot()).panes).toEqual([]);
  } finally {
    await fixture.close();
    await rm(target, { recursive: true, force: true });
  }
});

test("bounds normal client requests when the daemon stops responding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-client-timeout-"));
  const socketPath = join(directory, "work-craft.sock");
  const server = Bun.serve({
    unix: socketPath,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(10));
  const request = createClient({ socketPath }).snapshot();
  try {
    const settled = await Promise.race([
      request.then(
        () => "resolved",
        () => "rejected",
      ),
      Bun.sleep(100).then(() => "pending"),
    ]);
    expect(settled).toBe("rejected");
  } finally {
    timeoutSpy.mockRestore();
    await server.stop(true);
    await request.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test("stops the Unix listener when setting owner-only mode fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-http-"));
  const db = openDatabase(join(directory, "work-craft.db"));
  const socketPath = join(directory, "work-craft.sock");
  const serveSpy = spyOn(Bun, "serve");
  const chmodSpy = spyOn(fs, "chmodSync").mockImplementationOnce(() => {
    throw new Error("chmod failed");
  });

  try {
    expect(() => startHttpServer(createApp({ db }), socketPath)).toThrow("chmod failed");
    await expect(fetch("http://localhost/health", { unix: socketPath })).rejects.toThrow();
  } finally {
    chmodSpy.mockRestore();
    const server = serveSpy.mock.results[0]?.value as Bun.Server<undefined> | undefined;
    serveSpy.mockRestore();
    await server?.stop(true);
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("routes endpoint failures by error class", async () => {
  const fixture = await startTestServer();
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://localhost${path}`, { ...init, unix: fixture.socketPath });
  try {
    const protocolError = await request("/command", {
      method: "POST",
      body: JSON.stringify({ type: "session.create", name: " " }),
    });
    expect(protocolError.status).toBe(400);
    expect(await protocolError.json()).toEqual({
      error: "name must be a non-blank string",
      field: "name",
    });

    expect((await request("/missing")).status).toBe(404);

    const before = await fixture.client.health();
    fixture.db.exec("DROP TABLE sessions");
    const unexpectedError = await request("/command", {
      method: "POST",
      body: JSON.stringify({ type: "session.create", name: "Main" }),
    });
    expect(unexpectedError.status).toBe(500);
    expect(await fixture.client.health()).toEqual(before);
  } finally {
    await fixture.close();
  }
});

test("field attribution survives real HTTP and client validation boundaries", async () => {
  const fixture = await startTestServer();
  try {
    const cases: [Command, string][] = [
      [{ type: "session.create", name: " " }, "name"],
      [{ type: "item.create", workspaceId: "w", category: "design", title: "" }, "title"],
      [
        { type: "directory.register", workspaceId: "w", path: join(tmpdir(), crypto.randomUUID()) },
        "path",
      ],
    ];
    for (const [command, field] of cases) {
      try {
        await fixture.client.command(command);
        throw new Error("accepted invalid field");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect(String((error as ApiError).field)).toBe(field);
      }
    }
    for (const body of ["{", "[]", "null", '{"type":"session.create","name":{}}']) {
      const response = await fetch("http://localhost/command", {
        unix: fixture.socketPath,
        method: "POST",
        body,
      });
      expect(response.status).toBe(400);
    }
    expect(fixture.app.health().revision).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("only successful durable commands advance and broadcast snapshots", async () => {
  const fixture = await startTestServer();
  const messages: ServerMessage[] = [];
  let receiveFirst!: () => void;
  let receiveSecond!: () => void;
  const firstMessage = new Promise<void>((resolve) => (receiveFirst = resolve));
  const secondMessage = new Promise<void>((resolve) => (receiveSecond = resolve));
  let connection;

  try {
    connection = await fixture.client.stream({
      onMessage(message) {
        if (message.type !== "snapshot") {
          return;
        }
        messages.push(message);
        if (messages.length === 1) {
          receiveFirst();
        } else if (messages.length === 2) {
          receiveSecond();
        }
      },
    });
    await firstMessage;

    const created = await fixture.client.command({ type: "session.create", name: "Main" });
    await secondMessage;
    expect(created.revision).toBe(1);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      type: "snapshot",
      snapshot: { revision: 1, sessions: [{ name: "Main" }] },
    });

    await expect(
      fixture.client.command({ type: "workspace.create", sessionId: "missing", name: "Nope" }),
    ).rejects.toThrow("session not found");
    expect(await fixture.client.command({ type: "daemon.stop" })).toEqual({
      ok: true,
      revision: 1,
      result: { id: "daemon", stopping: true },
    });
    await Bun.sleep(20);
    expect((await fixture.client.health()).revision).toBe(1);
    expect(messages).toHaveLength(2);
  } finally {
    connection?.close();
    await fixture.close();
  }
});

test("exposes owned history for shutdown flushing", async () => {
  const db = openDatabase(":memory:");
  seedPane(db);
  const app = createApp({ db });

  app.history.append("pane-1", new TextEncoder().encode("shutdown"));
  await app.history.close();

  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM terminal_chunks").get()?.count,
  ).toBe(1);
  db.close();
});

test("streams runtime input, output, status, and queued history", async () => {
  const fixture = await startTestServer({ withPane: true });
  const messages: ServerMessage[] = [];
  let initialSnapshot!: () => void;
  const initial = new Promise<void>((resolve) => (initialSnapshot = resolve));
  let receiveExit!: () => void;
  const exited = new Promise<void>((resolve) => (receiveExit = resolve));
  let connection;
  try {
    connection = await fixture.client.stream({
      onMessage(message) {
        messages.push(message);
        if (message.type === "snapshot") {
          initialSnapshot();
        }
        if (message.type === "process.status" && message.status === "exited") {
          receiveExit();
        }
      },
    });
    await initial;
    await fixture.app.runtime.start({
      id: "pane-1",
      cwd: process.cwd(),
      restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
    });
    await sendTerminalInput(
      fixture.client,
      connection,
      "pane-1",
      new TextEncoder().encode("printf app-stream; exit\n"),
    );
    expect(await fixture.app.runtime.waitForExit("pane-1")).toBe(0);
    await exited;

    const outputs = messages.filter(
      (message): message is Extract<ServerMessage, { type: "terminal.output" }> =>
        message.type === "terminal.output",
    );
    expect(
      new TextDecoder().decode(Buffer.concat(outputs.map(({ data }) => decodeBytes(data)))),
    ).toContain("app-stream");
    expect(
      outputs.every((message, index) => index === 0 || message.cursor > outputs[index - 1]!.cursor),
    ).toBe(true);
    expect(
      messages.filter((message) => message.type === "process.status").map(({ status }) => status),
    ).toEqual(["starting", "running", "exited"]);
    const snapshot = fixture.app.snapshot();
    expect(snapshot.revision).toBe(3);
    expect(snapshot.panes[0]).toMatchObject({
      processStatus: "exited",
      errorText: null,
      startedAt: expect.any(String),
      exitedAt: expect.any(String),
    });
    expect(new TextDecoder().decode(decodeBytes(snapshot.terminalHistories[0]!.data))).toContain(
      "app-stream",
    );
    expect(snapshot.terminalHistories[0]!.cursor).toBe(outputs.at(-1)!.cursor);
  } finally {
    connection?.close();
    await fixture.close();
  }
});

test("closes malformed stream peers with policy violation", async () => {
  const fixture = await startTestServer();
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws+unix:${fixture.socketPath}:/stream`);
      socket.once("open", () => socket.send("{"));
      socket.once("close", resolve);
      socket.once("error", reject);
    });
    expect(code).toBe(1008);
  } finally {
    await fixture.close();
  }
});

test("closes stream peers whose terminal input targets no live pane", async () => {
  const fixture = await startTestServer();
  const socket = new WebSocket(`ws+unix:${fixture.socketPath}:/stream`);
  try {
    const closed = new Promise<number>((resolve, reject) => {
      socket.once("open", () =>
        socket.send(
          JSON.stringify({
            type: "terminal.input",
            paneId: "missing-pane",
            data: Buffer.from("input").toString("base64"),
          }),
        ),
      );
      socket.once("close", resolve);
      socket.once("error", reject);
    });
    const code = await Promise.race([
      closed,
      Bun.sleep(250).then(() => {
        throw new Error("Timed out waiting for invalid stream peer to close");
      }),
    ]);

    expect(code).toBe(1008);
    expect((await fixture.client.health()).pid).toBe(process.pid);
  } finally {
    socket.terminate();
    await fixture.close();
  }
});

test("applies a newer snapshot frame after a pending gap refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-client-order-"));
  const socketPath = join(directory, "work-craft.sock");
  const snapshot = (revision: number): Snapshot => ({
    epoch: "epoch-1",
    revision,
    sessions: [],
    workspaces: [],
    sessionWorkspaces: [],
    categories: [],
    items: [],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
    navigation: [],
    geometry: { sequence: 0, tabs: [], panes: [] },
  });
  let streamSocket: Bun.ServerWebSocket | undefined;
  let markRefreshStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => (markRefreshStarted = resolve));
  let releaseRefresh!: () => void;
  const server = Bun.serve({
    unix: socketPath,
    fetch(request, server) {
      const { pathname } = new URL(request.url);
      if (pathname === "/stream" && server.upgrade(request)) {
        return;
      }
      if (pathname === "/snapshot") {
        markRefreshStarted();
        return new Promise<Response>((resolve) => {
          releaseRefresh = () => resolve(Response.json(snapshot(2)));
        });
      }
      return new Response(null, { status: 404 });
    },
    websocket: {
      open(socket) {
        streamSocket = socket;
        socket.send(JSON.stringify({ type: "snapshot", snapshot: snapshot(0) }));
      },
      message() {},
    },
  });
  const revisions: number[] = [];
  let receiveInitial!: () => void;
  const initial = new Promise<void>((resolve) => (receiveInitial = resolve));
  let receiveRefresh!: () => void;
  const refreshed = new Promise<void>((resolve) => (receiveRefresh = resolve));
  let receiveNewest!: () => void;
  const newest = new Promise<void>((resolve) => (receiveNewest = resolve));
  let receiveMarker!: () => void;
  const marker = new Promise<void>((resolve) => (receiveMarker = resolve));
  let connection;

  try {
    connection = await createClient({ socketPath }).stream({
      onMessage(message) {
        if (message.type === "snapshot") {
          revisions.push(message.snapshot.revision);
          if (message.snapshot.revision === 0) {
            receiveInitial();
          } else if (message.snapshot.revision === 2) {
            receiveRefresh();
          } else if (message.snapshot.revision === 3) {
            receiveNewest();
          }
        } else if (message.type === "process.status") {
          receiveMarker();
        }
      },
    });
    await initial;
    streamSocket!.send(JSON.stringify({ type: "snapshot", snapshot: snapshot(2) }));
    await refreshStarted;
    streamSocket!.send(JSON.stringify({ type: "snapshot", snapshot: snapshot(3) }));
    streamSocket!.send(
      JSON.stringify({
        type: "process.status",
        epoch: "epoch-1",
        paneId: "pane-1",
        status: "running",
      }),
    );
    releaseRefresh();
    await refreshed;
    await marker;
    expect(await Promise.race([newest.then(() => true), Bun.sleep(100).then(() => false)])).toBe(
      true,
    );

    expect(revisions).toEqual([0, 2, 3]);
  } finally {
    connection?.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

import { chmodSync } from "node:fs";

import type { WorkCraftApp } from "../application/app.ts";
import { observeOutput, outputProbeEnabled } from "../terminal/output-probe.ts";
import { parseClientMessage, ProtocolError, STREAM_BACKPRESSURE_LIMIT } from "./protocol.ts";

async function commandBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProtocolError("request body must be valid JSON");
  }
}

export function startHttpServer(
  app: WorkCraftApp,
  socketPath: string,
): Bun.Server<{ snapshot: "control" | "full" }> {
  const server = Bun.serve<{ snapshot: "control" | "full" }>({
    unix: socketPath,
    async fetch(request, server) {
      const { pathname, searchParams } = new URL(request.url);
      try {
        if (request.method === "GET" && pathname === "/health") {
          return Response.json(app.health());
        }
        if (request.method === "GET" && pathname === "/snapshot") {
          const started = outputProbeEnabled ? performance.now() : 0;
          const response = Response.json(app.snapshot());
          if (outputProbeEnabled) {
            observeOutput({ stage: "snapshot.http", durationMs: performance.now() - started });
          }
          return response;
        }
        if (request.method === "POST" && pathname === "/command") {
          return Response.json(await app.execute(await commandBody(request)));
        }
        if (request.method === "GET" && pathname === "/control") {
          const started = outputProbeEnabled ? performance.now() : 0;
          const response = Response.json(app.controlSnapshot());
          if (outputProbeEnabled) {
            observeOutput({ stage: "control.http", durationMs: performance.now() - started });
          }
          return response;
        }
        const history = /^\/panes\/([^/]+)\/history$/.exec(pathname);
        if (request.method === "GET" && history) {
          const after = searchParams.get("after");
          if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
            throw new ProtocolError("History cursor must be a non-negative safe integer");
          }
          let paneId: string;
          try {
            paneId = decodeURIComponent(history[1]!);
          } catch {
            throw new ProtocolError("Invalid pane path");
          }
          return Response.json(app.paneHistory(paneId, after === null ? undefined : Number(after)));
        }
        if (request.method === "GET" && pathname === "/stream") {
          if (
            server.upgrade(request, {
              data: { snapshot: searchParams.get("view") === "control" ? "control" : "full" },
            })
          ) {
            return;
          }
          return Response.json({ error: "WebSocket upgrade failed" }, { status: 400 });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      } catch (error) {
        if (error instanceof ProtocolError) {
          return Response.json(
            { error: error.message, ...(error.field === undefined ? {} : { field: error.field }) },
            { status: 400 },
          );
        }
        return Response.json({ error: "Internal server error" }, { status: 500 });
      }
    },
    websocket: {
      open(socket) {
        app.subscribe(socket, socket.data);
      },
      close(socket) {
        app.unsubscribe(socket);
      },
      message(socket, data) {
        try {
          const message = parseClientMessage(JSON.parse(data.toString()));
          void app.receive(socket, message);
        } catch {
          socket.close(1008, "invalid client message");
        }
      },
      backpressureLimit: STREAM_BACKPRESSURE_LIMIT,
      closeOnBackpressureLimit: true,
    },
  });
  try {
    chmodSync(socketPath, 0o600);
  } catch (error) {
    void server.stop(true);
    throw error;
  }
  return server;
}

import { chmodSync } from "node:fs";
import type { WorkCraftApp } from "./app.ts";
import { parseClientMessage, ProtocolError } from "./protocol.ts";
import type { Command } from "./protocol.ts";

async function commandBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProtocolError("request body must be valid JSON");
  }
}

export function startHttpServer(app: WorkCraftApp, socketPath: string): Bun.Server<undefined> {
  const server = Bun.serve({
    unix: socketPath,
    async fetch(request, server) {
      const { pathname } = new URL(request.url);
      try {
        if (request.method === "GET" && pathname === "/health") {
          return Response.json(app.health());
        }
        if (request.method === "GET" && pathname === "/snapshot") {
          return Response.json(app.snapshot());
        }
        if (request.method === "POST" && pathname === "/command") {
          return Response.json(await app.execute((await commandBody(request)) as Command));
        }
        if (request.method === "GET" && pathname === "/stream") {
          if (server.upgrade(request)) {
            return;
          }
          return Response.json({ error: "WebSocket upgrade failed" }, { status: 400 });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      } catch (error) {
        if (error instanceof ProtocolError) {
          return Response.json({ error: error.message }, { status: 400 });
        }
        return Response.json({ error: "Internal server error" }, { status: 500 });
      }
    },
    websocket: {
      open(socket) {
        app.subscribe(socket);
      },
      close(socket) {
        app.unsubscribe(socket);
      },
      message(socket, data) {
        try {
          const message = parseClientMessage(JSON.parse(data.toString()));
          app.receive(message);
        } catch {
          socket.close(1008, "invalid client message");
        }
      },
      backpressureLimit: 1024 * 1024,
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

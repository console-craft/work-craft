import { rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  ProjectionInput,
  ProjectionStamp,
  SemanticInput,
} from "../../../../../scripts/test-support/terminal-projection-types";
import { createProjectionFixture } from "./projection-fixture";

async function serve(socket: string, log: string): Promise<void> {
  const parser = createProjectionFixture({ cols: 12, rows: 3 }, 2 * 1_048_576);
  let canonicalSize = { cols: 12, rows: 3 };
  const input: number[] = [];
  const stamp: ProjectionStamp = {
    epoch: crypto.randomUUID(),
    runtime: crypto.randomUUID(),
    attachment: 0,
    navigation: 0,
    geometry: 0,
  };
  let sequence = 0;
  let ready = false;
  let bytes = 0;
  let token = 0;
  let inputFrontier = 0;
  function writeInput(data: Uint8Array): number {
    if (inputFrontier + data.length > 8 * 1024 * 1024) {
      throw new Error("Input observation limit");
    }
    inputFrontier += data.length;
    terminal.write(data);
    return inputFrontier;
  }
  let failure: string | undefined;
  let pending:
    | { token: number; written?: number; resolve(): void; reject(error: Error): void }
    | undefined;
  function settle(): void {
    if (pending?.written !== undefined && bytes >= pending.written) {
      pending.resolve();
    }
  }
  const terminal = new Bun.Terminal({
    cols: 12,
    rows: 3,
    data(_terminal, output) {
      try {
        for (let offset = 0; offset < output.length; offset += 8192) {
          parser.write(output.subarray(offset, offset + 8192));
          const reply = parser.replies();
          if (reply.length) {
            writeInput(reply);
          }
        }
        bytes += output.length;
        sequence++;
        settle();
      } catch (error) {
        failure = String(error);
      }
    },
  });
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "program.js"), log], {
    terminal,
    ipc(value: unknown) {
      const message = value as {
        ready?: boolean;
        input?: number[];
        token?: number;
        written?: number;
      };
      if (message.ready) {
        ready = true;
      }
      if (message.input) {
        if (input.length + message.input.length > 8 * 1024 * 1024) {
          failure = "Input observation limit";
          return;
        }
        input.push(...message.input);
      }
      if (pending && message.token === pending.token) {
        pending.written = message.written;
        settle();
      }
    },
  });
  const server = Bun.serve({
    unix: socket,
    maxRequestBodySize: 8 * 1024 * 1024,
    async fetch(request) {
      try {
        if (failure) {
          throw new Error(failure);
        }
        const url = new URL(request.url);
        if (url.pathname === "/revoke" && request.method === "POST") {
          const { field } = (await request.json()) as { field: keyof ProjectionStamp };
          if (field === "epoch" || field === "runtime") {
            stamp[field] = crypto.randomUUID();
          } else if (field === "attachment" || field === "navigation" || field === "geometry") {
            stamp[field]++;
          } else {
            throw new Error("Unknown authority generation");
          }
          sequence++;
          return Response.json({ ok: true });
        }
        if (url.pathname === "/resize" && request.method === "POST") {
          const size = (await request.json()) as { cols: number; rows: number };
          if (
            ![size.cols, size.rows].every(
              (value) => Number.isSafeInteger(value) && value >= 1 && value <= 4096,
            ) ||
            size.cols * size.rows > 1_048_576
          ) {
            throw new Error("Invalid fixture dimensions");
          }
          parser.resize(size);
          terminal.resize(size.cols, size.rows);
          canonicalSize = { ...size };
          stamp.geometry++;
          sequence++;
          return Response.json({ ok: true });
        }
        if (url.pathname === "/exit" && request.method === "POST") {
          child.kill("SIGTERM");
          await child.exited;
          return Response.json({ ok: true });
        }
        if (url.pathname === "/state" && request.method === "GET") {
          // Even an empty plain cell needs more than 64 JSON bytes in this DTO.
          if (canonicalSize.cols * canonicalSize.rows * 64 >= 8 * 1024 * 1024) {
            throw new Error(
              "Projection frame budget: full material cannot fit the retained boundary",
            );
          }
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const frame = parser.frame(offset);
          let retained =
            Buffer.byteLength(JSON.stringify({ size: frame.size, cursor: frame.cursor })) + 2;
          for (const row of frame.rows) {
            retained += Buffer.byteLength(JSON.stringify(row)) + 1;
            if (retained > 8 * 1024 * 1024) {
              throw new Error(
                "Projection frame budget: styled material exceeds the retained boundary",
              );
            }
          }
          return Response.json({
            ready,
            pid: child.pid,
            bytes,
            input,
            stamp,
            sequence: ++sequence,
            frame,
          });
        }
        if (url.pathname === "/output" && request.method === "POST") {
          const body = (await request.json()) as { bytes: number[] };
          if (
            !Array.isArray(body.bytes) ||
            body.bytes.length > 8 * 1024 * 1024 ||
            !body.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
          ) {
            throw new Error("Invalid fixture output bytes");
          }
          if (pending) {
            throw new Error("Output command already pending");
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await new Promise<void>((resolve, reject) => {
              pending = { token: ++token, resolve, reject };
              timer = setTimeout(
                () => reject(new Error("Program output acknowledgement timed out")),
                4000,
              );
              child.send({ token, bytes: body.bytes });
            });
          } finally {
            clearTimeout(timer);
            pending = undefined;
          }
          return Response.json({ ok: true });
        }
        if (url.pathname === "/input" && request.method === "POST") {
          let encoded: Uint8Array;
          const envelope = (await request.json()) as ProjectionInput;
          if (
            !envelope.stamp ||
            !Object.keys(stamp).every(
              (field) =>
                envelope.stamp[field as keyof ProjectionStamp] ===
                stamp[field as keyof ProjectionStamp],
            )
          ) {
            return Response.json({ forwarded: false, stale: true });
          }
          const body = envelope.input as {
            kind: string;
            key?: Extract<SemanticInput, { kind: "key" }>["key"];
            bytes?: number[];
            mouse?: Extract<SemanticInput, { kind: "mouse" }>["mouse"];
            focused?: boolean;
          };
          if (body.kind === "key" && body.key && typeof body.key === "object") {
            const key = body.key;
            for (const name of ["key", "text"] as const) {
              if (
                key[name] !== undefined &&
                (typeof key[name] !== "string" || Buffer.byteLength(key[name]) > 8 * 1024 * 1024)
              ) {
                throw new Error("Invalid key text");
              }
            }
            for (const name of ["mods", "consumedMods", "unshiftedCodepoint"] as const) {
              const number = key[name];
              if (
                number !== undefined &&
                (!Number.isSafeInteger(number) ||
                  number < 0 ||
                  number > (name === "unshiftedCodepoint" ? 0x10ffff : 255))
              ) {
                throw new Error("Invalid key metadata");
              }
            }
            if (
              (key.action !== undefined && !["press", "repeat", "release"].includes(key.action)) ||
              (key.composing !== undefined && typeof key.composing !== "boolean")
            ) {
              throw new Error("Invalid key action");
            }
            encoded = parser.encode({ kind: "key", key });
          } else if (
            body.kind === "paste" &&
            Array.isArray(body.bytes) &&
            body.bytes.length <= 8 * 1024 * 1024 &&
            body.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
          ) {
            encoded = parser.encode({ kind: "paste", bytes: body.bytes });
          } else if (body.kind === "focus" && typeof body.focused === "boolean") {
            encoded = parser.encode({ kind: "focus", focused: body.focused });
          } else if (body.kind === "mouse" && body.mouse && typeof body.mouse === "object") {
            const mouse = body.mouse;
            if (
              !["press", "release", "motion"].includes(mouse.action) ||
              (mouse.button !== undefined &&
                !["unknown", "left", "middle", "right", "four", "five", "six", "seven"].includes(
                  mouse.button,
                )) ||
              !Number.isFinite(mouse.x) ||
              !Number.isFinite(mouse.y) ||
              (mouse.mods !== undefined &&
                (!Number.isSafeInteger(mouse.mods) || mouse.mods < 0 || mouse.mods > 63)) ||
              (mouse.anyButtonPressed !== undefined && typeof mouse.anyButtonPressed !== "boolean")
            ) {
              throw new Error("Invalid mouse metadata");
            }
            encoded = parser.encode({ kind: "mouse", mouse });
          } else {
            throw new Error("Unsupported fixture input");
          }
          const required = writeInput(encoded);
          const deadline = Date.now() + 4000;
          while (input.length < required && Date.now() < deadline && !failure) {
            await Bun.sleep(1);
          }
          if (failure || input.length < required) {
            throw new Error(failure ?? "Child input acknowledgement timed out");
          }
          return Response.json({ forwarded: encoded.length > 0 });
        }
        return new Response("Unknown fixture request", { status: 404 });
      } catch (error) {
        return new Response(String(error), { status: 400 });
      }
    },
  });
  let stopping = false;
  async function close(): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;
    pending?.reject(new Error("Runtime stopped"));
    server.stop(true);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await child.exited;
    terminal.close();
    parser.destroy();
    await rm(socket, { force: true });
  }
  process.once("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  void child.exited.then((code) => {
    if (!stopping) {
      failure = `Owned program exited ${code}`;
      pending?.reject(new Error(failure));
    }
  });
}

if (process.argv[2] === "serve") {
  await serve(process.argv[3]!, process.argv[4]!);
} else {
  const parser = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    parser.write(new TextEncoder().encode(process.argv[2] ?? ""));
    console.log(JSON.stringify(parser.frame(0)));
  } finally {
    parser.destroy();
  }
}

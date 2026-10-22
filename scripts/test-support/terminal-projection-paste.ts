import type { PasteMessage, ProjectionInput, ProjectionStamp } from "./terminal-projection-types";

export async function sendProjectionInput(
  event: ProjectionInput,
  post: (
    message: ProjectionInput | PasteMessage,
    signal?: AbortSignal,
  ) => Promise<{ stale?: boolean }>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (event.input.kind !== "paste") {
    if ((await post(event, signal)).stale) {
      throw new Error("stale input");
    }
    return;
  }
  const bytes = event.input.bytes;
  if (bytes.length + 128 > 8 * 1024 * 1024) {
    throw new Error("Paste input limit");
  }
  const identity = { id: crypto.randomUUID(), stamp: { ...event.stamp } };
  async function send(message: PasteMessage): Promise<void> {
    signal?.throwIfAborted();
    if ((await post(message, signal)).stale) {
      throw new Error("stale paste");
    }
  }
  try {
    await send({ ...identity, type: "paste.begin", total: bytes.length });
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      const data = Buffer.from(bytes.slice(offset, offset + 65536)).toString("base64");
      await send({ ...identity, type: "paste.chunk", offset, data });
    }
    await send({ ...identity, type: "paste.commit" });
  } catch (error) {
    // Cancellation has its own short deadline; the original request may already be aborted.
    await post({ ...identity, type: "paste.cancel" }, AbortSignal.timeout(250)).catch(() => {});
    throw error;
  }
}

function sameStamp(a: ProjectionStamp | undefined, b: ProjectionStamp): boolean {
  return (
    a?.epoch === b.epoch &&
    a.runtime === b.runtime &&
    a.attachment === b.attachment &&
    a.navigation === b.navigation &&
    a.geometry === b.geometry
  );
}

export function createPasteReceiver(): {
  readonly bytes: number;
  accept(message: PasteMessage, current: ProjectionStamp): Uint8Array | null;
  cancel(id: string): void;
  clear(): void;
} {
  let pending: { id: string; stamp: ProjectionStamp; data: Buffer; offset: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear(): void {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  }
  function refresh(): void {
    clearTimeout(timer);
    timer = setTimeout(clear, 4000);
    timer.unref();
  }
  return {
    get bytes() {
      return pending ? pending.data.length + 128 : 0;
    },
    clear,
    cancel(id) {
      if (pending?.id === id) {
        clear();
      }
    },
    accept(message, current) {
      try {
        if (
          !message ||
          typeof message.id !== "string" ||
          message.id.length === 0 ||
          message.id.length > 64
        ) {
          throw new Error("Invalid paste identity");
        }
        if (message.type === "paste.cancel") {
          if (pending?.id === message.id && sameStamp(message.stamp, pending.stamp)) {
            clear();
          }
          return null;
        }
        if (!sameStamp(message.stamp, current)) {
          throw new Error("stale paste");
        }
        if (message.type === "paste.begin") {
          if (pending) {
            throw new Error("Paste already pending");
          }
          if (
            !Number.isSafeInteger(message.total) ||
            message.total < 0 ||
            message.total + 128 > 8 * 1024 * 1024
          ) {
            throw new Error("Paste input limit");
          }
          pending = {
            id: message.id,
            stamp: { ...message.stamp },
            data: Buffer.allocUnsafe(message.total),
            offset: 0,
          };
          refresh();
          return null;
        }
        if (!pending || pending.id !== message.id || !sameStamp(pending.stamp, current)) {
          throw new Error("Unknown paste transfer");
        }
        if (message.type === "paste.chunk") {
          if (
            message.offset !== pending.offset ||
            typeof message.data !== "string" ||
            message.data.length === 0 ||
            message.data.length > 4 * Math.ceil(65536 / 3) ||
            message.data.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)
          ) {
            throw new Error("Invalid paste chunk");
          }
          const data = Buffer.from(message.data, "base64");
          if (
            data.length === 0 ||
            data.length > 65536 ||
            data.toString("base64") !== message.data ||
            pending.offset + data.length > pending.data.length
          ) {
            throw new Error("Invalid paste chunk");
          }
          pending.data.set(data, pending.offset);
          pending.offset += data.length;
          refresh();
          return null;
        }
        if (message.type !== "paste.commit" || pending.offset !== pending.data.length) {
          throw new Error("Incomplete paste");
        }
        const data = pending.data;
        clear();
        return data;
      } catch (error) {
        clear();
        throw error;
      }
    },
  };
}

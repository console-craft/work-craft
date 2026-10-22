import { ProtocolError, STREAM_BACKPRESSURE_LIMIT } from "./protocol";
import { sameTerminalContext, type TerminalSemanticContext } from "./terminal-projection-protocol";

export type TerminalPasteStamp = TerminalSemanticContext & { paneId: string };
export type TerminalPasteMessage = { id: string; stamp: TerminalPasteStamp } & (
  | { type: "paste.begin"; total: number }
  | { type: "paste.chunk"; offset: number; data: string }
  | { type: "paste.commit" | "paste.cancel" }
);

function sameStamp(a: TerminalPasteStamp, b: TerminalPasteStamp): boolean {
  return (
    a.paneId === b.paneId && sameTerminalContext(a, b) && a.activitySequence === b.activitySequence
  );
}

/** One socket-owned assembly; no native encode occurs until an authorized complete commit. */
export function createPasteReceiver(): {
  readonly bytes: number;
  readonly stamp: TerminalPasteStamp | undefined;
  accept(message: TerminalPasteMessage, current: TerminalPasteStamp): Uint8Array | null;
  clear(): void;
} {
  let pending: { id: string; stamp: TerminalPasteStamp; data: Buffer; offset: number } | undefined;
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
    get stamp() {
      return pending?.stamp;
    },
    clear,
    accept(message, current) {
      try {
        if (
          !message ||
          typeof message.id !== "string" ||
          message.id.length === 0 ||
          message.id.length > 64
        ) {
          throw new ProtocolError("Invalid paste identity");
        }
        if (message.type === "paste.cancel") {
          if (pending?.id === message.id && sameStamp(message.stamp, pending.stamp)) {
            clear();
          }
          return null;
        }
        if (!sameStamp(message.stamp, current)) {
          throw new ProtocolError("stale paste");
        }
        if (message.type === "paste.begin") {
          if (pending) {
            throw new ProtocolError("Paste already pending");
          }
          if (
            !Number.isSafeInteger(message.total) ||
            message.total < 0 ||
            message.total + 128 > STREAM_BACKPRESSURE_LIMIT
          ) {
            throw new ProtocolError("Paste input limit");
          }
          pending = {
            id: message.id,
            stamp: { ...current },
            data: Buffer.allocUnsafe(message.total),
            offset: 0,
          };
          refresh();
          return null;
        }
        if (!pending || pending.id !== message.id || !sameStamp(pending.stamp, current)) {
          throw new ProtocolError("Unknown paste transfer");
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
            throw new ProtocolError("Invalid paste chunk");
          }
          const data = Buffer.from(message.data, "base64");
          if (
            data.length === 0 ||
            data.length > 65536 ||
            data.toString("base64") !== message.data ||
            pending.offset + data.length > pending.data.length
          ) {
            throw new ProtocolError("Invalid paste chunk");
          }
          pending.data.set(data, pending.offset);
          pending.offset += data.length;
          refresh();
          return null;
        }
        if (message.type !== "paste.commit" || pending.offset !== pending.data.length) {
          throw new ProtocolError("Incomplete paste");
        }
        const data = pending.data;
        clear();
        return data;
      } catch (error) {
        if (pending?.id === message?.id && sameStamp(message.stamp, pending.stamp)) {
          clear();
        }
        throw error;
      }
    },
  };
}

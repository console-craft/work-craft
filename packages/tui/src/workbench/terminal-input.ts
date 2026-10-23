import { type SemanticTerminalInput, STREAM_BACKPRESSURE_LIMIT } from "@work-craft/server/client";

/** Captured before queueing; later frames and reconnects cannot lend a new sender. */
export type TerminalInputAdmission = {
  valid(): boolean;
  ready?(): boolean;
  send(input: SemanticTerminalInput, signal: AbortSignal): Promise<{ forwarded: boolean }>;
};
export type TerminalInput = {
  readonly bytes: number;
  admit(input: SemanticTerminalInput): boolean;
  flush(): Promise<void>;
  clear(): void;
  close(): void;
};

export function createTerminalInput(options: {
  capture(input: SemanticTerminalInput): TerminalInputAdmission | null;
  ready(): boolean;
  onResult(input: SemanticTerminalInput, forwarded: boolean): void;
  onError(error: Error): void;
}): TerminalInput {
  type Pending = {
    input: SemanticTerminalInput;
    admission: TerminalInputAdmission;
    charge: number;
  };
  const queue: (Pending | undefined)[] = [];
  let head = 0;
  let bytes = 0;
  let closed = false;
  let running: Promise<void> | undefined;
  let active: AbortController | undefined;

  function canDrain(): boolean {
    const entry = queue[head];
    return (
      !closed &&
      options.ready() &&
      !!entry &&
      (!entry.admission.valid() || entry.admission.ready?.() !== false)
    );
  }

  function clear(): void {
    for (const entry of queue.splice(0)) {
      if (entry) {
        bytes -= entry.charge;
      }
    }
    head = 0;
    active?.abort();
  }

  function flush(): Promise<void> {
    if (running) {
      return running;
    }
    if (!canDrain()) {
      return Promise.resolve();
    }
    running = Promise.resolve()
      .then(async () => {
        while (canDrain()) {
          const entry = queue[head]!;
          queue[head++] = undefined;
          if (head >= 64 && head * 2 >= queue.length) {
            queue.splice(0, head);
            head = 0;
          }
          const abort = new AbortController();
          active = abort;
          try {
            if (entry.admission.valid()) {
              const reply = await entry.admission.send(entry.input, abort.signal);
              if (!closed && !abort.signal.aborted && entry.admission.valid()) {
                options.onResult(entry.input, reply.forwarded);
              }
            }
          } catch (error) {
            if (!closed && !abort.signal.aborted && entry.admission.valid()) {
              options.onError(error instanceof Error ? error : new Error(String(error)));
            }
          } finally {
            bytes -= entry.charge;
            active = undefined;
          }
        }
      })
      .finally(() => {
        running = undefined;
        if (canDrain()) {
          void flush();
        }
      });
    return running;
  }

  return {
    get bytes() {
      return bytes;
    },
    admit(input) {
      if (closed) {
        return false;
      }
      const admission = options.capture(input);
      if (!admission) {
        return false;
      }
      const charge =
        128 +
        (input.kind === "paste"
          ? input.bytes.length
          : input.kind === "key"
            ? Buffer.byteLength(input.key.text ?? "")
            : 0);
      if (bytes + charge > STREAM_BACKPRESSURE_LIMIT) {
        options.onError(new Error("Terminal input queue byte limit"));
        return false;
      }
      const captured: SemanticTerminalInput =
        input.kind === "paste"
          ? { kind: "paste", bytes: Uint8Array.from(input.bytes) }
          : input.kind === "key"
            ? { kind: "key", key: { ...input.key } }
            : input.kind === "mouse"
              ? { kind: "mouse", mouse: { ...input.mouse } }
              : { ...input };
      bytes += charge;
      queue.push({ input: captured, admission, charge });
      void flush();
      return true;
    },
    flush,
    clear,
    close() {
      closed = true;
      clear();
    },
  };
}

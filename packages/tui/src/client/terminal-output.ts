import type { TerminalBuffer } from "@/client/terminal-buffer";
import { createTerminalConsumer } from "@/client/terminal-consumer";

export type PaneOutput = {
  readonly paneId: string;
  read(): TerminalBuffer | undefined;
  subscribe(listener: () => void): () => void;
  next: ReturnType<typeof createTerminalConsumer>["next"];
  consumed: ReturnType<typeof createTerminalConsumer>["consumed"];
};

export type TerminalOutputs = {
  pane(paneId: string): PaneOutput;
};

type OutputRegistry = TerminalOutputs & {
  buffers(): ReadonlyMap<string, TerminalBuffer>;
  set(paneId: string, buffer: TerminalBuffer): void;
  replace(buffers: ReadonlyMap<string, TerminalBuffer>): void;
};

/** Pane data publishes independently; the client store alone owns production ingestion. */
export function createTerminalOutputs(
  initial: ReadonlyMap<string, TerminalBuffer> = new Map(),
): OutputRegistry {
  let buffers = new Map(initial);
  const channels = new Map<
    string,
    {
      output: PaneOutput;
      listeners: Set<() => void>;
      consumer: ReturnType<typeof createTerminalConsumer>;
    }
  >();

  function notify(paneId: string): void {
    const channel = channels.get(paneId);
    channel?.consumer.update(buffers.get(paneId));
    for (const listener of channel?.listeners ?? []) {
      listener();
    }
    if (!buffers.has(paneId) && channel?.listeners.size === 0 && channels.get(paneId) === channel) {
      channels.delete(paneId);
    }
  }

  return {
    buffers: () => buffers,
    pane(paneId) {
      let channel = channels.get(paneId);
      if (!channel) {
        const listeners = new Set<() => void>();
        const consumer = createTerminalConsumer();
        consumer.update(buffers.get(paneId));
        channel = {
          listeners,
          consumer,
          output: {
            paneId,
            next: consumer.next,
            consumed: consumer.consumed,
            read: () => buffers.get(paneId),
            subscribe(listener) {
              listeners.add(listener);
              return () => {
                if (listeners.delete(listener) && listeners.size === 0) {
                  consumer.release();
                }
                if (
                  !buffers.has(paneId) &&
                  listeners.size === 0 &&
                  channels.get(paneId)?.listeners === listeners
                ) {
                  channels.delete(paneId);
                }
              };
            },
          },
        };
        channels.set(paneId, channel);
      }
      return channel.output;
    },
    set(paneId, buffer) {
      if (buffers.get(paneId) !== buffer) {
        buffers.set(paneId, buffer);
        notify(paneId);
      }
    },
    replace(next) {
      if (next === buffers) {
        return;
      }
      const previous = buffers;
      buffers = new Map(next);
      for (const paneId of new Set([...previous.keys(), ...buffers.keys()])) {
        if (previous.get(paneId) !== buffers.get(paneId)) {
          notify(paneId);
        }
      }
    },
  };
}

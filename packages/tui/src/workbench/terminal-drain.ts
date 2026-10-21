import { type CliRenderer, CliRenderEvents } from "@opentui/core";

type TerminalDrain = {
  request(paneId: string, step: () => boolean): void;
  remove(paneId: string): void;
  close(): void;
};

const drains = new WeakMap<CliRenderer, TerminalDrain>();

/** All mounted panes share one I/O-yielding native-work budget on their renderer. */
export function terminalDrainFor(renderer: CliRenderer): TerminalDrain {
  const existing = drains.get(renderer);
  if (existing) {
    return existing;
  }
  const ready = new Map<string, () => boolean>();
  let pending: ReturnType<typeof setImmediate> | undefined;
  let closed = false;

  function schedule(): void {
    if (!closed && ready.size > 0 && pending === undefined) {
      pending = setImmediate(tick);
    }
  }
  function tick(): void {
    pending = undefined;
    const started = performance.now();
    try {
      while (!closed && ready.size > 0) {
        const [paneId, step] = ready.entries().next().value!;
        ready.delete(paneId);
        if (step() && !closed && !ready.has(paneId)) {
          ready.set(paneId, step);
        }
        if (performance.now() - started >= 2) {
          break;
        }
      }
    } finally {
      schedule();
    }
  }
  function close(): void {
    closed = true;
    ready.clear();
    if (pending !== undefined) {
      clearImmediate(pending);
      pending = undefined;
    }
    renderer.off(CliRenderEvents.DESTROY, close);
    drains.delete(renderer);
  }
  const drain: TerminalDrain = {
    request(paneId, step) {
      if (!closed) {
        ready.set(paneId, step);
        schedule();
      }
    },
    remove(paneId) {
      ready.delete(paneId);
    },
    close,
  };
  drains.set(renderer, drain);
  renderer.on(CliRenderEvents.DESTROY, close);
  return drain;
}

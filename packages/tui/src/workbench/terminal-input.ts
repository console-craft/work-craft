import type { EmbeddedTerminalInputRequest } from "@opentui/core";
import { STREAM_BACKPRESSURE_LIMIT } from "@work-craft/server/client";

import type { ReplayProgress } from "@/client/terminal-replay";

/** Captured before encoding; replay never borrows a later event's authority or activity. */
export type TerminalInputAdmission = {
  valid(): boolean;
  send(bytes: Uint8Array): void;
};

export type TerminalInput = {
  admit(request: EmbeddedTerminalInputRequest): void;
  frontier(): ReplayProgress | undefined;
  step(progress: ReplayProgress | null): boolean;
  clear(): void;
  close(): void;
};

/** One native leaf's bounded pre-encoding queue, drained by its existing renderer scheduler. */
export function createTerminalInput(options: {
  capture(): (TerminalInputAdmission & { frontier: ReplayProgress }) | null;
  request(): void;
  overflow(): void;
}): TerminalInput {
  type Pending = {
    admission: TerminalInputAdmission;
    frontier: ReplayProgress;
    bytes: number;
    request: EmbeddedTerminalInputRequest;
  };
  const queue: (Pending | undefined)[] = [];
  let head = 0;
  let queuedBytes = 0;
  let closed = false;

  function reached(progress: ReplayProgress | null, frontier: ReplayProgress): boolean {
    return (
      progress !== null &&
      progress.cursor >= frontier.cursor &&
      (progress.gridSequence ?? 0) >= (frontier.gridSequence ?? 0)
    );
  }

  function clear(): void {
    for (let index = head; index < queue.length; index++) {
      queue[index]?.request.cancel();
    }
    queue.length = 0;
    head = 0;
    queuedBytes = 0;
  }

  return {
    clear,
    frontier: () => queue[head]?.frontier,
    admit(request) {
      const admission = closed ? null : options.capture();
      if (!admission) {
        request.cancel();
        return;
      }
      const bytes = request.payloadBytes + 128;
      if (bytes > STREAM_BACKPRESSURE_LIMIT - queuedBytes) {
        request.cancel();
        clear();
        options.overflow();
        return;
      }
      queue.push({ admission, frontier: { ...admission.frontier }, bytes, request });
      queuedBytes += bytes;
      options.request();
    },
    step(progress) {
      const job = queue[head];
      if (!job || (job.admission.valid() && !reached(progress, job.frontier))) {
        return false;
      }
      queue[head++] = undefined;
      queuedBytes -= job.bytes;
      if (job.admission.valid()) {
        job.request.resume((bytes) => {
          if (job.admission.valid()) {
            job.admission.send(bytes);
          }
        });
      } else {
        job.request.cancel();
      }
      if (head === queue.length) {
        queue.length = 0;
        head = 0;
      } else if (head >= 64 && head * 2 >= queue.length) {
        queue.splice(0, head);
        head = 0;
      }
      return true;
    },
    close() {
      closed = true;
      clear();
    },
  };
}

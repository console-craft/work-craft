import type { StreamConnection, TerminalSize } from "@work-craft/server/client";

import type { TerminalBuffer } from "@/client/terminal-buffer";
import { terminalReplaySteps } from "@/client/terminal-replay";
import { streamFixture } from "@/tests/support/fixtures";

// oxlint-disable-next-line no-restricted-imports -- Test-owned daemon boundary; production never imports this fixture.
import {
  createTerminalProjection,
  type TerminalProjection,
} from "../../../../server/src/terminal/projection";

/** Adapt retained test bytes into daemon material, not a fake ANSI-writing UI leaf. */
export function materialStreamFixture(
  read: (paneId: string) => TerminalBuffer | undefined,
  size: (paneId: string) => TerminalSize,
  control: StreamConnection = streamFixture(),
): StreamConnection {
  function withParser<T>(paneId: string, action: (parser: TerminalProjection) => T): T {
    const buffer = read(paneId);
    const parser = createTerminalProjection(buffer?.initialSize ?? size(paneId));
    try {
      if (buffer) {
        for (const step of terminalReplaySteps(buffer, null).steps) {
          if (step.type === "resize") {
            parser.resize(step.marker);
          } else {
            parser.write(step.data);
          }
          parser.replies();
        }
      }
      parser.resize(size(paneId));
      return action(parser);
    } finally {
      parser.destroy();
    }
  }
  return {
    ...control,
    async requestMaterial(paneId, context, scrollOffset, signal) {
      signal?.throwIfAborted();
      return {
        paneId,
        context: { ...context },
        sequence: read(paneId)?.historyCursor ?? 0,
        frame: withParser(paneId, (parser) => parser.frame(scrollOffset)),
      };
    },
    async sendSemantic(paneId, input, context, signal) {
      signal?.throwIfAborted();
      const bytes = withParser(paneId, (parser) => parser.encode(input));
      if (bytes.length) {
        control.sendInput(paneId, bytes, context);
      }
      return { forwarded: bytes.length > 0 };
    },
  };
}

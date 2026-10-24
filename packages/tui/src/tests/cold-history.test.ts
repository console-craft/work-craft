import { expect, test } from "bun:test";

import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

test("graceful daemon restart reconnects open TUIs without opening the error console", async () => {
  const fixture = await startSharedSessionFixture();
  const [a, b] = fixture.tuis;
  try {
    await focusSharedTerminal(a);
    sharedWrite(a, "printf 'BEFORE-%s\\n' \"$((6*7))\"\r");
    await sharedWait(
      () => [a, b].every((tui) => tui.frame().includes("BEFORE-42")),
      "output before graceful restart",
      a.frame,
    );
    await fixture.restartDaemon();
    await sharedWait(
      () =>
        [a, b].every(
          (tui) =>
            tui.frame().includes("daemon restarted; shell restored") &&
            tui.frame().includes("BEFORE-42"),
        ),
      "live cold recovery after daemon stop",
      () => a.frame() + "\n" + b.frame(),
    );
    for (const tui of [a, b]) {
      expect(tui.output()).not.toContain("Unhandled error");
      expect(tui.frame()).not.toContain("Console (Focused)");
    }
  } finally {
    await fixture.close();
  }
}, 15000);

import { expect, test } from "bun:test";

import {
  focusSharedTerminal,
  sharedWait,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

test("a reopened normal TUI can choose a session after chatty terminal output exceeds the stream budget", async () => {
  const fixture = await startSharedSessionFixture();
  const [a] = fixture.tuis;
  try {
    await focusSharedTerminal(a);
    sharedWrite(a, ":");
    await sharedWait(() => a.frame().includes("$ :"), "large-output input readiness", a.frame);
    const code = 'process.stdout.write("x".repeat(900_000)+"\\nLARGE-HISTORY-READY\\n")';
    sharedWrite(a, `\x1b[200~;'${process.execPath}' -e '${code}'\r\x1b[201~`);
    await sharedWait(async () => {
      const snapshot = await fixture.client.snapshot();
      return Buffer.byteLength(JSON.stringify(snapshot)) > 1_048_576;
    }, "retained output larger than the WebSocket queue");
    await sharedWait(
      () => a.frame().includes("LARGE-HISTORY-READY"),
      "large output finishes",
      a.frame,
    );
    await fixture.client.command({ type: "session.create", name: "Other Session" });
    await fixture.stopTui(a);
    const reopened = fixture.startTui(160, 45);
    await sharedWait(
      () =>
        reopened.frame().includes("Shared Session") && reopened.frame().includes("Other Session"),
      "large-history session chooser",
      reopened.frame,
    );
    sharedWrite(reopened, "Shared");
    await sharedWait(
      () => !reopened.frame().includes("Other Session"),
      "filtered session chooser",
      reopened.frame,
    );
    sharedWrite(reopened, "\r");
    await sharedWait(
      () =>
        reopened.frame().includes("Shared Workspace") &&
        reopened.frame().includes("LARGE-HISTORY-READY"),
      "attachment and retained terminal replay after reopening",
      reopened.frame,
    );
    expect(reopened.frame()).not.toContain("Attach failed");
  } finally {
    await fixture.close();
  }
}, 30_000);

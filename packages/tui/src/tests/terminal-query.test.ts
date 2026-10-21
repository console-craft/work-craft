import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  focusSharedTerminal,
  sharedWrite,
  startSharedSessionFixture,
} from "@/tests/support/shared-session-processes";

test("a background-color query after one MiB of output reaches the child before its deadline", async () => {
  const fixture = await startSharedSessionFixture();
  const [tui] = fixture.tuis;
  const resultPath = join(fixture.home, "query-result.json");
  const program = join(fixture.home, "query.ts");
  try {
    await writeFile(
      program,
      `
      import { writeFileSync } from "node:fs";
      let input = "";
      let received = false;
      let started = 0;
      process.stdin.setRawMode(true);
      process.stdin.on("data", (bytes) => {
        input += bytes.toString();
        const start = input.indexOf("\x1b]11;rgb:");
        const end = input.indexOf("\x07", start);
        if (start >= 0 && end >= start && !received) {
          received = true;
          writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
            latencyMs: performance.now() - started,
            reply: input.slice(start, end + 1),
          }));
        }
      });
      process.stdout.write("x".repeat(1_000_000));
      started = performance.now();
      process.stdout.write("\x1b]11;?\x07");
    `,
    );
    await focusSharedTerminal(tui);
    sharedWrite(tui, `exec '${process.execPath}' '${program}'\r`);
    // This wait is only a safety bound; the producer measures the reply deadline itself.
    const deadline = performance.now() + 10000;
    while (!(await Bun.file(resultPath).exists()) && performance.now() < deadline) {
      await Bun.sleep(20);
    }
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    expect(result.reply).toBe("\x1b]11;rgb:0000/0000/0000\x07");
    expect(result.latencyMs).toBeLessThan(1000);
  } finally {
    await fixture.close();
  }
}, 15000);

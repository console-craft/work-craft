import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createOutputProbe, type OutputObservation } from "@work-craft/server/client/output-probe";

export { createOutputProbe, type OutputObservation } from "@work-craft/server/client/output-probe";

const directory = process.env.WORK_CRAFT_OUTPUT_PROFILE_DIR;
const role = process.env.WORK_CRAFT_OUTPUT_PROFILE_ROLE;
let probe: ReturnType<typeof createOutputProbe> | undefined;
if (directory && role && ["daemon", "tui", "harness"].includes(role)) {
  const name = `${role}-tui-${process.pid}`;
  try {
    const identity = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(process.pid)]);
    const startedAt = identity.stdout.toString().trim();
    if (!identity.success || !startedAt) {
      throw new Error("Cannot establish diagnostic process identity");
    }
    writeFileSync(
      join(directory, `${name}.manifest.json`),
      JSON.stringify({ role, component: "tui", pid: process.pid, startedAt }),
      { mode: 0o600, flag: "wx" },
    );
    probe = createOutputProbe(
      (text) => appendFileSync(join(directory, `${name}.jsonl`), text, { mode: 0o600 }),
      () => performance.now(),
    );
    process.on("SIGUSR2", flushOutputProbe);
  } catch {
    // Diagnostics must not change startup or runtime failure handling.
  }
}
export const outputProbeEnabled = probe !== undefined;

export function observeOutput(event: OutputObservation): void {
  probe?.observe(event);
}

export function flushOutputProbe(): void {
  probe?.flush();
}

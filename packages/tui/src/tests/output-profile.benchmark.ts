import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { measureCapacityProfile } from "@/tests/support/output-capacity";
import { type ProfileMode, runOutputProfile } from "@/tests/support/output-profile";

const root = process.env.WORK_CRAFT_OUTPUT_PROFILE_DIR;
if (!root) {
  throw new Error("Set WORK_CRAFT_OUTPUT_PROFILE_DIR to a fresh output directory for benchmarks");
}

for (const mode of ["direct-pty", "native", "application"] as ProfileMode[]) {
  test(`output profile comparison ${mode}`, async () => {
    const failures: string[] = [];
    for (const diagnostics of mode === "application" ? [false, true] : [false]) {
      for (let run = 1; run <= 3; run++) {
        const directory = join(root!, `${mode}-${diagnostics ? "traced" : "control"}-${run}`);
        await mkdir(directory, { recursive: true });
        try {
          const result = await runOutputProfile(mode, directory, { diagnostics });
          expect(result.probes).toHaveLength(200);
        } catch (error) {
          failures.push(`${directory}: ${String(error)}`);
          await writeFile(
            join(directory, "failure.json"),
            JSON.stringify({ error: String(error) }),
          );
        }
      }
    }
    expect(failures).toEqual([]);
  }, 1200000);
}

test("output profile fifty-pane capacity and ten-minute soak", async () => {
  const directory = join(root!, "capacity");
  await mkdir(directory, { recursive: true });
  try {
    const result = await measureCapacityProfile(directory, { diagnostics: true });
    await writeFile(join(directory, "capacity-result.json"), JSON.stringify(result, null, 2));
    expect(result).toMatchObject({ panes: 50, complex: 10 });
  } catch (error) {
    await writeFile(join(directory, "failure.json"), JSON.stringify({ error: String(error) }));
    throw error;
  }
}, 1200000);

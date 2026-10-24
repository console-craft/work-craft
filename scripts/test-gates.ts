import { resolve } from "node:path";

import { runBounded } from "./run-bounded";

export type TestSuite = "core" | "acceptance" | "tooling";

// Explicit exceptions keep new correctness tests in core, never silently omitted.
export const nonCoreTests: Record<"acceptance" | "tooling", string[]> = {
  acceptance: [
    "packages/cli/src/cli.test.ts",
    "packages/server/src/acceptance.test.ts",
    "packages/server/src/application/commands.test.ts",
    "packages/server/src/application/directories.test.ts",
    "packages/server/src/application/discovery.test.ts",
    "packages/server/src/application/items.test.ts",
    "packages/server/src/application/shared-navigation.test.ts",
    "packages/server/src/api/http.test.ts",
    "packages/server/src/api/stopped-material.test.ts",
    "packages/server/src/daemon/lifecycle.test.ts",
    "packages/server/src/terminal/cwd.test.ts",
    "packages/server/src/terminal/runtime.test.ts",
    "packages/server/src/terminal/tests/projection-runtime.test.ts",
    "packages/server/src/terminal/tests/stopped-material.test.ts",
    "packages/tui/src/tests/shared-session.test.ts",
    "packages/tui/src/tests/cold-history.test.ts",
  ],
  tooling: [
    "scripts/probe-no-fork-terminal.test.ts",
    "scripts/preview.test.ts",
    "scripts/test-support/terminal-projection-paste.test.ts",
    "packages/tui/src/tests/output-profile-support.test.ts",
    "packages/server/src/terminal/tests/projection-feasibility.test.ts",
    "packages/tui/src/workbench/tests/projection-feasibility.test.tsx",
    "packages/tui/src/workbench/tests/terminal-continuation.test.ts",
    "packages/tui/src/workbench/tests/terminal-grid-feasibility.test.tsx",
  ],
};

const root = resolve(import.meta.dir, "..");

/** Discover correctness files, not explicitly selected benchmarks/diagnostics. */
export async function discoverTests(): Promise<string[]> {
  const glob = new Bun.Glob("{packages,scripts}/**/*{.,_}{test,spec}.{js,jsx,ts,tsx}");
  return (await Array.fromAsync(glob.scan({ cwd: root, onlyFiles: true })))
    .filter((path) => !path.split("/").includes("node_modules"))
    .sort();
}

/** Each discovered file belongs to exactly one gate; stale policy is an error. */
export function partitionTests(paths: string[]): Record<TestSuite, string[]> {
  const known = new Set(paths);
  if (known.size !== paths.length) {
    throw new Error("Duplicate discovered test path");
  }
  const exceptions = [...nonCoreTests.acceptance, ...nonCoreTests.tooling];
  if (new Set(exceptions).size !== exceptions.length) {
    throw new Error("A test belongs to multiple gates");
  }
  for (const path of exceptions) {
    if (!known.has(path)) {
      throw new Error(`Missing classified test: ${path}`);
    }
  }
  const result: Record<TestSuite, string[]> = { core: [], acceptance: [], tooling: [] };
  const membership = new Map<string, TestSuite>([
    ...nonCoreTests.acceptance.map((path) => [path, "acceptance"] as const),
    ...nonCoreTests.tooling.map((path) => [path, "tooling"] as const),
  ]);
  for (const path of [...paths].sort()) {
    result[membership.get(path) ?? "core"].push(path);
  }
  return result;
}

async function main(args: string[]): Promise<number> {
  const [selection, flag, ...extra] = args;
  if (
    !["core", "acceptance", "tooling", "all"].includes(selection ?? "") ||
    (flag !== undefined && flag !== "--list") ||
    extra.length
  ) {
    throw new Error("Usage: bun scripts/test-gates.ts <core|acceptance|tooling|all> [--list]");
  }
  const groups = partitionTests(await discoverTests());
  const selected: TestSuite[] =
    selection === "all" ? ["core", "acceptance"] : [selection as TestSuite];
  for (const suite of selected) {
    const paths = groups[suite].map((path) => `./${path}`);
    if (!paths.length) {
      throw new Error(`No tests selected for ${suite}`);
    }
    if (flag === "--list") {
      console.log(paths.join("\n"));
      continue;
    }
    const started = performance.now();
    console.log(
      `${suite}: ${paths.length} files; external deadline ${suite === "core" ? 120 : 300}s`,
    );
    const code = await runBounded(
      [process.execPath, "test", ...paths],
      suite === "core" ? 120000 : 300000,
    );
    console.log(`${suite}: exit ${code}; ${((performance.now() - started) / 1000).toFixed(2)}s`);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}

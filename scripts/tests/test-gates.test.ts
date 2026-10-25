import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { discoverTests, nonCoreTests, partitionTests } from "../test-gates";

test("filesystem discovery includes Bun's dot and underscore test/spec filenames", async () => {
  const directory = await mkdtemp(join(import.meta.dir, "gate-discovery-"));
  const names = ["example.test.ts", "example_test.ts", "example.spec.tsx", "example_spec.tsx"];
  try {
    for (const name of names) {
      await writeFile(join(directory, name), "export {};\n");
    }
    const paths = await discoverTests();
    const groups = partitionTests(paths);
    for (const name of names) {
      expect(groups.core).toContain(
        relative(join(import.meta.dir, "../.."), join(directory, name)),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every discovered product or tooling test has exactly one gate; new tests default to core", async () => {
  const paths = await discoverTests();
  const added = ["packages/server/src/new.test.ts", "packages/tui/src/ui/tests/new.test.tsx"];
  const groups = partitionTests([...paths, ...added]);
  const assigned = Object.values(groups).flat();
  expect(assigned.toSorted()).toEqual([...paths, ...added].toSorted());
  expect(new Set(assigned).size).toBe(assigned.length);
  expect(groups.core).toContain(added[0]!);
  expect(groups.core).toContain(added[1]!);
  expect(groups.acceptance).toContain(
    "packages/server/src/terminal/tests/stopped-material.test.ts",
  );
  expect(groups.tooling).toContain("packages/tui/src/tests/output-profile-support.test.ts");
  expect(groups.core).toContain("scripts/tests/run-bounded.test.ts");
  expect(groups.tooling).toContain("scripts/tests/probe-opentui-compatibility.test.ts");
  expect(groups.tooling).toContain("scripts/tests/terminal-projection-paste.test.ts");
  expect(groups.core).toContain("packages/cli/src/tests/args.test.ts");
  expect(groups.acceptance).toContain("packages/cli/src/tests/cli.test.ts");
  expect(groups.core).toContain("packages/server/src/tests/client.test.ts");
  expect(groups.acceptance).toContain("packages/server/src/tests/acceptance.test.ts");
  expect(groups.acceptance).toContain("scripts/tests/seed.test.ts");
  expect(paths.some((path) => /\.(benchmark|diagnostic)\./.test(path))).toBe(false);
});

test("duplicate discovery, stale policy and overlapping gates cannot silently lose tests", async () => {
  const paths = await discoverTests();
  expect(() => partitionTests([...paths, paths[0]!])).toThrow("Duplicate");
  expect(() => partitionTests(paths.filter((path) => path !== nonCoreTests.acceptance[0]))).toThrow(
    "Missing",
  );
  nonCoreTests.tooling.push(nonCoreTests.acceptance[0]!);
  try {
    expect(() => partitionTests(paths)).toThrow("multiple gates");
  } finally {
    nonCoreTests.tooling.pop();
  }
  expect(() => partitionTests([])).toThrow();
});

async function list(suite: string) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../test-gates.ts"), suite, "--list"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, paths: stdout.trim().split("\n"), stderr };
}

test("all selects every product test without executing research or benchmark fixtures", async () => {
  const all = await list("all");
  const core = await list("core");
  const acceptance = await list("acceptance");
  const tooling = await list("tooling");
  expect([all.code, core.code, acceptance.code, tooling.code]).toEqual([0, 0, 0, 0]);
  expect(all.paths.toSorted()).toEqual([...core.paths, ...acceptance.paths].toSorted());
  expect(all.paths.some((path) => tooling.paths.includes(path))).toBe(false);
  expect(all.paths.every((path) => path.startsWith("./"))).toBe(true);
  expect((await list("unknown")).code).not.toBe(0);
});

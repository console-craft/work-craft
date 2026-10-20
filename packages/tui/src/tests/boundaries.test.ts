import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../../..");
let temporary: string;
let sequence = 0;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "work-craft-boundaries-"));
  await mkdir(join(temporary, "packages/tui"), { recursive: true });
  for (const config of [".oxlintrc.json", "packages/tui/.oxlintrc.json"]) {
    await copyFile(join(repository, config), join(temporary, config));
  }
});
afterAll(async () => {
  if (temporary) {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function lint(owner: string, source: string): Promise<{ code: number; output: string }> {
  const path = join(temporary, "packages/tui/src", owner, `boundary-${++sequence}.ts`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
  const result = Bun.spawnSync([join(repository, "node_modules/.bin/oxlint"), path], {
    cwd: temporary,
  });
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

for (const form of ["value", "type"] as const) {
  const source = (path: string) =>
    form === "value"
      ? `import { thing } from "${path}"; export { thing };`
      : `import type { Thing } from "${path}"; export type Use = Thing;`;
  for (const [owner, path] of [
    ["ui/components", "@/shell/model"],
    ["ui/interaction", "@/shell/model"],
    ["ui/theming", "@/workbench/model"],
    ["ui", "@/client/store"],
    ["ui", "@/input/focus"],
    ["ui", "@/navigation/model"],
    ["ui", "@/workbench/model"],
    ["ui", "@/demos/components"],
    ["client", "@/shell/model"],
    ["input", "@/shell/model"],
    ["navigation", "@/shell/model"],
    ["workbench", "@/shell/model"],
    ["shell", "@/tests/support/fixtures"],
    ["shell", "@/navigation/tests/model.test"],
    ["shell", "@/ui/components/list.test.tsx"],
    ["shell", "@work-craft/server"],
    ["shell", "@work-craft/server/api/protocol"],
    ["shell", "@work-craft/server/client/private"],
    ["ui/tests", "../theming/theme"],
    ["tests/support", "@work-craft/server/persistence/database"],
  ]) {
    test(`TUI rejects ${form} import ${owner} -> ${path}`, async () => {
      const result = await lint(owner, source(path));
      expect(result.output).toContain("no-restricted-imports");
      expect(result.code).not.toBe(0);
    });
  }
  for (const [owner, path] of [
    ["shell", "@/navigation/model"],
    ["shell", "@/workbench/model"],
    ["shell", "@/client/store"],
    ["shell", "@/ui/theming/theme"],
    ["ui/components", "@/ui/theming/theme"],
    ["ui/components/tests", "@/shell/model"],
    ["client/tests", "@/client/store"],
    ["ui/components/tests", "@/tests/support/render"],
    ["ui/interaction/tests", "@/tests/support/render"],
    ["ui/theming/tests", "@/tests/support/render"],
    ["tests/support", "@/ui/theming/theme"],
    ["client", "@work-craft/server/client"],
  ]) {
    test(`TUI accepts ${form} import ${owner} -> ${path}`, async () => {
      const result = await lint(owner, source(path));
      expect(result).toEqual({ code: 0, output: "" });
    });
  }
}

test("TUI rejects production re-exports of test support", async () => {
  const result = await lint("shell", 'export { thing } from "@/tests/support/fixtures";');
  expect(result.output).toContain("no-restricted-imports");
  expect(result.code).not.toBe(0);
});

for (const [owner, path] of [
  ["ui", "@/shell/model"],
  ["shell", "@/tests/support/render"],
  ["client", "@work-craft/server/api/protocol"],
]) {
  test(`TUI rejects dynamic import ${owner} -> ${path}`, async () => {
    const result = await lint(owner, `export async function load() { return import("${path}"); }`);
    expect(result.output).toContain("no-restricted-imports");
    expect(result.code).not.toBe(0);
  });
}

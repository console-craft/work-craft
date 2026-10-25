import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  assertIndependentDirectory,
  assertRegistryManifest,
  assertRegistryResolution,
  assertSameCore,
  resolveProbeSources,
  runProbe,
  runProbeCommand,
} from "../probe-opentui-compatibility";

const manifest = {
  dependencies: { "@opentui/core": "0.6.6", "@opentui/react": "0.6.6", react: "19.3.0" },
};

test("projection source validation rejects a missing companion before any installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-sources-"));
  const paths = {
    "probe.test.js": "packages/tui/src/workbench/tests/opentui-compat-projection.fixture.tsx",
    "runtime.js": "packages/server/src/terminal/tests/opentui-compat-runtime.fixture.ts",
    "program.js": "packages/server/src/terminal/tests/opentui-compat-program.fixture.ts",
  };
  try {
    for (const path of Object.values(paths).slice(0, 2)) {
      const absolute = join(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, "export {};");
    }
    await expect(resolveProbeSources(root, "projection")).rejects.toThrow("program.js");
    await writeFile(join(root, paths["program.js"]), "export {};");
    expect(await resolveProbeSources(root, "projection")).toEqual(
      Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, join(root, path)])),
    );
    expect(await Bun.file(join(root, "bun.lock")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("probe refuses local overrides and private or floating dependency versions", () => {
  expect(() => assertRegistryManifest(manifest)).not.toThrow();
  for (const version of ["file:../fork.tgz", "0.6.6-workcraft.1", "^0.6.6"]) {
    expect(() =>
      assertRegistryManifest({
        dependencies: { ...manifest.dependencies, "@opentui/core": version },
      }),
    ).toThrow();
  }
  expect(() => assertRegistryManifest({ ...manifest, overrides: {} })).toThrow();
});

test("native asset overrides cannot reach a probe child", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-native-override-"));
  const marker = join(root, "executed");
  try {
    const launcher = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { runProbeCommand } from ${JSON.stringify(join(import.meta.dir, "../probe-opentui-compatibility.ts"))};
      await runProbeCommand([process.execPath, "-e", ${JSON.stringify(`await Bun.write(${JSON.stringify(marker)}, "executed")`)}],
        ${JSON.stringify(root)}, ${JSON.stringify(join(root, "probe.log"))}, 5000);
    `,
      ],
      {
        env: { ...process.env, OTUI_ASSET_ROOT: root },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const error = new Response(launcher.stderr).text();
    expect(await launcher.exited).not.toBe(0);
    expect(await error).toContain("OTUI_ASSET_ROOT");
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace ancestors are rejected through symlinks before installation can change their lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-workspace-"));
  try {
    const workspace = join(root, "workspace");
    const artifacts = join(workspace, "packages");
    await mkdir(artifacts, { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    const lock = join(workspace, "bun.lock");
    await writeFile(lock, "must remain untouched");
    const linked = join(root, "linked");
    await symlink(artifacts, linked);
    await expect(assertIndependentDirectory(linked)).rejects.toThrow("workspace");
    await expect(runProbe("contracts", linked)).rejects.toThrow("workspace");
    expect(await readFile(lock, "utf8")).toBe("must remain untouched");
    await expect(assertIndependentDirectory(root)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a consumer resolving core outside its owned directory, including symlinks", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "opentui-compat-resolution-")));
  try {
    const consumer = join(root, "consumer");
    const modules = join(consumer, "node_modules");
    await mkdir(modules, { recursive: true });
    const inside = join(modules, "core.js");
    const outside = join(root, "core.js");
    await writeFile(inside, "");
    await writeFile(outside, "");
    expect(() => assertRegistryResolution(consumer, inside, "0.6.6")).not.toThrow();
    expect(() => assertRegistryResolution(consumer, outside, "0.6.6")).toThrow();
    expect(() => assertRegistryResolution(consumer, inside, "0.6.6-workcraft.1")).toThrow();
    const linked = join(modules, "linked.js");
    await symlink(outside, linked);
    expect(() => assertRegistryResolution(consumer, linked, "0.6.6")).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("React may not resolve another copy of core even at the same version", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-core-"));
  try {
    const first = join(root, "first.js");
    const second = join(root, "second.js");
    await writeFile(first, "");
    await writeFile(second, "");
    expect(() => assertSameCore(first, first)).not.toThrow();
    expect(() => assertSameCore(first, second)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid or missing route fails before installation or artifact creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-route-"));
  const artifacts = join(root, "must-not-exist");
  try {
    await expect(runProbe("missing" as "contracts", artifacts)).rejects.toThrow("route");
    expect(await Bun.file(join(artifacts, "package.json")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed probe commands retain stdout/stderr and report nonzero exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentui-compat-command-"));
  const log = join(root, "failure.log");
  try {
    await expect(
      runProbeCommand(
        [
          process.execPath,
          "-e",
          'console.log("before-failure"); console.error("diagnostic"); process.exit(7)',
        ],
        root,
        log,
        5000,
      ),
    ).rejects.toThrow("7");
    const output = await readFile(log, "utf8");
    expect(output).toContain("before-failure");
    expect(output).toContain("diagnostic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

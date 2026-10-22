import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertRegistryManifest,
  assertRegistryResolution,
  assertSameCore,
  runProbe,
  runProbeCommand,
} from "./probe-no-fork-terminal";

const manifest = {
  dependencies: { "@opentui/core": "0.6.6", "@opentui/react": "0.6.6", react: "19.3.0" },
};

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

test("rejects a consumer resolving core outside its owned directory, including symlinks", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "no-fork-resolution-")));
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
  const root = await mkdtemp(join(tmpdir(), "no-fork-core-"));
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
  const root = await mkdtemp(join(tmpdir(), "no-fork-route-"));
  const artifacts = join(root, "must-not-exist");
  try {
    await expect(runProbe("missing" as "contracts", artifacts)).rejects.toThrow("route");
    expect(await Bun.file(join(artifacts, "package.json")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed probe commands retain stdout/stderr and report nonzero exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "no-fork-command-"));
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

test("a timeout reaps the owned probe and its child without signalling a different process", async () => {
  const root = await mkdtemp(join(tmpdir(), "no-fork-timeout-"));
  const pidFile = join(root, "pids.json");
  const unrelated = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const script = `
      const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdin: "ignore", stdout: "ignore", stderr: "ignore"
      });
      await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
      console.log("probe-started");
      setInterval(() => {}, 1000);
    `;
    await expect(
      runProbeCommand([process.execPath, "-e", script], root, join(root, "timeout.log"), 1000),
    ).rejects.toThrow("timed out");
    const pids: number[] = JSON.parse(await readFile(pidFile, "utf8"));
    for (const pid of pids) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
        } catch {
          break;
        }
        await Bun.sleep(10);
      }
      expect(() => process.kill(pid, 0)).toThrow();
    }
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
    expect(await readFile(join(root, "timeout.log"), "utf8")).toContain("probe-started");
  } finally {
    unrelated.kill("SIGKILL");
    await unrelated.exited;
    await rm(root, { recursive: true, force: true });
  }
});

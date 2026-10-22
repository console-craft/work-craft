import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertIndependentDirectory,
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

test("native asset overrides cannot reach a probe child", async () => {
  const root = await mkdtemp(join(tmpdir(), "no-fork-native-override-"));
  const marker = join(root, "executed");
  try {
    const launcher = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { runProbeCommand } from ${JSON.stringify(join(import.meta.dir, "probe-no-fork-terminal.ts"))};
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
  const root = await mkdtemp(join(tmpdir(), "no-fork-workspace-"));
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

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(10);
  }
  expect(() => process.kill(pid, 0)).toThrow();
}

for (const code of [0, 7]) {
  test(`an early leader exit ${code} cannot leave its owned descendant running`, async () => {
    const root = await mkdtemp(join(tmpdir(), "no-fork-early-exit-"));
    const pidFile = join(root, "pids.json");
    let pids: number[] = [];
    try {
      const script = `
        const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
          stdin: "ignore", stdout: "ignore", stderr: "ignore"
        });
        await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
        process.exit(${code});
      `;
      const run = runProbeCommand(
        [process.execPath, "-e", script],
        root,
        join(root, "probe.log"),
        1000,
      );
      if (code === 0) {
        await run;
      } else {
        await expect(run).rejects.toThrow("7");
      }
      pids = JSON.parse(await readFile(pidFile, "utf8"));
      await expectProcessGone(pids[1]!);
    } finally {
      if (pids[0]) {
        try {
          process.kill(-pids[0], "SIGKILL");
        } catch {}
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("cancelling the launcher stops its active owned probe group", async () => {
  const root = await mkdtemp(join(tmpdir(), "no-fork-cancel-"));
  const pidFile = join(root, "pids.json");
  const script = `
    const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore"
    });
    await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `;
  const launcher = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    import { runProbeCommand } from ${JSON.stringify(join(import.meta.dir, "probe-no-fork-terminal.ts"))};
    await runProbeCommand([process.execPath, "-e", ${JSON.stringify(script)}],
      ${JSON.stringify(root)}, ${JSON.stringify(join(root, "probe.log"))}, 10000);
  `,
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  let pids: number[] = [];
  try {
    const deadline = Date.now() + 5000;
    while (!(await Bun.file(pidFile).exists()) && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    pids = JSON.parse(await readFile(pidFile, "utf8"));
    launcher.kill("SIGTERM");
    expect(await launcher.exited).not.toBe(0);
    for (const pid of pids) {
      await expectProcessGone(pid);
    }
  } finally {
    launcher.kill("SIGKILL");
    await launcher.exited;
    if (pids[0]) {
      try {
        process.kill(-pids[0], "SIGKILL");
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  }
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

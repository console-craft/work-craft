import { closeSync, openSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const dependencies = {
  "@opentui/core": "0.6.6",
  "@opentui/react": "0.6.6",
  react: "19.3.0",
};
const routes = {
  contracts: "packages/tui/src/workbench/tests/no-fork-contracts.fixture.ts",
  client: "packages/tui/src/workbench/tests/no-fork-client.fixture.tsx",
  daemon: "packages/server/src/terminal/tests/no-fork-daemon.fixture.ts",
};

/** Experiments must not accidentally test the parent workspace's local overrides. */
export function assertRegistryManifest(value: unknown): void {
  const manifest = value as { dependencies?: Record<string, string>; overrides?: unknown } | null;
  if (
    !manifest ||
    manifest.overrides !== undefined ||
    Object.keys(manifest.dependencies ?? {}).length !== Object.keys(dependencies).length ||
    Object.entries(dependencies).some(
      ([name, version]) => manifest.dependencies?.[name] !== version,
    )
  ) {
    throw new Error("Probe requires exact registry dependencies without overrides");
  }
}

export function assertRegistryResolution(directory: string, path: string, version: string): void {
  const within = relative(realpathSync(join(directory, "node_modules")), realpathSync(path));
  if (
    version !== "0.6.6" ||
    within === ".." ||
    within.startsWith(`..${sep}`) ||
    resolve(within) === within
  ) {
    throw new Error(`Probe resolved a non-registry or outside dependency: ${path} (${version})`);
  }
}

export function assertSameCore(first: string, second: string): void {
  if (realpathSync(first) !== realpathSync(second)) {
    throw new Error("Probe React resolved a different core instance");
  }
}

/** Only a newly spawned process group is owned here; diagnostic files survive failures. */
export async function runProbeCommand(
  command: string[],
  cwd: string,
  log: string,
  timeoutMs: number,
): Promise<void> {
  const fd = openSync(log, "wx");
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(command, { cwd, detached: true, stdin: "ignore", stdout: fd, stderr: fd });
  } finally {
    closeSync(fd);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    if (child.exitCode === null) {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Group already exited. */
      }
    }
  }, timeoutMs);
  const code = await child.exited.finally(() => clearTimeout(timer));
  if (timedOut || code !== 0) {
    throw new Error(`${command[0]} ${timedOut ? "timed out" : `exited ${code}`}; evidence: ${log}`);
  }
}

const provenance = String.raw`
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, sep } from "node:path";
import { EmbeddedTerminalRenderable } from "@opentui/core";
const require = createRequire(import.meta.url);
const consumer = dirname(import.meta.path);
const packages = Object.fromEntries(["@opentui/core", "@opentui/react"].map(name => {
  const path = realpathSync(require.resolve(name));
  const within = relative(realpathSync(consumer + "/node_modules"), path);
  assert(within !== ".." && !within.startsWith(".." + sep) && !within.startsWith(sep));
  const metadata = JSON.parse(readFileSync(dirname(path) + "/package.json", "utf8"));
  assert.equal(metadata.version, "0.6.6");
  return [name, { path, version: metadata.version }];
}));
const reactRequire = createRequire(packages["@opentui/react"].path);
assert.equal(realpathSync(reactRequire.resolve("@opentui/core")), packages["@opentui/core"].path);
assert(!("onInputAdmission" in EmbeddedTerminalRenderable.prototype));
console.log(JSON.stringify(packages, null, 2));
`;

/** Opt-in only: root application dependencies and installed sources are never modified. */
export async function runProbe(
  route: "contracts" | "client" | "daemon",
  artifactDirectory: string,
): Promise<void> {
  if (!Object.hasOwn(routes, route)) {
    throw new Error(`Unknown probe route: ${route}`);
  }
  const entrypoint = join(root, routes[route]);
  if (!(await Bun.file(entrypoint).exists())) {
    throw new Error(`Missing probe route fixture: ${route}`);
  }
  await mkdir(artifactDirectory, { recursive: true });
  const consumer = await mkdtemp(join(resolve(artifactDirectory), `${route}-`));
  const manifest = {
    name: "work-craft-no-fork-probe",
    private: true,
    type: "module",
    dependencies,
  };
  assertRegistryManifest(manifest);
  await writeFile(join(consumer, "package.json"), JSON.stringify(manifest, null, 2));
  const result = { route, source: routes[route], dependencies, consumer, status: "running" };
  try {
    await runProbeCommand(
      [process.execPath, "install", "--ignore-scripts"],
      consumer,
      join(consumer, "install.log"),
      120000,
    );
    const build = await Bun.build({
      entrypoints: [entrypoint],
      target: "bun",
      format: "esm",
      outdir: consumer,
      naming: "probe.test.js",
      tsconfig: join(root, "tsconfig.json"),
      external: [
        "@opentui/core",
        "@opentui/core/*",
        "@opentui/react",
        "@opentui/react/*",
        "react",
        "react/*",
        "bun:test",
        "bun:ffi",
      ],
    });
    if (!build.success) {
      throw new AggregateError(build.logs, "Probe fixture build failed");
    }
    await writeFile(join(consumer, "provenance.ts"), provenance);
    await runProbeCommand(
      [process.execPath, "provenance.ts"],
      consumer,
      join(consumer, "provenance.json"),
      10000,
    );
    const resolved = JSON.parse(await readFile(join(consumer, "provenance.json"), "utf8"));
    for (const metadata of Object.values(resolved) as { path: string; version: string }[]) {
      assertRegistryResolution(consumer, metadata.path, metadata.version);
    }
    // Preserve the concrete tested registry lock, bundle and all logs, including failures.
    await runProbeCommand(
      [process.execPath, "test", "./probe.test.js"],
      consumer,
      join(consumer, "tests.log"),
      120000,
    );
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    await writeFile(join(consumer, "failure.txt"), String(error));
    throw error;
  } finally {
    await writeFile(join(consumer, "result.json"), JSON.stringify(result, null, 2));
    console.log(`No-fork ${route}: ${result.status}; evidence: ${consumer}`);
  }
}

if (import.meta.main) {
  const [route, directory] = process.argv.slice(2);
  if (!route || !directory) {
    throw new Error(
      "Usage: bun scripts/probe-no-fork-terminal.ts <contracts|client|daemon> <artifact-directory>",
    );
  }
  await runProbe(route as keyof typeof routes, directory);
}

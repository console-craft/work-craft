import { closeSync, openSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const dependencies = {
  "@opentui/core": "0.6.6",
  "@opentui/react": "0.6.6",
  react: "19.3.0",
};
const routes = {
  contracts: { "probe.test.js": "packages/tui/src/workbench/tests/no-fork-contracts.fixture.ts" },
  client: { "probe.test.js": "packages/tui/src/workbench/tests/no-fork-client.fixture.tsx" },
  daemon: { "probe.test.js": "packages/server/src/terminal/tests/no-fork-daemon.fixture.ts" },
  projection: {
    "probe.test.js": "packages/tui/src/workbench/tests/no-fork-projection.fixture.tsx",
    "runtime.js": "packages/server/src/terminal/tests/no-fork-runtime.fixture.ts",
    "program.js": "packages/server/src/terminal/tests/no-fork-program.fixture.ts",
  },
};
type ProbeRoute = keyof typeof routes;

export async function resolveProbeSources(
  rootDirectory: string,
  route: ProbeRoute,
): Promise<Record<string, string>> {
  if (!Object.hasOwn(routes, route)) {
    throw new Error(`Unknown probe route: ${route}`);
  }
  const sources: Record<string, string> = {};
  for (const [name, path] of Object.entries(routes[route])) {
    sources[name] = join(rootDirectory, path);
    if (!(await Bun.file(sources[name]).exists())) {
      throw new Error(`Missing probe route fixture ${name}: ${path}`);
    }
  }
  return sources;
}

/** Reject all workspace ancestors, even when their current globs would not match. */
export async function assertIndependentDirectory(directory: string): Promise<void> {
  let ancestor = realpathSync(directory);
  while (true) {
    const manifest = Bun.file(join(ancestor, "package.json"));
    if (await manifest.exists()) {
      if ((await manifest.json()).workspaces !== undefined) {
        throw new Error(`Probe artifact directory must not be inside a Bun workspace: ${ancestor}`);
      }
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      return;
    }
    ancestor = parent;
  }
}

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
  if (process.env.OTUI_ASSET_ROOT) {
    throw new Error("Registry probes require OTUI_ASSET_ROOT to be unset");
  }
  const fd = openSync(log, "wx");
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(command, { cwd, detached: true, stdin: "ignore", stdout: fd, stderr: fd });
  } finally {
    closeSync(fd);
  }
  let timedOut = false;
  let cancelled = false;
  let groupStopped = false;
  function stopGroup(): void {
    if (groupStopped) {
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
    // Timeout/cancellation already killed the group; exit cleanup must not signal it again.
    groupStopped = true;
  }
  function cancel(): void {
    cancelled = true;
    stopGroup();
  }
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const timer = setTimeout(() => {
    timedOut = true;
    stopGroup();
  }, timeoutMs);
  const code = await child.exited.finally(() => {
    clearTimeout(timer);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    // The leader can exit while descendants still own its process group.
    stopGroup();
  });
  if (cancelled || timedOut || code !== 0) {
    const reason = cancelled ? "cancelled" : timedOut ? "timed out" : `exited ${code}`;
    throw new Error(`${command[0]} ${reason}; evidence: ${log}`);
  }
}

const provenance = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
assert(!process.env.OTUI_ASSET_ROOT);
const nativeName = "@opentui/core-" + process.platform + "-" + process.arch +
  (process.platform === "linux" && process.env.OPENTUI_LIBC === "musl" ? "-musl" : "");
const nativePath = realpathSync((await import(nativeName)).default);
const nativeVersion = JSON.parse(readFileSync(dirname(require.resolve(nativeName)) + "/package.json", "utf8")).version;
assert.equal(nativeVersion, "0.6.6");
const nativeWithin = relative(realpathSync(consumer + "/node_modules"), nativePath);
assert(nativeWithin !== ".." && !nativeWithin.startsWith(".." + sep) && !nativeWithin.startsWith(sep));
packages[nativeName] = { path: nativePath, version: nativeVersion,
  sha256: createHash("sha256").update(readFileSync(nativePath)).digest("hex") };
const reactRequire = createRequire(packages["@opentui/react"].path);
assert.equal(realpathSync(reactRequire.resolve("@opentui/core")), packages["@opentui/core"].path);
assert(!("onInputAdmission" in EmbeddedTerminalRenderable.prototype));
console.log(JSON.stringify(packages, null, 2));
`;

/** Opt-in only: root application dependencies and installed sources are never modified. */
export async function runProbe(route: ProbeRoute, artifactDirectory: string): Promise<void> {
  const sources = await resolveProbeSources(root, route);
  await mkdir(artifactDirectory, { recursive: true });
  await assertIndependentDirectory(artifactDirectory);
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
    for (const [name, entrypoint] of Object.entries(sources)) {
      const build = await Bun.build({
        entrypoints: [entrypoint],
        target: "bun",
        format: "esm",
        outdir: consumer,
        naming: name,
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
      "Usage: bun scripts/probe-no-fork-terminal.ts <contracts|client|daemon|projection> <artifact-directory>",
    );
  }
  await runProbe(route as keyof typeof routes, directory);
}

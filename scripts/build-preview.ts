import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { TERMINAL_PROTOCOL } from "../packages/server/src/api/identity";
import { configurePreviewEnvironment } from "../src/preview-environment";

type Resolution = { name: string; version: string; path: string; locked: string };
export type PreviewProvenance = {
  protocol: string;
  builtAt: string;
  commit: string;
  executable: { path: string; sha256: string };
  lockSha256: string;
  packages: (Resolution & { integrity: string; verifiedFiles: number })[];
  native: { path: string; sha256: string };
  graph: { path: string; sha256: string; inputs: number; excludedForkFindings: string[] };
};

export function assertRegistryResolution(value: Resolution): void {
  assert(
    value.version === "0.6.6" &&
      value.locked === `${value.name}@0.6.6` &&
      !/vendor|workcraft\.1|\.tgz/.test(value.path),
    `Not an unmodified registry resolution: ${value.name}`,
  );
}

function hash(bytes: Uint8Array | string, algorithm = "sha256"): string {
  return createHash(algorithm)
    .update(bytes)
    .digest(algorithm === "sha512" ? "base64" : "hex");
}

async function verifyPackage(
  name: string,
  entry: string,
  locked: unknown[],
): Promise<PreviewProvenance["packages"][number]> {
  const path = dirname(realpathSync(entry));
  const metadata = await Bun.file(join(path, "package.json")).json();
  const value = { name, version: metadata.version as string, path, locked: String(locked[0]) };
  assertRegistryResolution(value);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/0.6.6`, {
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `Registry metadata failed: ${name}`);
  const registry = (await response.json()) as { dist: { integrity: string; tarball: string } };
  assert.equal(
    locked.at(-1),
    registry.dist.integrity,
    `Lock integrity differs from registry: ${name}`,
  );
  const archiveResponse = await fetch(registry.dist.tarball, {
    signal: AbortSignal.timeout(30000),
  });
  assert(archiveResponse.ok, `Registry archive failed: ${name}`);
  const bytes = new Uint8Array(await archiveResponse.arrayBuffer());
  assert.equal(`sha512-${hash(bytes, "sha512")}`, registry.dist.integrity);
  const files = await new Bun.Archive(bytes).files();
  let verifiedFiles = 0;
  for (const [file, blob] of files) {
    assert(file.startsWith("package/") && !file.split("/").includes(".."));
    const installed = Bun.file(join(path, file.slice(8)));
    assert.equal(
      hash(new Uint8Array(await installed.arrayBuffer())),
      hash(new Uint8Array(await blob.arrayBuffer())),
      `Installed bytes differ from registry: ${name}/${file}`,
    );
    verifiedFiles++;
  }
  return { ...value, integrity: registry.dist.integrity, verifiedFiles };
}

/** Builds the real entrypoint and verifies the installed files against registry archives. */
export async function buildPreview(outputPath: string): Promise<PreviewProvenance> {
  configurePreviewEnvironment({ ...process.env });
  const root = resolve(import.meta.dir, "..");
  const output = resolve(outputPath);
  const lockText = await Bun.file(join(root, "bun.lock")).text();
  const lock = Bun.JSONC.parse(lockText) as {
    overrides?: unknown;
    packages: Record<string, unknown[]>;
  };
  assert.equal(lock.overrides, undefined, "Preview must not use dependency overrides");
  const tui = createRequire(join(root, "packages/tui/package.json"));
  const core = createRequire(tui.resolve("@opentui/core"));
  const nativeName = `@opentui/core-${process.platform}-${process.arch}`;
  const entries = [
    ["@opentui/core", tui.resolve("@opentui/core")],
    ["@opentui/react", tui.resolve("@opentui/react")],
    [nativeName, core.resolve(nativeName)],
  ];
  const packages = await Promise.all(
    entries.map(([name, entry]) => verifyPackage(name!, entry!, lock.packages[name!]!)),
  );
  const nativePath = join(
    packages[2]!.path,
    process.platform === "darwin" ? "libopentui.dylib" : "libopentui.so",
  );
  await mkdir(dirname(output), { recursive: true });
  const graphPath = `${output}.graph.json`;
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "src/preview.ts",
      "--outfile",
      output,
      `--metafile=${graphPath}`,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  assert.equal(await child.exited, 0, "Preview compilation failed");
  const graphText = await Bun.file(graphPath).text();
  const graph = JSON.parse(graphText) as { inputs: Record<string, unknown> };
  const inputs = Object.keys(graph.inputs);
  const excludedForkFindings = inputs.filter((path) =>
    /vendor\/opentui|workcraft\.1|\/tests\/|scripts\/test-support|terminal-drain/.test(path),
  );
  assert.deepEqual(excludedForkFindings, [], "Preview graph includes fork/test fallback code");
  assert(
    inputs.some((path) => path.endsWith("libopentui.dylib") || path.endsWith("libopentui.so")),
    "Preview graph has no bundled native asset",
  );
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
  assert.equal(commit.exitCode, 0);
  const provenance: PreviewProvenance = {
    protocol: TERMINAL_PROTOCOL,
    builtAt: new Date().toISOString(),
    commit: commit.stdout.toString().trim(),
    executable: {
      path: output,
      sha256: hash(new Uint8Array(await Bun.file(output).arrayBuffer())),
    },
    lockSha256: hash(lockText),
    packages,
    native: {
      path: nativePath,
      sha256: hash(new Uint8Array(await Bun.file(nativePath).arrayBuffer())),
    },
    graph: {
      path: graphPath,
      sha256: hash(graphText),
      inputs: inputs.length,
      excludedForkFindings,
    },
  };
  await Bun.write(`${output}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}

if (import.meta.main) {
  console.log(
    JSON.stringify(await buildPreview(process.argv[2] ?? "dist/work-craft-preview"), null, 2),
  );
}

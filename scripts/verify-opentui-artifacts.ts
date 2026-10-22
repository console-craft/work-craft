import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type ArtifactManifest = {
  baseline: string;
  sourceCommit: string;
  sourcePatchSha256: string;
  version: string;
  tools: { bun: string; zig: string; node: string };
  artifacts: { name: string; file: string; sha256: string }[];
};

const version = "0.6.6-workcraft.1";
const variants = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "linux-arm64-musl",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
];
const names = [
  "@opentui/core",
  "@opentui/react",
  ...variants.map((variant) => `@opentui/core-${variant}`),
];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function requireArtifact(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`OpenTUI artifact: ${message}`);
  }
}

/** Validate the pinned source record and the complete matching packed dependency set. */
export async function verifyOpenTuiArtifacts(directory: string): Promise<void> {
  const manifest: ArtifactManifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  requireArtifact(
    manifest.baseline === "212eb27da4adf5b907031ad153fc6a5b9f713fbf",
    "wrong baseline",
  );
  requireArtifact(/^[a-f0-9]{40}$/.test(manifest.sourceCommit), "invalid source commit");
  requireArtifact(manifest.version === version, "wrong private version");
  requireArtifact(
    manifest.tools?.bun && manifest.tools.zig && manifest.tools.node,
    "missing tool provenance",
  );
  requireArtifact(
    sha(await readFile(join(directory, "source.patch"))) === manifest.sourcePatchSha256,
    "source patch checksum mismatch",
  );
  requireArtifact(
    Array.isArray(manifest.artifacts) && manifest.artifacts.length === names.length,
    "missing package or native variant",
  );
  const remaining = new Set(names);
  for (const artifact of manifest.artifacts) {
    requireArtifact(remaining.delete(artifact.name), "unexpected or duplicate package");
    requireArtifact(
      artifact.file === `${artifact.name.slice(1).replace("/", "-")}-${version}.tgz`,
      "invalid archive path",
    );
    const path = join(directory, artifact.file);
    requireArtifact((await lstat(path)).isFile(), "archive must be a regular file, not a link");
    requireArtifact(
      sha(await readFile(path)) === artifact.sha256,
      `${artifact.name} checksum mismatch`,
    );
    const metadata = JSON.parse(
      execFileSync("tar", ["-xOf", path, "package/package.json"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
      }),
    );
    requireArtifact(
      metadata.name === artifact.name && metadata.version === version,
      "mixed package name/version",
    );
    for (const dependencies of [
      metadata.dependencies,
      metadata.optionalDependencies,
      metadata.peerDependencies,
    ]) {
      for (const [name, value] of Object.entries(dependencies ?? {})) {
        requireArtifact(
          typeof value === "string" && !/^(?:file:|link:|workspace:)/.test(value),
          "linked runtime dependency",
        );
        if (names.includes(name)) {
          requireArtifact(value === version, "mixed runtime dependency version");
        }
      }
    }
    if (artifact.name === "@opentui/core") {
      for (const variant of variants) {
        requireArtifact(
          metadata.optionalDependencies?.[`@opentui/core-${variant}`] === version,
          "missing matching native dependency",
        );
      }
    }
    if (artifact.name === "@opentui/react") {
      requireArtifact(
        metadata.dependencies?.["@opentui/core"] === version,
        "missing matching React core dependency",
      );
    }
  }
}

if (import.meta.main) {
  await verifyOpenTuiArtifacts(resolve(process.argv[2] ?? "vendor/opentui"));
  console.log("OpenTUI artifact set verified");
}

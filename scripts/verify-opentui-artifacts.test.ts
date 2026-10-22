import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
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
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(options: { mixed?: boolean; linked?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "work-craft-opentui-artifacts-"));
  directories.push(directory);
  const source = join(directory, "fixture", "package");
  await mkdir(source, { recursive: true });
  await writeFile(join(directory, "source.patch"), "fixture source patch\n");
  const artifacts = [];
  for (const name of [
    "@opentui/core",
    "@opentui/react",
    ...variants.map((variant) => `@opentui/core-${variant}`),
  ]) {
    const metadata = {
      name,
      version: options.mixed && name === "@opentui/react" ? "0.6.6" : version,
      ...(name === "@opentui/core"
        ? {
            optionalDependencies: Object.fromEntries(
              variants.map((variant) => [`@opentui/core-${variant}`, version]),
            ),
          }
        : {}),
      ...(name === "@opentui/react"
        ? { dependencies: { "@opentui/core": options.linked ? "file:../core" : version } }
        : {}),
    };
    const file = `${name.slice(1).replace("/", "-")}-${version}.tgz`;
    await writeFile(join(source, "package.json"), JSON.stringify(metadata));
    execFileSync("tar", [
      "-czf",
      join(directory, file),
      "-C",
      join(directory, "fixture"),
      "package",
    ]);
    artifacts.push({ name, file, sha256: sha(await readFile(join(directory, file))) });
  }
  const manifest = {
    baseline: "212eb27da4adf5b907031ad153fc6a5b9f713fbf",
    sourceCommit: "a".repeat(40),
    sourcePatchSha256: sha("fixture source patch\n"),
    version,
    tools: { bun: "1.4.3", zig: "0.16.0", node: "26.5.0" },
    artifacts,
  };
  return { directory, manifest };
}

async function verify(data: Awaited<ReturnType<typeof fixture>>) {
  await writeFile(join(data.directory, "manifest.json"), JSON.stringify(data.manifest));
  const child = Bun.spawnSync(
    [process.execPath, resolve(import.meta.dir, "verify-opentui-artifacts.ts"), data.directory],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { code: child.exitCode, error: child.stderr.toString() };
}

test("a coherent pinned artifact set verifies through the CLI", async () => {
  expect(await verify(await fixture())).toEqual({ code: 0, error: "" });
});

test.each(["baseline", "source", "checksum", "missing", "duplicate"] as const)(
  "artifact verifier rejects %s inconsistency",
  async (fault) => {
    const data = await fixture();
    if (fault === "baseline") data.manifest.baseline = "b".repeat(40);
    if (fault === "source") await writeFile(join(data.directory, "source.patch"), "changed source");
    if (fault === "checksum")
      await writeFile(join(data.directory, data.manifest.artifacts[0]!.file), "changed archive");
    if (fault === "missing") data.manifest.artifacts.pop();
    if (fault === "duplicate") data.manifest.artifacts[1] = data.manifest.artifacts[0]!;
    const result = await verify(data);
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("OpenTUI artifact");
  },
);

test.each(["mixed", "linked"] as const)(
  "artifact verifier rejects %s package metadata",
  async (fault) => {
    const result = await verify(await fixture({ [fault]: true }));
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("OpenTUI artifact");
  },
);

import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseLsofCwd, readProcessCwd, validateSplitCwd } from "../cwd.ts";

test("lsof field parsing never trims the actual name", () => {
  expect(parseLsofCwd(Buffer.from("p42\0\nfcwd\0n/a b \0\n"), 42)).toBe("/a b ");
  expect(parseLsofCwd(Buffer.from("p42\0\nfcwd\0n/日本語 ü\0\n"), 42)).toBe("/日本語 ü");
});

test("lsof byte escapes preserve backslashes, newlines and UTF-8 exactly", () => {
  expect(parseLsofCwd(Buffer.from("p42\0\nfcwd\0n/a\\\\n\\n\\t\\r\\b\\f\0\n"), 42)).toBe(
    "/a\\n\n\t\r\b\f",
  );
  expect(parseLsofCwd(Buffer.from("p42\0\nfcwd\0n/\\xc3\\xbc\0\n"), 42)).toBe("/ü");
});

test.each([
  ["wrong process", "p43\0\nfcwd\0n/tmp\0\n"],
  ["duplicate process", "p42\0\np42\0\nfcwd\0n/tmp\0\n"],
  ["missing process", "fcwd\0n/tmp\0\n"],
  ["wrong descriptor", "p42\0\nf1\0n/tmp\0\n"],
  ["missing descriptor", "p42\0\nn/tmp\0\n"],
  ["duplicate descriptor", "p42\0\nfcwd\0fcwd\0n/tmp\0\n"],
  ["missing name", "p42\0\nfcwd\0\n"],
  ["empty name", "p42\0\nfcwd\0n\0\n"],
  ["relative name", "p42\0\nfcwd\0nrelative\0\n"],
  ["duplicate name", "p42\0\nfcwd\0n/tmp\0n/elsewhere\0\n"],
  ["truncated field", "p42\0\nfcwd\0n/tmp"],
  ["truncated record", "p42\0\nfcwd\0n/tmp\0"],
  ["unknown escape", "p42\0\nfcwd\0n/a\\q\0\n"],
  ["truncated escape", "p42\0\nfcwd\0n/a\\\0\n"],
  ["truncated hex escape", "p42\0\nfcwd\0n/a\\x1\0\n"],
  ["ambiguous octal escape", "p42\0\nfcwd\0n/a\\123\0\n"],
  ["ambiguous caret escape", "p42\0\nfcwd\0n/a^A\0\n"],
  ["ambiguous escape caret", "p42\0\nfcwd\0n/a^[\0\n"],
  ["deleted directory", "p42\0\nfcwd\0n/tmp (deleted)\0\n"],
  ["escaped NUL", "p42\0\nfcwd\0n/a\\x00\0\n"],
  ["invalid escaped encoding", "p42\0\nfcwd\0n/a\\xff\0\n"],
])("lsof rejects %s", (_reason, output) => {
  expect(() => parseLsofCwd(Buffer.from(output), 42)).toThrow();
});

test("lsof rejects invalid raw UTF-8 rather than replacing bytes", () => {
  const output = Buffer.concat([Buffer.from("p42\0\nfcwd\0n/"), Buffer.from([0xff, 0, 10])]);
  expect(() => parseLsofCwd(output, 42)).toThrow();
});

test("lsof rejects high-bit bytes masquerading as hex digits", () => {
  const output = Buffer.concat([
    Buffer.from("p42\0\nfcwd\0n/\\x"),
    Buffer.from([0xb4, 0xb1]),
    Buffer.from("\0\n"),
  ]);
  expect(() => parseLsofCwd(output, 42)).toThrow();
});

test("split cwd validation preserves exact absolute path characters", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "work-craft-cwd-")));
  try {
    const path = join(root, "space ü back\\slash new\nline ");
    await mkdir(path);
    expect(await validateSplitCwd(path)).toBe(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("split cwd rejects blank, NUL, relative, missing and non-directory paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "work-craft-cwd-invalid-"));
  try {
    const file = join(root, "file");
    await writeFile(file, "not a directory");
    for (const path of ["", "  ", "\0", ".", "relative", join(root, "missing"), file]) {
      await expect(validateSplitCwd(path)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.getuid?.() === 0)("split cwd rejects inaccessible directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "work-craft-cwd-access-"));
  try {
    for (const mode of [0o000, 0o111, 0o444]) {
      await chmod(root, mode);
      await expect(validateSplitCwd(root)).rejects.toThrow();
    }
  } finally {
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test("process cwd rejects invalid and missing PIDs", async () => {
  for (const pid of [0, -1, 1.5, NaN, 2_147_483_647]) {
    await expect(readProcessCwd(pid)).rejects.toThrow();
  }
});

test.skipIf(process.platform !== "darwin")("missing lsof fails explicitly", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
    throw new Error("ENOENT /usr/sbin/lsof");
  });
  try {
    await expect(readProcessCwd(process.pid)).rejects.toThrow("lsof");
  } finally {
    spawn.mockRestore();
  }
});

for (const [name, script, error] of [
  [
    "oversized cwd output is bounded and reaped",
    'process.stdout.write("a".repeat(40_000)); process.stderr.write("b".repeat(40_000)); setInterval(() => {}, 1000)',
    "64 KiB",
  ],
  [
    "failed cwd inspection is reaped",
    'process.stderr.write("permission denied"); process.exit(1)',
    "permission denied",
  ],
] as const) {
  test.skipIf(process.platform !== "darwin")(name, async () => {
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    let settled = false;
    void child.exited.then(() => {
      settled = true;
    });
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => child);
    const started = Date.now();
    try {
      await expect(readProcessCwd(process.pid)).rejects.toThrow(error);
      expect(settled).toBe(true);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(() => process.kill(child.pid, 0)).toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      spawn.mockRestore();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      await child.exited;
    }
  });
}

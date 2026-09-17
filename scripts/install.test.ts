import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("installs into an off-PATH override", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "work-craft-install-"));
  const installDirectory = join(temporaryDirectory, "bin");
  const source = join(temporaryDirectory, "dist", "work-craft");

  try {
    await mkdir(join(temporaryDirectory, "dist"));
    await writeFile(source, "test executable");

    const child = Bun.spawn(["sh", join(root, "scripts", "install.sh")], {
      cwd: temporaryDirectory,
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
        WORK_CRAFT_BIN_DIR: installDirectory,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(await Bun.file(join(installDirectory, "work-craft")).text()).toBe("test executable");
    expect((await stat(join(installDirectory, "work-craft"))).mode & 0o777).toBe(0o755);
    expect(stdout).toContain(`Installed work-craft to ${installDirectory}`);
    expect(stdout).toContain(`${installDirectory} is not on PATH`);
    expect(stdout).toContain(`Add ${installDirectory} to PATH in your shell configuration.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

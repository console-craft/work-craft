import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const hooks = Bun.YAML.parse(await Bun.file(join(root, "lefthook.yml")).text()) as Record<
  string,
  { jobs: { name: string; run: string }[] }
>;

for (const [hook, job] of [["pre-push", "check"]] as const) {
  test(`${hook} isolates fixture Git commands from the invoking repository`, async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "work-craft-hook-"));
    const invoking = join(temporaryDirectory, "invoking");
    const fixture = join(temporaryDirectory, "fixture");
    // Setup must remain independent even when this regression itself runs in a Git hook.
    const env = {
      PATH: process.env.PATH,
      HOME: temporaryDirectory,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    function git(path: string, ...args: string[]): string {
      const result = Bun.spawnSync(["git", "-C", path, "-c", "core.hooksPath=/dev/null", ...args], {
        env,
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString().trim();
    }

    try {
      for (const path of [invoking, fixture]) {
        await mkdir(path);
        git(path, "init", "--initial-branch=main");
        git(path, "commit", "--allow-empty", "-m", "initial");
      }
      const invokingHead = git(invoking, "rev-parse", "HEAD");
      const fixtureHead = git(fixture, "rev-parse", "HEAD");
      const command = hooks[hook]!.jobs.find((entry) => entry.name === job)!.run;
      const result = Bun.spawnSync(
        [
          "sh",
          "-ec",
          `bun() {
            test "$*" = "run ${job}"
            git -C "$FIXTURE" -c core.hooksPath=/dev/null commit --allow-empty -m fixture
          }
          ${command}`,
        ],
        {
          cwd: invoking,
          env: {
            ...env,
            FIXTURE: fixture,
            GIT_DIR: join(invoking, ".git"),
            GIT_WORK_TREE: invoking,
            GIT_INDEX_FILE: join(invoking, ".git", "index"),
            GIT_COMMON_DIR: join(invoking, ".git"),
          },
        },
      );

      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(git(invoking, "rev-parse", "HEAD")).toBe(invokingHead);
      expect(git(fixture, "rev-parse", "HEAD")).not.toBe(fixtureHead);
      expect(git(fixture, "log", "-1", "--format=%s")).toBe("fixture");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
}

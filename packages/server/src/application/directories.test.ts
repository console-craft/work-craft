import { afterEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { ProtocolError } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { createApp } from "./app.ts";
import { canonicalDirectoryPath, inspectDirectory, parseWorktrees } from "./directories.ts";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function fixture(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "work-craft-directories-")));
  temporary.push(path);
  return path;
}

function git(path: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", path, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

async function repository(): Promise<string> {
  const path = await fixture();
  git(path, "init", "--initial-branch=trunk");
  git(path, "commit", "--allow-empty", "-m", "initial");
  return path;
}

test("plain and nested directories keep their own cwd", async () => {
  const plain = await fixture();
  expect(await inspectDirectory(plain)).toEqual({ path: plain, available: true, git: null });
  const repo = await repository();
  const nested = join(repo, "nested");
  await mkdir(nested);
  expect(await inspectDirectory(nested)).toEqual({ path: nested, available: true, git: null });
  expect(git(repo, "status", "--porcelain")).toBe("");
});

test("registry discovers external worktrees without assuming main", async () => {
  const repo = await repository();
  const external = join(await fixture(), "external tree");
  git(repo, "worktree", "add", "-b", "feature", external);
  git(repo, "worktree", "lock", external);
  const scan = await inspectDirectory(repo);
  expect(scan.git).toEqual({
    commonDir: join(repo, ".git"),
    primary: { path: repo, branch: "trunk", available: true },
    branch: "trunk",
    worktrees: [{ path: external, branch: "feature", available: true }],
  });
  expect((await inspectDirectory(external)).git?.worktrees).toEqual([
    { path: repo, branch: "trunk", available: true },
  ]);
  git(repo, "worktree", "unlock", external);
  await rm(external, { recursive: true });
  expect((await inspectDirectory(repo)).git?.worktrees[0]).toMatchObject({
    path: external,
    available: false,
  });
  git(repo, "worktree", "prune");
  expect((await inspectDirectory(repo)).git?.worktrees).toEqual([]);
  git(repo, "worktree", "add", external, "feature");
  expect((await inspectDirectory(repo)).git?.worktrees[0]).toMatchObject({
    path: external,
    branch: "feature",
    available: true,
  });
});

test("linked inspection identifies the same primary before excluding self", async () => {
  const repo = await repository();
  const linked = join(await fixture(), "linked tree");
  git(repo, "worktree", "add", "-b", "feature", linked);
  const fromPrimary = await inspectDirectory(repo);
  const fromLinked = await inspectDirectory(linked);
  expect(fromLinked.git?.primary).toMatchObject({ path: repo, branch: "trunk" });
  expect(fromPrimary.git?.primary).toEqual(fromLinked.git?.primary);
  expect(fromLinked.git?.branch).toBe("feature");
  expect(fromLinked.git?.worktrees.map(({ path }) => path)).toContain(repo);
  expect(fromLinked.git?.worktrees.map(({ path }) => path)).not.toContain(linked);
  git(repo, "checkout", "--detach");
  expect((await inspectDirectory(linked)).git?.primary).toEqual({
    path: repo,
    branch: null,
    available: true,
  });
});

test("linked Gitdir alias has canonical repository identity", async () => {
  const repo = await repository();
  const parent = await fixture();
  const linked = join(parent, "linked");
  const alias = join(parent, " alias\\\n ");
  git(repo, "worktree", "add", "-b", "feature", linked);
  await symlink(repo, alias);
  const gitFile = join(linked, ".git");
  await writeFile(
    gitFile,
    (await readFile(gitFile, "utf8")).replace(`${repo}/.git/`, `${alias}/.git/`),
  );
  const scan = await inspectDirectory(linked);
  expect(scan.git?.commonDir).toBe(join(repo, ".git"));
  expect(scan.git?.primary).toMatchObject({ path: repo, branch: "trunk" });
  expect(scan.discoveryError).toBeUndefined();
});

test("separated primary absent from the registry fails without guessing a parent", async () => {
  const parent = await fixture();
  const repo = join(parent, "checkout");
  const canonicalCommonDir = join(parent, " common \\\nmetadata ");
  const alias = join(parent, "metadata alias");
  await mkdir(repo);
  git(repo, "init", "--initial-branch=trunk", `--separate-git-dir=${canonicalCommonDir}`);
  git(repo, "commit", "--allow-empty", "-m", "initial");
  await symlink(canonicalCommonDir, alias);
  await writeFile(join(repo, ".git"), `gitdir: ${alias}\n`);
  const separate = await inspectDirectory(repo);
  expect(separate.git).toBeNull();
  expect(separate.discoveryError).toMatch(/absent.*registry/i);
});

for (const metadataAlias of [false, true]) {
  test(`separated linked-first inspection and registration reject metadata as primary (${metadataAlias ? "alias" : "canonical"})`, async () => {
    const parent = await fixture();
    const repo = join(parent, "checkout");
    const linked = join(parent, "linked");
    const commonDir = join(parent, " common \\\nmetadata ");
    const alias = join(parent, "metadata alias");
    await mkdir(repo);
    git(repo, "init", "--initial-branch=trunk", `--separate-git-dir=${commonDir}`);
    git(repo, "commit", "--allow-empty", "-m", "initial");
    if (metadataAlias) {
      await symlink(commonDir, alias);
      await writeFile(join(repo, ".git"), `gitdir: ${alias}\n`);
    }
    git(repo, "worktree", "add", "-b", "feature", linked);
    const db = openDatabase(":memory:");
    const app = createApp({ db });
    try {
      const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
      const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
        .result.id;
      for (const path of [linked, repo]) {
        const scan = await inspectDirectory(path);
        expect(scan.git).toBeNull();
        expect(scan.discoveryError).toMatch(/unsupported|absent.*registry/i);
        await expect(
          app.execute({ type: "directory.register", workspaceId, path }),
        ).rejects.toMatchObject({ field: undefined });
        expect(app.snapshot().items).toEqual([]);
        expect(app.snapshot().surfaces).toEqual([]);
        expect(app.snapshot().panes).toEqual([]);
      }
    } finally {
      await app.closeDirectoryRefresh();
      await app.runtime.stopAll();
      await app.history.close();
      db.close();
    }
  });
}

test("bare-backed linked checkout reports unsupported layout", async () => {
  const parent = await fixture();
  const bare = join(parent, "bare.git");
  const linked = join(parent, "linked");
  const source = await repository();
  git(parent, "clone", "--bare", source, bare);
  git(bare, "worktree", "add", "-b", "feature", linked);
  expect(await inspectDirectory(bare)).toEqual({ path: bare, available: true, git: null });
  const bareLinked = await inspectDirectory(linked);
  expect(bareLinked.git).toBeNull();
  expect(bareLinked.discoveryError).toMatch(/bare|unsupported/i);
});

test("a linked checkout can inspect an unavailable primary independently", async () => {
  await withGitShim(
    `process.stdout.write(process.argv.includes('rev-parse') ? process.argv[4]+'/.git\\n' : 'worktree '+process.argv[4]+'/missing-primary\\0HEAD abc\\0branch refs/heads/trunk\\0\\0worktree '+process.argv[4]+'\\0HEAD def\\0branch refs/heads/feature\\0\\0');`,
    async (path) => {
      const scan = await inspectDirectory(path);
      expect(scan.discoveryError).toBeUndefined();
      expect(scan.git?.primary).toMatchObject({
        path: join(path, "missing-primary"),
        branch: "trunk",
        available: false,
      });
      expect(scan.git?.primary.reason).toBeDefined();
      expect(scan.git?.branch).toBe("feature");
    },
  );
});

test("branch and detached metadata survive unusual paths", async () => {
  const repo = await repository();
  const external = join(await fixture(), '-雪 "quote" \\back\nline $(touch nope)');
  git(repo, "worktree", "add", "--detach", external);
  expect((await inspectDirectory(repo)).git?.worktrees).toEqual([
    { path: external, branch: null, available: true },
  ]);
  expect((await inspectDirectory(external)).git?.commonDir).toBe(join(repo, ".git"));
  const commonParent = await fixture();
  const unusual = join(commonParent, ' repo\n"\\ ');
  await mkdir(unusual);
  git(unusual, "init", "--initial-branch=trunk");
  git(unusual, "commit", "--allow-empty", "-m", "initial");
  expect((await inspectDirectory(unusual)).git?.commonDir).toBe(join(unusual, ".git"));
  expect((await inspectDirectory(unusual)).git?.primary).toEqual({
    path: unusual,
    branch: "trunk",
    available: true,
  });
});

test("parses NUL records without splitting path bytes or optional fields", () => {
  expect(
    parseWorktrees(
      "worktree /a\n\t\u001b\0HEAD abc\0branch refs/heads/trunk\0locked reason\0future value\0\0worktree /b\0HEAD def\0detached\0prunable missing directory\0\0",
    ),
  ).toEqual([
    { path: "/a\n\t\u001b", branch: "trunk", available: true, bare: false },
    { path: "/b", branch: null, available: false, reason: "missing directory", bare: false },
  ]);
  for (const output of [
    "",
    "worktree /a\nHEAD abc\n",
    "HEAD abc\0\0",
    "worktree relative\0HEAD abc\0detached\0\0",
    "worktree /a\0HEAD abc\0\0",
    "worktree /a\0HEAD abc\0detached\0branch refs/heads/x\0\0",
    "worktree /a\0HEAD abc\0detached\0\0worktree /a\0HEAD def\0branch refs/heads/y\0\0",
  ]) {
    expect(() => parseWorktrees(output)).toThrow();
  }
  expect(
    parseWorktrees("worktree /bare \\tree\n\0bare\0\0worktree /linked\0HEAD abc\0detached\0\0"),
  ).toEqual([
    { path: "/bare \\tree\n", branch: null, available: true, bare: true },
    { path: "/linked", branch: null, available: true, bare: false },
  ]);
});

test("canonical registration validates fields without trimming valid path bytes", async () => {
  const parent = await fixture();
  const target = join(parent, " spaced ");
  const link = join(parent, "link");
  await mkdir(target);
  await symlink(target, link);
  expect(await canonicalDirectoryPath(link)).toBe(target);
  expect(await canonicalDirectoryPath("~")).toBe(await realpath(homedir()));
  await writeFile(join(parent, "file"), "data");
  for (const path of [
    "",
    "   ",
    "relative",
    "~other",
    "/a\0b",
    join(parent, "missing"),
    join(parent, "file"),
  ]) {
    try {
      await canonicalDirectoryPath(path);
      throw new Error("accepted invalid path");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).field).toBe("path");
    }
  }
  expect(await inspectDirectory(link)).toMatchObject({ path: link, available: false, git: null });
  const protectedPath = join(parent, "protected");
  await mkdir(protectedPath, { mode: 0o000 });
  try {
    await expect(canonicalDirectoryPath(protectedPath)).rejects.not.toBeInstanceOf(ProtocolError);
  } finally {
    await chmod(protectedPath, 0o700);
  }
});

test("canonical symlinks preserve backslash targets and remembered targets never retarget", async () => {
  const parent = await fixture();
  const target = join(parent, "target\\name");
  const link = join(parent, "link");
  await mkdir(target);
  await symlink(target, link);
  expect(await canonicalDirectoryPath(link)).toBe(target);
  const other = join(parent, "other");
  await mkdir(other);
  await rm(target, { recursive: true });
  await symlink(other, target);
  expect(await inspectDirectory(target)).toMatchObject({
    path: target,
    available: false,
    git: null,
  });
  expect(await canonicalDirectoryPath(link)).toBe(other);
});

test("backslash symlinks resolve dot-dot after following intermediate links", async () => {
  const parent = await fixture();
  await mkdir(join(parent, "target", "inner"), { recursive: true });
  await mkdir(join(parent, "outer"));
  await symlink(join(parent, "target", "inner"), join(parent, "outer", "link"));
  const jump = join(parent, "jump\\name");
  await symlink("outer/link/../", jump);
  expect(await canonicalDirectoryPath(jump)).toBe(join(parent, "target"));
});

test("backslash canonicalization preserves filesystem casing and registration identity", async () => {
  const parent = await fixture();
  const target = join(parent, "MiXeD\\Name");
  const alias = join(parent, "mixed\\name");
  await mkdir(target);
  try {
    await stat(alias);
  } catch (error) {
    // Case-sensitive filesystems correctly reject this spelling instead.
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    await expect(canonicalDirectoryPath(alias)).rejects.toBeInstanceOf(ProtocolError);
    return;
  }
  expect(await canonicalDirectoryPath(alias)).toBe(target);
  expect(await canonicalDirectoryPath(target)).toBe(target);
});

test("conflicting HEADs and repeated structural fields fail instead of becoming empty success", () => {
  for (const output of [
    "worktree /a\0HEAD abc\0branch refs/heads/trunk\0\0worktree /a\0HEAD def\0branch refs/heads/trunk\0\0",
    "worktree /a\0worktree /b\0HEAD abc\0detached\0\0",
  ]) {
    expect(() => parseWorktrees(output)).toThrow();
  }
});

test("reserved malformed fields and conflicting availability or bare records are rejected", () => {
  for (const output of [
    "worktree /a\0HEAD abc\0branch\0detached\0\0",
    "worktree /a\0HEAD abc\0branch refs/heads/trunk\0prunable first\0prunable second\0\0",
    "worktree /a\0bare\0\0worktree /a\0HEAD abc\0detached\0\0",
    "worktree /a\0HEAD abc\0detached reason\0detached\0\0",
    "worktree /a\0HEAD abc\0bare reason\0detached\0\0",
    "worktree /a\0HEAD abc\0detached\0locked first\0locked second\0\0",
  ]) {
    expect(() => parseWorktrees(output)).toThrow();
  }
  expect(parseWorktrees("worktree /a\0HEAD abc\0detached\0future optional\0\0")).toEqual([
    { path: "/a", branch: null, available: true, bare: false },
  ]);
});

async function withGitShim(
  mode: string,
  run: (path: string, pidFile: string) => Promise<void>,
): Promise<void> {
  const path = await fixture();
  await mkdir(join(path, ".git"));
  const bin = join(path, "bin");
  await mkdir(bin);
  const pidFile = join(path, "pid");
  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${mode}\n`,
    { mode: 0o755 },
  );
  const saved = process.env.PATH;
  process.env.PATH = bin;
  try {
    await run(path, pidFile);
  } finally {
    process.env.PATH = saved;
  }
}

test("malformed and duplicate primary records fail without promoting a linked checkout", async () => {
  for (const primary of [
    "worktree /primary\0HEAD abc\0",
    "worktree /primary\0HEAD abc\0detached\0\0worktree /primary\0HEAD abc\0detached\0",
  ]) {
    await withGitShim(
      `process.stdout.write(process.argv.includes('rev-parse') ? process.argv[4]+'/.git\\n' : ${JSON.stringify(primary)}+'\\0worktree '+process.argv[4]+'\\0HEAD def\\0branch refs/heads/feature\\0\\0');`,
      async (path) => {
        const scan = await inspectDirectory(path);
        expect(scan.git).toBeNull();
        expect(scan.discoveryError).toMatch(/incomplete|duplicate/i);
      },
    );
  }
});

test("canonical aliases cannot duplicate the primary or requested checkout", async () => {
  await withGitShim(
    `process.stdout.write(process.argv.includes('rev-parse') ? process.argv[4]+'/.git\\n' : 'worktree '+process.argv[4]+'\\0HEAD abc\\0detached\\0\\0worktree '+process.argv[4]+'/alias\\0HEAD abc\\0detached\\0\\0');`,
    async (path) => {
      await symlink(path, join(path, "alias"));
      const scan = await inspectDirectory(path);
      expect(scan.git).toBeNull();
      expect(scan.discoveryError).toMatch(/duplicate/i);
    },
  );
});

test("Git common directory output is canonicalized without trimming path bytes", async () => {
  await withGitShim(
    `process.stdout.write(process.argv.includes('rev-parse') ? process.argv[4]+${JSON.stringify("/ common \\ alias \n")} : 'worktree '+process.argv[4]+'\\0HEAD abc\\0detached\\0\\0');`,
    async (path) => {
      await symlink(join(path, ".git"), join(path, " common \\ alias "));
      const scan = await inspectDirectory(path);
      expect(scan.git?.commonDir).toBe(join(path, ".git"));
      expect(scan.discoveryError).toBeUndefined();
    },
  );
});

test("scan failure is not empty membership", async () => {
  await withGitShim("process.stderr.write('fatal: denied'); process.exit(1);", async (path) => {
    expect(await inspectDirectory(path)).toMatchObject({
      path,
      available: true,
      git: null,
      discoveryError: expect.stringContaining("denied"),
    });
  });
  await withGitShim("process.stdout.write('malformed');", async (path) => {
    expect((await inspectDirectory(path)).discoveryError).toBeDefined();
  });
  await withGitShim("process.exit(0)", async (path) => {
    process.env.PATH = join(path, "missing-bin");
    expect((await inspectDirectory(path)).discoveryError).toBeDefined();
  });
});

test("bounded Git processes are drained killed and reaped on overflow timeout and abort", async () => {
  for (const mode of [
    "process.stdout.write('x'.repeat(1048577)); setInterval(()=>{},1000);",
    "process.stderr.write('x'.repeat(1048577)); setInterval(()=>{},1000);",
    "setInterval(()=>{},1000);",
  ]) {
    await withGitShim(mode, async (path, pidFile) => {
      const start = Date.now();
      const scan = await inspectDirectory(path);
      expect(scan.discoveryError).toBeDefined();
      expect(Date.now() - start).toBeLessThan(3000);
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    });
  }
  await withGitShim("setInterval(()=>{},1000);", async (path, pidFile) => {
    const controller = new AbortController();
    const scan = inspectDirectory(path, controller.signal);
    while (!(await Bun.file(pidFile).exists())) {
      await Bun.sleep(1);
    }
    controller.abort();
    expect((await scan).discoveryError).toBeDefined();
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });
}, 10000);

test("Git commands share one total budget and ignore inherited repository redirection", async () => {
  await withGitShim(
    "await Bun.sleep(1200); process.stdout.write(process.argv.includes('rev-parse') ? '/common\\n' : 'worktree '+process.argv[4]+'\\0HEAD abc\\0detached\\0\\0');",
    async (path) => {
      const start = Date.now();
      expect((await inspectDirectory(path)).discoveryError).toBeDefined();
      expect(Date.now() - start).toBeLessThan(2800);
    },
  );
  const repo = await repository();
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = "/nonexistent";
  try {
    expect((await inspectDirectory(repo)).git?.branch).toBe("trunk");
  } finally {
    if (saved === undefined) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = saved;
    }
  }
});

test("timeout and abort bound inherited pipes and terminate Git descendants", async () => {
  for (const abort of [false, true]) {
    await withGitShim(
      `const child = Bun.spawn([process.execPath, '-e', 'await Bun.sleep(4500)'], {stdout:'inherit', stderr:'inherit'});
       writeFileSync(process.argv[4]+'/descendant', String(child.pid));
       setInterval(()=>{},1000);`,
      async (path, pidFile) => {
        const controller = new AbortController();
        const scan = inspectDirectory(path, controller.signal);
        const descendant = join(path, "descendant");
        let descendantPid: number | undefined;
        try {
          const readinessDeadline = Date.now() + 2000;
          while (!(await Bun.file(descendant).exists()) && Date.now() < readinessDeadline) {
            await Bun.sleep(1);
          }
          descendantPid = Number(await readFile(descendant, "utf8"));
          const start = Date.now();
          if (abort) {
            controller.abort();
          }
          expect((await scan).discoveryError).toMatch(abort ? /abort/i : /timed out/i);
          expect(Date.now() - start).toBeLessThan(abort ? 1000 : 2800);
          const wrapperPid = Number(await readFile(pidFile, "utf8"));
          expect(() => process.kill(wrapperPid, 0)).toThrow();
          expect(() => process.kill(descendantPid!, 0)).toThrow();
        } finally {
          controller.abort();
          if (descendantPid !== undefined) {
            try {
              process.kill(descendantPid, "SIGKILL");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
                throw error;
              }
            }
          }
          await scan;
        }
      },
    );
  }
}, 15000);

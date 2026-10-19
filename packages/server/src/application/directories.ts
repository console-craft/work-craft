import { constants } from "node:fs";
import { access, lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { ProtocolError } from "../api/protocol.ts";

export type WorktreeRecord = {
  path: string;
  branch: string | null;
  available: boolean;
  reason?: string;
};

export type GitWorktreeRecord = WorktreeRecord & { bare: boolean };

export type DirectoryScan = {
  path: string;
  available: boolean;
  reason?: string;
  git: {
    commonDir: string;
    primary: WorktreeRecord;
    branch: string | null;
    worktrees: WorktreeRecord[];
  } | null;
  discoveryError?: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function realDirectoryPath(path: string): Promise<string> {
  // Bun 1.4.2 realpath treats POSIX backslashes as separators; lstat/readlink do not.
  if (!path.includes("\\")) {
    return realpath(path);
  }
  const parts = path.split("/").filter(Boolean);
  let current = "/";
  let links = 0;
  while (parts.length > 0) {
    const part = parts.shift()!;
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const candidate = join(current, part);
    const info = await lstat(candidate, { bigint: true });
    if (info.isSymbolicLink()) {
      if (++links > 40) {
        throw new Error("Too many symbolic links.");
      }
      const target = await readlink(candidate);
      if (isAbsolute(target)) {
        current = "/";
      }
      // Resolve components in filesystem order: link/.. is not a lexical parent.
      parts.unshift(...target.split("/").filter(Boolean));
      continue;
    }
    if (!info.isDirectory()) {
      throw new ProtocolError("Path must be a directory.", "path");
    }
    const names = await readdir(current);
    let name = names.find((name) => name === part);
    if (name === undefined) {
      for (const entry of names) {
        const candidateInfo = await lstat(join(current, entry), { bigint: true });
        if (candidateInfo.dev === info.dev && candidateInfo.ino === info.ino) {
          name = entry;
          break;
        }
      }
    }
    if (name === undefined) {
      throw new Error("Directory identity changed during canonicalization.");
    }
    current = join(current, name);
  }
  return current;
}

function absolutePath(path: string): string {
  if (
    path.trim() === "" ||
    path.includes("\0") ||
    (path.startsWith("~") && path !== "~" && !path.startsWith("~/"))
  ) {
    throw new ProtocolError("Enter a valid directory path.", "path");
  }
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) {
    throw new ProtocolError("Directory path must be absolute.", "path");
  }
  return normalize(expanded);
}

export async function canonicalDirectoryPath(path: string): Promise<string> {
  const absolute = absolutePath(path);
  try {
    const canonical = await realDirectoryPath(absolute);
    if (!(await stat(canonical)).isDirectory()) {
      throw new ProtocolError("Path must be a directory.", "path");
    }
    await access(canonical, constants.R_OK | constants.X_OK);
    return canonical;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new ProtocolError("Directory does not exist.", "path");
    }
    throw error;
  }
}

/** Porcelain -z fields are raw path bytes, never shell-quoted or line-delimited. */
export function parseWorktrees(output: string): GitWorktreeRecord[] {
  if (!output.endsWith("\0\0")) {
    throw new Error("Malformed Git worktree registry.");
  }
  const records = new Map<string, GitWorktreeRecord>();
  for (const record of output.slice(0, -2).split("\0\0")) {
    const fields = record.split("\0");
    const first = fields.shift()!;
    if (!first.startsWith("worktree ") || !isAbsolute(first.slice(9))) {
      throw new Error("Malformed Git worktree path.");
    }
    const path = normalize(first.slice(9));
    let branch: string | null = null;
    let head: string | undefined;
    let state = false;
    let bare = false;
    let reason: string | undefined;
    const seen = new Set<string>();
    for (const field of fields) {
      const key = field.split(" ", 1)[0]!;
      const reserved = [
        "worktree",
        "HEAD",
        "branch",
        "detached",
        "bare",
        "prunable",
        "locked",
      ].includes(key);
      if (reserved && seen.has(key)) {
        throw new Error("Repeated Git worktree field.");
      }
      seen.add(key);
      if (field.startsWith("HEAD ")) {
        if (!/^[0-9a-f]+$/i.test(field.slice(5))) {
          throw new Error("Malformed Git HEAD.");
        }
        head = field.slice(5);
      } else if (field === "detached" || field === "bare" || field.startsWith("branch ")) {
        if (state || (field.startsWith("branch ") && !field.startsWith("branch refs/heads/"))) {
          throw new Error("Conflicting Git worktree state.");
        }
        state = true;
        bare = field === "bare";
        branch = field.startsWith("branch ") ? field.slice(18) : null;
        if (branch === "") {
          throw new Error("Malformed Git branch.");
        }
      } else if (field === "prunable" || field.startsWith("prunable ")) {
        reason = field.slice(9) || "Worktree is prunable.";
      } else if (field === "locked" || field.startsWith("locked ")) {
        continue;
      } else if (reserved) {
        throw new Error("Repeated or malformed Git structural field.");
      }
    }
    if (!state || (head === undefined && !bare) || (bare && head !== undefined)) {
      throw new Error("Incomplete Git worktree record.");
    }
    if (records.has(path)) {
      throw new Error("Duplicate Git worktree path.");
    }
    const value = {
      path,
      branch,
      bare,
      available: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
    };
    records.set(path, value);
  }
  return [...records.values()];
}

async function runGit(
  path: string,
  args: string[],
  deadline: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (Date.now() >= deadline) {
    throw new Error("Git inspection timed out.");
  }
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_PREFIX",
    "GIT_NAMESPACE",
  ]) {
    delete env[key];
  }
  const child = Bun.spawn(["git", "--no-optional-locks", "-C", path, ...args], {
    env,
    detached: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let failure: Error | undefined;
  let cancellation: Promise<PromiseSettledResult<void>[]> | undefined;
  function stop(message: string): void {
    if (failure !== undefined) {
      return;
    }
    failure = new Error(message);
    // Git helpers can inherit pipes; terminate their owned process group, not just Git.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        failure = new Error(`${message} Could not terminate Git group: ${errorText(error)}`);
      }
    }
    child.kill("SIGKILL");
    cancellation = Promise.allSettled(readers.map((reader) => reader.cancel()));
  }
  const abort = () => stop("Git inspection aborted.");
  const timer = setTimeout(
    () => stop("Git inspection timed out."),
    Math.max(0, deadline - Date.now()),
  );
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.length;
        if (size > 1024 * 1024) {
          stop("Git output exceeded 1 MiB.");
        } else {
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      drain(readers[0]!),
      drain(readers[1]!),
    ]);
    if (failure !== undefined) {
      throw failure;
    }
    if (code !== 0) {
      throw new Error(`Git inspection failed (${code}): ${stderr || "no diagnostic"}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (child.exitCode === null) {
      stop("Git inspection stopped.");
    }
    await child.exited;
    await cancellation;
  }
}

export async function inspectDirectory(path: string, signal?: AbortSignal): Promise<DirectoryScan> {
  const base: DirectoryScan = { path, available: true, git: null };
  try {
    const canonical = await canonicalDirectoryPath(path);
    if (canonical !== normalize(path)) {
      throw new Error("Directory identity changed; register its new target separately.");
    }
  } catch (error) {
    return { ...base, available: false, reason: errorText(error) };
  }
  try {
    await lstat(join(path, ".git"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return base;
    }
    return { ...base, discoveryError: errorText(error) };
  }
  try {
    const deadline = Date.now() + 2000;
    const output = await runGit(path, ["worktree", "list", "--porcelain", "-z"], deadline, signal);
    const records = parseWorktrees(output);
    if (records[0]?.bare) {
      throw new Error("Unsupported Git layout: bare repository has no primary checkout.");
    }
    const common = await runGit(
      path,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      deadline,
      signal,
    );
    const commonPath = common.endsWith("\n") ? common.slice(0, -1) : common;
    if (!isAbsolute(commonPath) || commonPath.includes("\0")) {
      throw new Error("Malformed Git common directory.");
    }
    const commonDir = await realDirectoryPath(commonPath);
    const worktrees: WorktreeRecord[] = [];
    const seen = new Set<string>();
    let primary: WorktreeRecord | undefined;
    let own: WorktreeRecord | undefined;
    for (const { bare, ...record } of records) {
      if (bare) {
        continue;
      }
      let canonical = record.path;
      let available = record.available;
      let reason = record.reason;
      try {
        canonical = await realDirectoryPath(record.path);
        await access(canonical, constants.R_OK | constants.X_OK);
        if (!(await stat(canonical)).isDirectory()) {
          throw new Error("Worktree path is not a directory.");
        }
      } catch (error) {
        available = false;
        reason = errorText(error);
      }
      const value = {
        ...record,
        path: canonical,
        available,
        ...(reason === undefined ? {} : { reason }),
      };
      primary ??= value;
      if (seen.has(canonical)) {
        throw new Error("Duplicate canonical Git worktree path.");
      }
      seen.add(canonical);
      if (canonical === path) {
        own = value;
      } else {
        worktrees.push(value);
      }
    }
    if (own === undefined || primary === undefined) {
      throw new Error("Registered checkout is absent from Git registry.");
    }
    if (primary.path === commonDir) {
      throw new Error(
        "Unsupported Git layout: common metadata directory is not a primary checkout.",
      );
    }
    return { ...base, git: { commonDir, primary, branch: own.branch, worktrees } };
  } catch (error) {
    return { ...base, discoveryError: errorText(error) };
  }
}

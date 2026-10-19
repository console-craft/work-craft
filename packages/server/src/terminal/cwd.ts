import { constants } from "node:fs";
import { access, readlink, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Decode only reversible lsof names; caret notation cannot distinguish literal names. */
export function parseLsofCwd(output: Uint8Array, expectedPid: number): string {
  const bytes = Buffer.from(output);
  const prefix = Buffer.from(`p${expectedPid}\0\nfcwd\0n`);
  if (
    !Number.isSafeInteger(expectedPid) ||
    expectedPid <= 0 ||
    !bytes.subarray(0, prefix.length).equals(prefix) ||
    !bytes.subarray(-2).equals(Buffer.from("\0\n"))
  ) {
    throw new Error("Invalid lsof PID/cwd records");
  }
  const name = bytes.subarray(prefix.length, -2);
  const decoded: number[] = [];
  const escapes: Record<string, number> = { "\\": 92, n: 10, t: 9, r: 13, b: 8, f: 12 };
  for (let index = 0; index < name.length; index += 1) {
    const byte = name[index]!;
    if (byte === 0 || byte === 10) {
      throw new Error("Unexpected lsof cwd field/record");
    }
    if (byte === 94 && /[@-\x5f?]/.test(String.fromCharCode(name[index + 1] ?? 0))) {
      throw new Error("Ambiguous lsof caret escape in cwd");
    }
    if (byte !== 92) {
      decoded.push(byte);
      continue;
    }
    const escape = String.fromCharCode(name[++index] ?? 0);
    if (escape === "x") {
      const hex = name.subarray(index + 1, index + 3).toString("latin1");
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new Error("Invalid lsof hex escape in cwd");
      }
      decoded.push(Number.parseInt(hex, 16));
      index += 2;
    } else if (Object.hasOwn(escapes, escape)) {
      decoded.push(escapes[escape]!);
    } else {
      throw new Error("Unknown lsof escape in cwd");
    }
  }
  const path = utf8.decode(Uint8Array.from(decoded));
  if (!isAbsolute(path) || path.includes("\0") || path.endsWith(" (deleted)")) {
    throw new Error("Invalid or deleted lsof cwd");
  }
  return path;
}

/** Validate a point-in-time split target without normalizing significant path characters. */
export async function validateSplitCwd(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new Error(`Split working directory must be an absolute path without NUL: ${path}`);
  }
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new Error("not a directory");
    }
    await access(path, constants.R_OK | constants.X_OK);
    return path;
  } catch (cause) {
    throw new Error(`Split working directory is unavailable: ${path}`, { cause });
  }
}

async function readLsofCwd(pid: number): Promise<string> {
  const child = Bun.spawn(["/usr/sbin/lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn0"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = child.stdout.getReader();
  const stderr = child.stderr.getReader();
  let size = 0;
  async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return Buffer.concat(chunks);
      }
      size += value.length;
      if (size > 64 * 1024) {
        throw new Error("lsof cwd output exceeds 64 KiB");
      }
      chunks.push(value);
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const output = Promise.all([drain(stdout), drain(stderr), child.exited]);
  try {
    const [out, err, code] = await Promise.race([
      output,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("lsof cwd inspection timed out after one second")),
          1_000,
        );
      }),
    ]);
    if (code !== 0) {
      throw new Error(`lsof cwd inspection failed (${code}): ${utf8.decode(err)}`);
    }
    return parseLsofCwd(out, pid);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await Promise.allSettled([stdout.cancel(), stderr.cancel(), child.exited, output]);
  }
}

/** Inspect only the PID owned by the runtime, never a foreground/background descendant. */
export async function readProcessCwd(pid: number): Promise<string> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid cwd process PID: ${pid}`);
  }
  try {
    if (process.platform === "linux") {
      const path = utf8.decode(await readlink(`/proc/${pid}/cwd`, { encoding: "buffer" }));
      if (path.endsWith(" (deleted)")) {
        throw new Error("Process cwd was deleted");
      }
      return path;
    }
    if (process.platform === "darwin") {
      return await readLsofCwd(pid);
    }
    throw new Error(`Unsupported cwd inspection platform: ${process.platform}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Cannot inspect cwd for process ${pid}: ${message}`, { cause });
  }
}

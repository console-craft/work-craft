import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** A growing diagnostic log must not become an unbounded observer allocation. */
export async function readProfileFooter(path: string, afterBytes: number): Promise<boolean> {
  const file = await open(path, "r").catch(() => null);
  if (!file) {
    return false;
  }
  try {
    const size = (await file.stat()).size;
    if (size <= afterBytes) {
      return false;
    }
    const tail = new Uint8Array(Math.min(65536, size));
    const { bytesRead } = await file.read(tail, 0, tail.byteLength, size - tail.byteLength);
    const line = new TextDecoder().decode(tail.subarray(0, bytesRead)).trimEnd().split("\n").at(-1);
    return line !== undefined && JSON.parse(line).type === "summary";
  } catch {
    return false;
  } finally {
    await file.close();
  }
}

/** Flush only manifests belonging to the current fixture roots, never arbitrary PIDs. */
export async function flushProfileProbes(directory: string, roots: number[]): Promise<void> {
  if (roots.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) {
    throw new Error("Invalid owned root PID for diagnostic flush");
  }
  const processes = Bun.spawnSync(["ps", "-axo", "pid=,ppid="]);
  if (!processes.success) {
    throw new Error("Cannot establish diagnostic PID ownership");
  }
  const rows = processes.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const owned = new Set(roots);
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size;
    for (const [pid, parent] of rows) {
      if (owned.has(parent!)) {
        owned.add(pid!);
      }
    }
  }
  const entries = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".manifest.json"))
      .map(async (name) => ({
        name,
        ...JSON.parse(await readFile(join(directory, name), "utf8")),
      })),
  );
  const selected = entries.filter((entry) => owned.has(entry.pid));
  const sizes = new Map<string, number>();
  for (const entry of selected) {
    const path = join(directory, entry.name.replace(".manifest.json", ".jsonl"));
    sizes.set(
      path,
      await stat(path)
        .then((result) => result.size)
        .catch(() => 0),
    );
  }
  for (const pid of new Set<number>(selected.map((entry) => entry.pid))) {
    process.kill(pid, "SIGUSR2");
  }
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    let done = true;
    for (const [path, before] of sizes) {
      if (!(await readProfileFooter(path, before))) {
        done = false;
      }
    }
    if (done) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("Owned diagnostic flush did not complete");
}

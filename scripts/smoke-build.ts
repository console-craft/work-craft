import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "../packages/server/src/client.ts";

const root = resolve(import.meta.dir, "..");
const executable = join(root, "dist", "work-craft");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "work-craft-build-"));
const installDirectory = join(temporaryDirectory, "install");
const installedExecutable = join(installDirectory, "work-craft");
const home = join(temporaryDirectory, "state");
const socketPath = join(home, "work-craft.sock");
const connectedColor = "38;2;34;197;94m";

await mkdir(installDirectory);
await copyFile(executable, installedExecutable);
await chmod(installedExecutable, 0o755);

async function run(args: string[]): Promise<string> {
  const child = Bun.spawn([installedExecutable, ...args], {
    cwd: installDirectory,
    env: { ...process.env, WORK_CRAFT_HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited.finally(() => clearTimeout(timeout)),
  ]);
  if (timedOut) {
    throw new Error(`${args.join(" ")} timed out`);
  }
  if (exitCode !== 0) {
    throw new Error(`${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  }
  return stdout;
}

async function smokeTui(): Promise<void> {
  let output = "";
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data: (_terminal, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const child = Bun.spawn([installedExecutable], {
    cwd: installDirectory,
    detached: true,
    env: { ...process.env, WORK_CRAFT_HOME: home },
    terminal,
  });

  try {
    const deadline = Date.now() + 3_000;
    while (!output.includes(connectedColor) && child.exitCode === null && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    if (!output.includes(connectedColor)) {
      throw new Error(`compiled TUI did not connect: ${output.trim()}`);
    }
  } finally {
    if (child.exitCode === null) {
      terminal.write(Uint8Array.of(3));
      await Promise.race([child.exited, Bun.sleep(500)]);
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The TUI and its process group already exited.
    }
    await child.exited;
    terminal.close();
  }
}

async function waitForSocketRemoval(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (existsSync(socketPath) && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  if (existsSync(socketPath)) {
    throw new Error("compiled daemon did not remove its socket after stopping");
  }
}

try {
  const status = JSON.parse(await run(["daemon", "status", "--json"])) as { running?: unknown };
  if (status.running !== true) {
    throw new Error("compiled status did not report a running daemon");
  }
  await smokeTui();
  await run(["daemon", "stop", "--json"]);
  await waitForSocketRemoval();
} finally {
  if (existsSync(socketPath)) {
    try {
      await createClient({ socketPath }).command({ type: "daemon.stop" });
      await waitForSocketRemoval();
    } catch {
      // Preserve the smoke-test failure; temporary state is removed below.
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Bounded invocation of the supplied preview, never an installed PATH command. */
export async function runPreview(
  executable: string,
  home: string,
  args: string[],
  cwd = dirname(executable),
): Promise<void> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env: { ...process.env, WORK_CRAFT_HOME: home, SHELL: "/bin/sh" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  const [code, , stderr] = await Promise.all([
    child.exited.finally(() => clearTimeout(timer)),
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`Preview ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
}

export async function stopPreview(executable: string, home: string): Promise<void> {
  if (!existsSync(join(home, "work-craft.sock"))) {
    return;
  }
  await runPreview(executable, home, ["daemon", "stop", "--json"]);
  const deadline = Date.now() + 4000;
  while (existsSync(join(home, "work-craft.sock")) || existsSync(join(home, "daemon.lock"))) {
    if (Date.now() >= deadline) {
      throw new Error(`Preview shutdown not confirmed; preserved ${home}`);
    }
    await Bun.sleep(10);
  }
}

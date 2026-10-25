import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertTerminalProtocol } from "../api/identity";
import type { Health } from "../application/app.ts";
import { requestJson } from "./http.ts";

export const INTERNAL_DAEMON_ARG = "__daemon";
export const INTERNAL_DESTROY_DAEMON_ARG = "__daemon-destroy";

function healthSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(250, deadline - Date.now())));
}

async function requestHealth(socketPath: string, deadline: number): Promise<Health> {
  const health = (await requestJson(socketPath, "/health", {
    signal: healthSignal(deadline),
  })) as Health;
  assertTerminalProtocol(health.protocol);
  return health;
}

function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function spawnDaemon(recover: boolean): { child: Bun.Subprocess; stderrPath: string } {
  const stderrPath = join(tmpdir(), `work-craft-startup-${crypto.randomUUID()}.log`);
  const stderr = openSync(stderrPath, "wx", 0o600);
  try {
    const daemonArg = recover ? INTERNAL_DAEMON_ARG : INTERNAL_DESTROY_DAEMON_ARG;
    const command = Bun.main.startsWith("/$bunfs/")
      ? [process.execPath, daemonArg]
      : [
          process.execPath,
          fileURLToPath(new URL("../main.ts", import.meta.url)),
          ...(recover ? [] : [daemonArg]),
        ];
    const child = Bun.spawn(command, {
      detached: true,
      env: process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr,
    });
    child.unref();
    return { child, stderrPath };
  } catch (error) {
    rmSync(stderrPath, { force: true });
    throw error;
  } finally {
    closeSync(stderr);
  }
}

export async function ensureDaemon(
  socketPath: string,
  options: { recover?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + 3_000;
  try {
    await requestHealth(socketPath, deadline);
    return;
  } catch (error) {
    if (!isConnectionFailure(error)) {
      throw error;
    }
  }

  let delay = 20;
  let lastFailure = "daemon did not start";
  while (Date.now() < deadline) {
    const { child, stderrPath } = spawnDaemon(options.recover !== false);
    while (Date.now() < deadline) {
      try {
        const health = await requestHealth(socketPath, deadline);
        if (health.pid !== child.pid && child.exitCode === null) {
          await Promise.race([
            child.exited,
            Bun.sleep(Math.min(20, Math.max(0, deadline - Date.now()))),
          ]);
          if (child.exitCode === null) {
            continue;
          }
        }
        rmSync(stderrPath, { force: true });
        return;
      } catch {
        if (child.exitCode !== null) {
          break;
        }
        await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
        delay = Math.min(delay * 2, 200);
      }
    }
    if (child.exitCode === null && options.recover === false) {
      child.kill("SIGTERM");
      await Promise.race([child.exited, Bun.sleep(500)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    const output = readFileSync(stderrPath, "utf8").trim();
    rmSync(stderrPath, { force: true });
    const status =
      child.exitCode === null ? `PID ${child.pid} is still running` : `exit ${child.exitCode}`;
    lastFailure = `${status}${output === "" ? "" : `: ${output}`}`;
    await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`Work Craft daemon did not become healthy within 3 seconds (${lastFailure})`);
}

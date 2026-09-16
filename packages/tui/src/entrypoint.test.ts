import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@work-craft/server/client";

const ROOT = resolve(import.meta.dir, "../../..");

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(20);
  }
  if (!predicate()) {
    throw new Error(`Timed out waiting for ${message}`);
  }
}

async function stopProcessGroup(child: Bun.Subprocess, terminal: Bun.Terminal): Promise<void> {
  if (child.exitCode === null) {
    terminal.write(Uint8Array.of(3));
    await Promise.race([child.exited, Bun.sleep(500)]);
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The command and all of its children exited from Ctrl-C.
  }
  await child.exited;
}

test("the root TUI command preserves interactive terminal input", async () => {
  const home = await mkdtemp(join(tmpdir(), "work-craft-tui-"));
  const socketPath = join(home, "work-craft.sock");
  let output = "";
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data: (_terminal, bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  });
  const child = Bun.spawn([process.execPath, "run", "tui"], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, WORK_CRAFT_HOME: home },
    terminal,
  });

  try {
    await waitFor(() => output.includes("connected"), "the TUI to connect");
    terminal.write(new TextEncoder().encode("s"));
    await waitFor(() => output.includes("New session"), "the session prompt");
    expect(output).toContain("New session");
  } finally {
    await stopProcessGroup(child, terminal);
    terminal.close();
    if (existsSync(socketPath)) {
      try {
        await createClient({ socketPath }).command({ type: "daemon.stop" });
        await waitFor(() => !existsSync(socketPath), "the daemon to stop");
      } catch {
        // The daemon may already be exiting with the TUI process.
      }
    }
    await rm(home, { recursive: true, force: true });
  }
});

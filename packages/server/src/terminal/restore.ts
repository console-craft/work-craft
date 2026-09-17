import { existsSync, statSync } from "node:fs";
import type { Snapshot } from "../api/protocol.ts";

export type SpawnSpec = {
  cmd: string[];
  cwd: string;
  env: Record<string, string | undefined>;
};

export type RuntimePane = Pick<Snapshot["panes"][number], "id" | "cwd" | "restorePolicy">;

export function resolveShellSpawn(pane: RuntimePane): SpawnSpec {
  if (!existsSync(pane.cwd)) {
    throw new Error(`Working directory does not exist: ${pane.cwd}`);
  }
  if (!statSync(pane.cwd).isDirectory()) {
    throw new Error(`Working directory is not a directory: ${pane.cwd}`);
  }
  if (Bun.which(pane.restorePolicy.executable, { cwd: pane.cwd }) === null) {
    throw new Error(`Shell executable not found: ${pane.restorePolicy.executable}`);
  }

  return {
    cmd: [pane.restorePolicy.executable, ...pane.restorePolicy.args],
    cwd: pane.cwd,
    env: { ...process.env, TERM: "xterm-256color" },
  };
}

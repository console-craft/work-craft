import { homedir } from "node:os";
import { join } from "node:path";

export type WorkCraftPaths = {
  stateDir: string;
  databasePath: string;
  socketPath: string;
  lockPath: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): WorkCraftPaths {
  const stateDir =
    env.WORK_CRAFT_HOME ??
    join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "work-craft");
  return {
    stateDir,
    databasePath: join(stateDir, "work-craft.sqlite"),
    socketPath: join(stateDir, "work-craft.sock"),
    lockPath: join(stateDir, "daemon.lock"),
  };
}

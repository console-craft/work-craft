import { homedir } from "node:os";
import { join } from "node:path";

export function configurePreviewEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of ["OTUI_ASSET_ROOT", "OPENTUI_LIBC", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD"]) {
    if (env[name]) {
      throw new Error(`Native asset override ${name} is not allowed in the stock preview`);
    }
  }
  env.WORK_CRAFT_HOME ??= join(
    env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "work-craft-preview",
  );
}

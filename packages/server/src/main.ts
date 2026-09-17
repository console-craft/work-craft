import { runDaemon } from "./daemon/lifecycle.ts";
import { resolvePaths } from "./daemon/paths.ts";

try {
  await runDaemon(resolvePaths());
} catch (error) {
  console.error(
    `Failed to start Work Craft daemon: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}

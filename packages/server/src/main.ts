import { runDaemon } from "./daemon/lifecycle.ts";
import { resolvePaths } from "./daemon/paths.ts";
import { INTERNAL_DESTROY_DAEMON_ARG } from "./client.ts";

try {
  await runDaemon(resolvePaths(), {
    recover: !process.argv.slice(2).includes(INTERNAL_DESTROY_DAEMON_ARG),
  });
} catch (error) {
  console.error(
    `Failed to start Work Craft daemon: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}

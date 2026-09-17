import { INTERNAL_DAEMON_ARG, INTERNAL_DESTROY_DAEMON_ARG } from "../packages/server/src/client.ts";

const [command] = process.argv.slice(2);

if (command === INTERNAL_DAEMON_ARG || command === INTERNAL_DESTROY_DAEMON_ARG) {
  await import("../packages/server/src/main.ts");
} else if (command === undefined) {
  await import("../packages/tui/src/main.tsx");
} else {
  await import("../packages/cli/src/main.ts");
}

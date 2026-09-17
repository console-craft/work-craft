export type CliArgs =
  | { command: "list" | "status" | "stop" | "destroy"; json: boolean }
  | { command: "ensure"; itemId: string; cwd?: string; json: boolean };

export const USAGE = `Usage:
  work-craft list [--json]
  work-craft ensure <item-id> [--cwd <path>] [--json]
  work-craft status [--json]
  work-craft stop [--json]
  work-craft destroy [--json]
`;

export class UsageError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ...values] = argv;
  if (command === "list" || command === "status" || command === "stop" || command === "destroy") {
    if (values.length === 0) {
      return { command, json: false };
    }
    if (values.length === 1 && values[0] === "--json") {
      return { command, json: true };
    }
    throw new UsageError("invalid arguments");
  }
  if (command !== "ensure" || values[0] === undefined || values[0].startsWith("--")) {
    throw new UsageError("invalid arguments");
  }

  let cwd: string | undefined;
  let json = false;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json" && !json) {
      json = true;
    } else if (value === "--cwd" && cwd === undefined) {
      const path = values[++index];
      if (path === undefined || path.startsWith("--")) {
        throw new UsageError("invalid arguments");
      }
      cwd = path;
    } else {
      throw new UsageError("invalid arguments");
    }
  }
  return { command, itemId: values[0], ...(cwd === undefined ? {} : { cwd }), json };
}

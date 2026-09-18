import { parseArgs as parseNodeArgs } from "node:util";
import type { CategoryKind } from "@work-craft/server/client";

type OutputArgs = { json: boolean };

export type CliArgs =
  | (OutputArgs & { command: "snapshot" })
  | (OutputArgs & { command: "session.create"; name: string })
  | (OutputArgs & {
      command: "session.update";
      sessionId: string;
      name?: string;
      position?: number;
    })
  | (OutputArgs & { command: "session.delete"; sessionId: string })
  | (OutputArgs & {
      command: "session.workspace.add" | "session.workspace.remove";
      sessionId: string;
      workspaceId: string;
    })
  | (OutputArgs & { command: "workspace.create"; sessionId: string; name: string })
  | (OutputArgs & {
      command: "project.create";
      workspaceId: string;
      category: CategoryKind;
      name: string;
    })
  | (OutputArgs & {
      command: "item.create";
      projectId: string;
      kind: "generic" | "surface";
      title: string;
      data?: Record<string, unknown>;
    })
  | (OutputArgs & {
      command: "surface.ensure";
      itemId: string;
      projectId?: never;
      cwd?: string;
    })
  | (OutputArgs & {
      command: "surface.ensure";
      itemId?: never;
      projectId: string;
      cwd?: string;
    })
  | (OutputArgs & { command: "surface.selectTab"; surfaceId: string; tabId: string })
  | (OutputArgs & { command: "tab.create"; surfaceId: string; title: string })
  | (OutputArgs & {
      command: "pane.split";
      paneId: string;
      direction: "horizontal" | "vertical";
      cwd?: string;
    })
  | (OutputArgs & { command: "process.restart"; paneId: string })
  | (OutputArgs & { command: "daemon.status" | "daemon.stop" })
  | (OutputArgs & { command: "daemon.destroy" });

export const USAGE = `Usage:
  work-craft snapshot [--json]

  work-craft session create --name <name> [--json]
  work-craft session update <id> [--name <name>] [--position <index>] [--json]
  work-craft session delete <id> [--json]
  work-craft session add-workspace <id> --workspace <id> [--json]
  work-craft session remove-workspace <id> --workspace <id> [--json]
  work-craft workspace create --session <id> --name <name> [--json]
  work-craft project create --workspace <id> --category <kind> --name <name> [--json]
  work-craft item create --project <id> --kind <generic|surface> --title <title>
                         [--data <json-object>] [--json]

  work-craft surface ensure (--item <id> | --project <id>)
                            [--cwd <path>] [--json]
  work-craft surface select-tab <surface-id> <tab-id> [--json]

  work-craft tab create --surface <id> --title <title> [--json]

  work-craft pane split <pane-id> --direction <horizontal|vertical>
                        [--cwd <path>] [--json]
  work-craft pane restart <pane-id> [--json]

  work-craft daemon status [--json]
  work-craft daemon stop [--json]
  work-craft daemon destroy --force [--json]

Project categories: inbox, today, design, implementation, collaboration, operations
`;

export class UsageError extends Error {}

type OptionConfig = Record<string, { type: "boolean" | "string" }>;

function rejectDuplicateOptions(tokens: readonly { kind: string; name?: string }[]): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || token.name === undefined) {
      continue;
    }
    if (seen.has(token.name)) {
      throw new UsageError(`duplicate option: --${token.name}`);
    }
    seen.add(token.name);
  }
}

function parseLeaf<const Options extends OptionConfig>(args: string[], options: Options) {
  let parsed;
  try {
    parsed = parseNodeArgs({ args, options, strict: true, allowPositionals: true, tokens: true });
  } catch {
    throw new UsageError("invalid arguments");
  }
  rejectDuplicateOptions(parsed.tokens);
  return parsed;
}

function required(value: string | boolean | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError("invalid arguments");
  }
  return value;
}

function positionValue(value: string | boolean | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const position = Number(required(value));
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new UsageError("invalid arguments");
  }
  return position;
}

function noPositionals(positionals: string[]): void {
  if (positionals.length !== 0) {
    throw new UsageError("invalid arguments");
  }
}

function jsonData(value: string | boolean | undefined): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const data: unknown = JSON.parse(required(value));
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new UsageError("invalid arguments");
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    throw new UsageError("invalid arguments");
  }
}

const outputOption = { json: { type: "boolean" } } as const;
const categories = new Set<CategoryKind>([
  "inbox",
  "today",
  "design",
  "implementation",
  "collaboration",
  "operations",
]);

export function parseArgs(argv: string[]): CliArgs {
  if (argv[0] === "snapshot") {
    const { values, positionals } = parseLeaf(argv.slice(1), outputOption);
    noPositionals(positionals);
    return { command: "snapshot", json: values.json ?? false };
  }

  const command = `${argv[0] ?? ""}.${argv[1] ?? ""}`;
  const args = argv.slice(2);
  switch (command) {
    case "session.create": {
      const { values, positionals } = parseLeaf(args, {
        name: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      return { command, name: required(values.name), json: values.json ?? false };
    }
    case "session.update": {
      const { values, positionals } = parseLeaf(args, {
        name: { type: "string" },
        position: { type: "string" },
        ...outputOption,
      });
      if (
        positionals.length !== 1 ||
        (values.name === undefined && values.position === undefined)
      ) {
        throw new UsageError("invalid arguments");
      }
      const position = positionValue(values.position);
      return {
        command,
        sessionId: required(positionals[0]),
        ...(values.name === undefined ? {} : { name: required(values.name) }),
        ...(position === undefined ? {} : { position }),
        json: values.json ?? false,
      };
    }
    case "session.delete": {
      const { values, positionals } = parseLeaf(args, outputOption);
      if (positionals.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      return {
        command,
        sessionId: required(positionals[0]),
        json: values.json ?? false,
      };
    }
    case "session.add-workspace":
    case "session.remove-workspace": {
      const { values, positionals } = parseLeaf(args, {
        workspace: { type: "string" },
        ...outputOption,
      });
      if (positionals.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      return {
        command:
          command === "session.add-workspace"
            ? "session.workspace.add"
            : "session.workspace.remove",
        sessionId: required(positionals[0]),
        workspaceId: required(values.workspace),
        json: values.json ?? false,
      };
    }
    case "workspace.create": {
      const { values, positionals } = parseLeaf(args, {
        session: { type: "string" },
        name: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      return {
        command,
        sessionId: required(values.session),
        name: required(values.name),
        json: values.json ?? false,
      };
    }
    case "project.create": {
      const { values, positionals } = parseLeaf(args, {
        workspace: { type: "string" },
        category: { type: "string" },
        name: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      const category = required(values.category);
      if (!categories.has(category as CategoryKind)) {
        throw new UsageError("invalid arguments");
      }
      return {
        command,
        workspaceId: required(values.workspace),
        category: category as CategoryKind,
        name: required(values.name),
        json: values.json ?? false,
      };
    }
    case "item.create": {
      const { values, positionals } = parseLeaf(args, {
        project: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        data: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      if (values.kind !== "generic" && values.kind !== "surface") {
        throw new UsageError("invalid arguments");
      }
      const data = jsonData(values.data);
      return {
        command,
        projectId: required(values.project),
        kind: values.kind,
        title: required(values.title),
        ...(data === undefined ? {} : { data }),
        json: values.json ?? false,
      };
    }
    case "surface.ensure": {
      const { values, positionals } = parseLeaf(args, {
        item: { type: "string" },
        project: { type: "string" },
        cwd: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      if ((values.item === undefined) === (values.project === undefined)) {
        throw new UsageError("invalid arguments");
      }
      const target =
        values.item === undefined
          ? { projectId: required(values.project) }
          : { itemId: required(values.item) };
      return {
        command,
        ...target,
        ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
        json: values.json ?? false,
      };
    }
    case "surface.select-tab": {
      const { values, positionals } = parseLeaf(args, outputOption);
      if (positionals.length !== 2) {
        throw new UsageError("invalid arguments");
      }
      return {
        command: "surface.selectTab",
        surfaceId: required(positionals[0]),
        tabId: required(positionals[1]),
        json: values.json ?? false,
      };
    }
    case "tab.create": {
      const { values, positionals } = parseLeaf(args, {
        surface: { type: "string" },
        title: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      return {
        command,
        surfaceId: required(values.surface),
        title: required(values.title),
        json: values.json ?? false,
      };
    }
    case "pane.split": {
      const { values, positionals } = parseLeaf(args, {
        direction: { type: "string" },
        cwd: { type: "string" },
        ...outputOption,
      });
      if (
        positionals.length !== 1 ||
        (values.direction !== "horizontal" && values.direction !== "vertical")
      ) {
        throw new UsageError("invalid arguments");
      }
      return {
        command,
        paneId: required(positionals[0]),
        direction: values.direction,
        ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
        json: values.json ?? false,
      };
    }
    case "pane.restart": {
      const { values, positionals } = parseLeaf(args, outputOption);
      if (positionals.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      return {
        command: "process.restart",
        paneId: required(positionals[0]),
        json: values.json ?? false,
      };
    }
    case "daemon.status":
    case "daemon.stop": {
      const { values, positionals } = parseLeaf(args, outputOption);
      noPositionals(positionals);
      return { command, json: values.json ?? false };
    }
    case "daemon.destroy": {
      const { values, positionals } = parseLeaf(args, {
        force: { type: "boolean" },
        ...outputOption,
      });
      noPositionals(positionals);
      if (values.force !== true) {
        throw new UsageError("invalid arguments");
      }
      return { command, json: values.json ?? false };
    }
    default:
      throw new UsageError("invalid arguments");
  }
}

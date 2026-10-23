import { parseArgs as parseNodeArgs } from "node:util";

import type { CategoryKind, NavigationTarget } from "@work-craft/server/client";

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
  | (OutputArgs & { command: "session.navigate"; sessionId: string; target: NavigationTarget })
  | (OutputArgs & {
      command: "session.step";
      sessionId: string;
      level: "category" | "item" | "tab";
      direction: -1 | 1;
    })
  | (OutputArgs & { command: "session.openItem"; sessionId: string; itemId: string; cwd?: string })
  | (OutputArgs & {
      command: "session.workspace.add" | "session.workspace.remove";
      sessionId: string;
      workspaceId: string;
    })
  | (OutputArgs & { command: "workspace.create"; sessionId: string; name: string })
  | (OutputArgs & {
      command: "directory.register";
      workspaceId: string;
      path: string;
    })
  | (OutputArgs & {
      command: "item.create";
      workspaceId: string;
      category: CategoryKind;
      parentId?: string;
      title: string;
      data?: Record<string, unknown>;
    })
  | (OutputArgs & {
      command: "surface.ensure";
      itemId: string;
      cwd?: string;
    })
  | (OutputArgs & { command: "item.setArchived"; itemId: string; archived: boolean })
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
  work-craft session select <session-id> --workspace <id>|--category <kind>|--item <id>|--tab <id>|--pane <id> [--json]
  work-craft session step <session-id> --level <category|item|tab> --direction <previous|next> [--json]
  work-craft session open-item <session-id> --item <id> [--cwd <path>] [--json]
  work-craft session add-workspace <id> --workspace <id> [--json]
  work-craft session remove-workspace <id> --workspace <id> [--json]
  work-craft workspace create --session <id> --name <name> [--json]
  work-craft directory register --workspace <id> --path <path> [--json]
  work-craft item create --workspace <id> --category <kind> [--parent <id>] --title <title>
                          [--data <json-object>] [--json]
  work-craft item archive <id> [--json]
  work-craft item restore <id> [--json]

  work-craft surface ensure --item <id>
                            [--cwd <path>] [--json]

  work-craft tab create --surface <id> --title <title> [--json]

  work-craft pane split <pane-id> --direction <horizontal|vertical>
                        [--cwd <path>] [--json]
  work-craft pane restart <pane-id> [--json]

  work-craft daemon status [--json]
  work-craft daemon stop [--json]
  work-craft daemon destroy --force [--json]

Generic categories: inbox, today, design, collaboration, operations
`;

export class UsageError extends Error {}
export class RemovedCommandError extends UsageError {}

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
    case "session.select": {
      const { values, positionals } = parseLeaf(args, {
        workspace: { type: "string" },
        category: { type: "string" },
        item: { type: "string" },
        tab: { type: "string" },
        pane: { type: "string" },
        ...outputOption,
      });
      const targets = ["workspace", "category", "item", "tab", "pane"] as const;
      const selected = targets.filter((key) => values[key] !== undefined);
      if (positionals.length !== 1 || selected.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      const kind = selected[0]!;
      const value = required(values[kind]);
      let target: NavigationTarget;
      switch (kind) {
        case "workspace":
          target = { kind, workspaceId: value };
          break;
        case "category":
          if (!categories.has(value as CategoryKind)) {
            throw new UsageError("invalid arguments");
          }
          target = { kind, category: value as CategoryKind };
          break;
        case "item":
          target = { kind, itemId: value };
          break;
        case "tab":
          target = { kind, tabId: value };
          break;
        case "pane":
          target = { kind, paneId: value };
          break;
      }
      return {
        command: "session.navigate",
        sessionId: required(positionals[0]),
        target,
        json: values.json ?? false,
      };
    }
    case "session.step": {
      const { values, positionals } = parseLeaf(args, {
        level: { type: "string" },
        direction: { type: "string" },
        ...outputOption,
      });
      if (
        positionals.length !== 1 ||
        (values.level !== "category" && values.level !== "item" && values.level !== "tab") ||
        (values.direction !== "previous" && values.direction !== "next")
      ) {
        throw new UsageError("invalid arguments");
      }
      return {
        command,
        sessionId: required(positionals[0]),
        level: values.level,
        direction: values.direction === "previous" ? -1 : 1,
        json: values.json ?? false,
      };
    }
    case "session.open-item": {
      const { values, positionals } = parseLeaf(args, {
        item: { type: "string" },
        cwd: { type: "string" },
        ...outputOption,
      });
      if (positionals.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      return {
        command: "session.openItem",
        sessionId: required(positionals[0]),
        itemId: required(values.item),
        ...(values.cwd === undefined ? {} : { cwd: required(values.cwd) }),
        json: values.json ?? false,
      };
    }
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
    case "directory.register": {
      const { values, positionals } = parseLeaf(args, {
        workspace: { type: "string" },
        path: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      return {
        command,
        workspaceId: required(values.workspace),
        path: required(values.path),
        json: values.json ?? false,
      };
    }
    case "item.create": {
      const { values, positionals } = parseLeaf(args, {
        workspace: { type: "string" },
        category: { type: "string" },
        parent: { type: "string" },
        title: { type: "string" },
        data: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      const category = required(values.category);
      if (category === "implementation" || !categories.has(category as CategoryKind)) {
        throw new UsageError("invalid arguments");
      }
      const data = jsonData(values.data);
      return {
        command,
        workspaceId: required(values.workspace),
        category: category as CategoryKind,
        ...(values.parent === undefined ? {} : { parentId: required(values.parent) }),
        title: required(values.title),
        ...(data === undefined ? {} : { data }),
        json: values.json ?? false,
      };
    }
    case "item.archive":
    case "item.restore": {
      const { values, positionals } = parseLeaf(args, outputOption);
      if (positionals.length !== 1) {
        throw new UsageError("invalid arguments");
      }
      return {
        command: "item.setArchived",
        itemId: required(positionals[0]),
        archived: command === "item.archive",
        json: values.json ?? false,
      };
    }
    case "surface.ensure": {
      const { values, positionals } = parseLeaf(args, {
        item: { type: "string" },
        cwd: { type: "string" },
        ...outputOption,
      });
      noPositionals(positionals);
      return {
        command,
        itemId: required(values.item),
        ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
        json: values.json ?? false,
      };
    }
    case "surface.select-tab":
      throw new RemovedCommandError(
        "surface select-tab was removed; use session select <session-id> --tab <id>",
      );
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

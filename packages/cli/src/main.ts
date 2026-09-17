#!/usr/bin/env bun

import { createClient, resolvePaths, type Command } from "@work-craft/server/client";
import { parseArgs, USAGE, UsageError, type CliArgs } from "./args.ts";
import { formatResult, formatSnapshot, formatStatus, readStatus } from "./format.ts";

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function waitForDestroyed(): Promise<void> {
  const paths = resolvePaths();
  const files = [
    paths.databasePath,
    `${paths.databasePath}-wal`,
    `${paths.databasePath}-shm`,
    paths.lockPath,
    paths.socketPath,
  ];
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!(await Promise.all(files.map((path) => Bun.file(path).exists()))).some(Boolean)) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error("Work Craft destroy completion could not be confirmed within 3 seconds");
}

function serverCommand(args: CliArgs): Command | undefined {
  switch (args.command) {
    case "snapshot":
    case "daemon.status":
      return undefined;
    case "session.create":
      return { type: "session.create", name: args.name };
    case "workspace.create":
      return { type: "workspace.create", sessionId: args.sessionId, name: args.name };
    case "project.create":
      return {
        type: "project.create",
        workspaceId: args.workspaceId,
        category: args.category,
        name: args.name,
      };
    case "item.create":
      return {
        type: "item.create",
        projectId: args.projectId,
        kind: args.kind,
        title: args.title,
        ...(args.data === undefined ? {} : { data: args.data }),
      };
    case "surface.ensure":
      return args.itemId === undefined
        ? {
            type: "surface.ensureHere",
            projectId: args.projectId,
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          }
        : {
            type: "surface.ensure",
            itemId: args.itemId,
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          };
    case "surface.selectTab":
      return {
        type: "surface.selectTab",
        surfaceId: args.surfaceId,
        tabId: args.tabId,
      };
    case "tab.create":
      return { type: "tab.create", surfaceId: args.surfaceId, title: args.title };
    case "pane.split":
      return {
        type: "pane.split",
        paneId: args.paneId,
        direction: args.direction,
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      };
    case "process.restart":
      return { type: "process.restart", paneId: args.paneId };
    case "daemon.stop":
      return { type: "daemon.stop" };
    case "daemon.destroy":
      return { type: "daemon.destroy" };
  }
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(USAGE);
      return 2;
    }
    throw error;
  }

  try {
    const client = createClient();
    await client.ensureDaemon({ recover: args.command !== "daemon.destroy" });

    if (args.command === "snapshot") {
      const snapshot = await client.snapshot();
      if (args.json) {
        printJson(snapshot);
      } else {
        process.stdout.write(formatSnapshot(snapshot));
      }
    } else if (args.command === "daemon.status") {
      const status = await readStatus(client);
      if (args.json) {
        printJson(status);
      } else {
        process.stdout.write(formatStatus(status));
      }
    } else {
      const response = await client.command(serverCommand(args)!);
      if (args.command === "daemon.destroy") {
        await waitForDestroyed();
      }
      if (response.result.paneId !== undefined) {
        const pane = (await client.snapshot()).panes.find(
          ({ id }) => id === response.result.paneId,
        );
        if (pane?.processStatus === "failed") {
          throw new Error(pane.errorText ?? `Pane runtime failed: ${pane.id}`);
        }
      }
      if (args.json) {
        printJson(response.result);
      } else {
        process.stdout.write(formatResult(args.command, response.result));
      }
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

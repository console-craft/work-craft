#!/usr/bin/env bun

import { createClient, resolvePaths } from "@work-craft/server/client";
import { parseArgs, USAGE, UsageError } from "./args.ts";
import { formatList, formatStatus, readStatus } from "./format.ts";

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

async function main(argv: string[]): Promise<number> {
  let args;
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
    await client.ensureDaemon({ recover: args.command !== "destroy" });
    if (args.command === "list") {
      const snapshot = await client.snapshot();
      if (args.json) {
        printJson(snapshot);
      } else {
        process.stdout.write(formatList(snapshot));
      }
    } else if (args.command === "ensure") {
      const response = await client.command({
        type: "surface.ensure",
        itemId: args.itemId,
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      });
      if (args.json) {
        printJson(response.result);
      } else {
        const surfaceId = response.result.surfaceId;
        const paneId =
          response.result.paneId ??
          (await client.snapshot()).panes
            .filter((pane) => pane.surfaceId === surfaceId)
            .map((pane) => pane.id)
            .sort()[0];
        if (surfaceId === undefined || paneId === undefined) {
          throw new Error("ensure result did not include a surface and pane");
        }
        process.stdout.write(`Surface: ${surfaceId}\nPane: ${paneId}\n`);
      }
    } else if (args.command === "status") {
      const status = await readStatus(client);
      if (args.json) {
        printJson(status);
      } else {
        process.stdout.write(formatStatus(status));
      }
    } else if (args.command === "stop") {
      const response = await client.command({ type: "daemon.stop" });
      if (args.json) {
        printJson(response.result);
      } else {
        process.stdout.write("Stopped Work Craft\n");
      }
    } else {
      const response = await client.command({ type: "daemon.destroy" });
      await waitForDestroyed();
      if (args.json) {
        printJson(response.result);
      } else {
        process.stdout.write("Destroyed Work Craft\n");
      }
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

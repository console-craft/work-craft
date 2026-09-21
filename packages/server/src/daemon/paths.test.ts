import { expect, test } from "bun:test";

import { resolvePaths } from "./paths.ts";

test("uses WORK_CRAFT_HOME for every durable runtime path", () => {
  expect(resolvePaths({ WORK_CRAFT_HOME: "/tmp/work-craft-test" })).toEqual({
    stateDir: "/tmp/work-craft-test",
    databasePath: "/tmp/work-craft-test/work-craft.sqlite",
    socketPath: "/tmp/work-craft-test/work-craft.sock",
    lockPath: "/tmp/work-craft-test/daemon.lock",
  });
});

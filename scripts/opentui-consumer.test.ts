import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

test("TUI server fixtures and React resolve one pinned OpenTUI core", () => {
  const tui = createRequire(resolve(import.meta.dir, "../packages/tui/package.json"));
  const server = createRequire(resolve(import.meta.dir, "../packages/server/package.json"));
  const reactEntry = tui.resolve("@opentui/react");
  const react = createRequire(reactEntry);
  const paths = [tui, server, react].map((consumer) =>
    realpathSync(consumer.resolve("@opentui/core")),
  );
  expect(new Set(paths).size).toBe(1);
  for (const entry of [paths[0]!, realpathSync(reactEntry)]) {
    const metadata = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8"));
    expect(metadata.version).toBe("0.6.6");
    expect(entry).not.toContain("vendor");
    expect(entry).not.toContain("workcraft.1");
  }
});

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { configurePreviewEnvironment } from "../src/preview-environment";
import { assertRegistryResolution } from "./build-preview";

test("preview homes default safely and explicit overrides win without changing their bytes", () => {
  const env: NodeJS.ProcessEnv = {};
  configurePreviewEnvironment(env);
  expect(env.WORK_CRAFT_HOME).toBe(join(homedir(), ".local/state/work-craft-preview"));
  const xdg: NodeJS.ProcessEnv = { XDG_STATE_HOME: "/owned" };
  configurePreviewEnvironment(xdg);
  expect(xdg.WORK_CRAFT_HOME).toBe("/owned/work-craft-preview");
  const explicit = { WORK_CRAFT_HOME: "/my preview", XDG_STATE_HOME: "/ignored" };
  configurePreviewEnvironment(explicit);
  expect(explicit.WORK_CRAFT_HOME).toBe("/my preview");
});

test("native asset environment overrides cannot masquerade as stock preview execution", () => {
  for (const name of ["OTUI_ASSET_ROOT", "OPENTUI_LIBC", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD"]) {
    expect(() => configurePreviewEnvironment({ [name]: "/fork" })).toThrow("override");
  }
});

test("a vendored package reporting the upstream version still fails provenance", () => {
  const good = {
    name: "@opentui/core",
    version: "0.6.6",
    path: "/node_modules/.bun/@opentui+core@0.6.6/node_modules/@opentui/core",
    locked: "@opentui/core@0.6.6",
  };
  expect(() => assertRegistryResolution(good)).not.toThrow();
  expect(() => assertRegistryResolution({ ...good, path: "/vendor/core" })).toThrow("registry");
  expect(() =>
    assertRegistryResolution({ ...good, locked: "@opentui/core@file:patched.tgz" }),
  ).toThrow("registry");
});

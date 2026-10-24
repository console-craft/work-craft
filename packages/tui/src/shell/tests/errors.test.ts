import { expect, test } from "bun:test";

import {
  clearOperationalError,
  commandSourceKey,
  discoverySourceKey,
  entrySourceKey,
  layoutSourceKey,
  type OperationalError,
  processSourceKey,
  reportOperationalError,
  retainedErrorSources,
  retainsErrorSource,
  statusPresentation,
} from "@/shell/errors.ts";
import { createInitialShellState, reduceShellState } from "@/shell/state.ts";
import { snapshotFixture } from "@/tests/support/fixtures";

test("error source identities keep command owners distinct from entry and background failures", () => {
  expect(commandSourceKey({ type: "surface.ensure", itemId: "i" }, "navigator")).toBe(
    "i:surface.ensure",
  );
  expect(commandSourceKey({ type: "process.restart", paneId: "p" }, "workbench")).toBe(
    "p:process.restart",
  );
  expect(
    commandSourceKey(
      { type: "session.navigate", sessionId: "s", target: { kind: "tab", tabId: "t" } },
      "tabs",
    ),
  ).toBe("tabs:session.navigate");
  expect(commandSourceKey({ type: "session.create", name: "New" }, "session")).toBe(
    "session:session.create",
  );
  expect(entrySourceKey("item", "i")).toBe("item:i:entry");
  expect(entrySourceKey("tab", "t")).toBe("tab:t:entry");
  expect(entrySourceKey("pane", "p")).toBe("pane:p:entry");
  expect(discoverySourceKey("i")).toBe("directory:i:discovery");
  expect(processSourceKey("p")).toBe("pane:p:process");
  expect(layoutSourceKey("p")).toBe("pane:p:layout");
});

test("record failures expire with archived or removed ancestry, not transient form errors", () => {
  const snapshot = snapshotFixture({
    surfaces: [{ id: "s", itemId: "item-1" }],
    tabs: [
      { id: "t", surfaceId: "s", title: "Tab", position: 0, layout: { type: "pane", paneId: "p" } },
    ],
  });
  let retained = retainedErrorSources(snapshot);
  expect(retainsErrorSource("item:item-1:entry", retained)).toBe(true);
  expect(retainsErrorSource("tab:t:entry", retained)).toBe(true);
  expect(retainsErrorSource("pane:p:layout", retained)).toBe(true);
  expect(retainsErrorSource("pane:p:entry", retained)).toBe(false);
  snapshot.tabs[0]!.layout = null;
  snapshot.items[0]!.archived = true;
  retained = retainedErrorSources(snapshot);
  expect(retainsErrorSource("item:item-1:entry", retained)).toBe(false);
  expect(retainsErrorSource("tab:t:entry", retained)).toBe(false);
  expect(retainsErrorSource("pane:p:layout", retained)).toBe(false);
  expect(retainsErrorSource("navigator:item.create", retained)).toBe(true);
  snapshot.items = [];
  expect(retainsErrorSource("root-1:surface.ensure", retainedErrorSources(snapshot))).toBe(false);
});

function failure(overrides: Partial<OperationalError> = {}): OperationalError {
  return {
    sourceKey: "item:1:open",
    sourceLabel: "Project",
    operation: "Open",
    epoch: "e",
    contextKey: "c",
    requestId: 2,
    message: "permission denied",
    expiresAt: 8000,
    origin: "direct",
    ...overrides,
  };
}

test("operational errors last eight seconds and survive higher priority presentation", () => {
  const operationalError = failure();
  const input = {
    operationalError,
    leaderActive: false,
    invalidMessage: null,
    invalidMessageUntil: null,
    now: 1000,
  };
  expect(statusPresentation(input)).toEqual({
    mode: "ERROR",
    text: "Project — Open failed: permission denied",
  });
  expect(statusPresentation({ ...input, leaderActive: true }).mode).toBe("LEADER");
  expect(
    statusPresentation({ ...input, invalidMessage: "Invalid", invalidMessageUntil: 2000 }).text,
  ).toBe("Invalid");
  expect(
    statusPresentation({ ...input, invalidMessage: "Invalid", invalidMessageUntil: 999 }).text,
  ).toContain("Project");
  expect(statusPresentation({ ...input, now: 8000 }).mode).toBe("HINTS");
});

test("background failures cannot replace a live direct failure and stale clears cannot erase newer errors", () => {
  const direct = failure();
  const background = failure({
    origin: "background",
    sourceKey: "directory:2:discovery",
    requestId: 3,
  });
  expect(reportOperationalError(direct, background, 4000)).toBe(direct);
  expect(reportOperationalError(direct, background, 9000)).toBe(background);
  expect(clearOperationalError(direct, direct.sourceKey, 1)).toBe(direct);
  expect(clearOperationalError(direct, "unrelated", 2)).toBe(direct);
  expect(clearOperationalError(direct, direct.sourceKey, 2)).toBeNull();
});

test("error text cannot inject terminal control bytes", () => {
  const presentation = statusPresentation({
    leaderActive: false,
    invalidMessage: null,
    invalidMessageUntil: null,
    operationalError: failure({ sourceLabel: "a\nb", message: "\u001b[31m\tbad" }),
    now: 0,
  });
  // oxlint-disable-next-line no-control-regex -- Assert status messages cannot emit terminal control bytes.
  expect(presentation.text).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
});

test("background fingerprints survive expiry and replacement, reset on recovery and epoch", () => {
  let state = createInitialShellState();
  const background = failure({ origin: "background" });
  const observe = (errors: OperationalError[], now = 0, epoch = "e") => {
    state = reduceShellState(state, { type: "sources.observe", epoch, failures: errors, now });
  };
  observe([background]);
  expect(state.operationalError).toBe(background);
  const direct = failure({ sourceKey: "other", requestId: 3 });
  state = reduceShellState(state, { type: "source.report", error: direct, now: 1 });
  observe([failure({ ...background, expiresAt: 18000 })], 10000);
  expect(state.operationalError).toBe(direct);
  observe([], 10001);
  observe([failure({ ...background, expiresAt: 18002 })], 10002);
  expect(state.operationalError?.sourceKey).toBe(background.sourceKey);
  observe([background], 10003, "new");
  expect(state.operationalError).toBe(background);
  expect(state.sourceFailures).toEqual({});
});

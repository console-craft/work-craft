import { expect, test } from "bun:test";

import type { ViewerReport } from "../api/protocol.ts";
import { createTerminalSizing, type SizingCatalog } from "./sizing.ts";

function catalog(): SizingCatalog {
  return {
    sessions: [],
    workspaces: [],
    sessionWorkspaces: [],
    categories: [],
    items: [],
    surfaces: [],
    tabs: [
      {
        id: "tab",
        surfaceId: "surface",
        title: "Tab",
        position: 0,
        layout: { type: "pane", paneId: "pane" },
      },
    ],
    panes: [
      {
        id: "pane",
        surfaceId: "surface",
        kind: "terminal",
        title: "Shell",
        cwd: "/",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "running",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  };
}

function report(cols = 100, rows = 30): ViewerReport {
  return {
    epoch: "e",
    attachmentGeneration: 1,
    navigationGeneration: 1,
    tabId: "tab",
    canvas: { cols, rows },
    eligible: true,
  };
}

test("latest user activity wins, idle resize does not", () => {
  const sizing = createTerminalSizing(catalog());
  sizing.report("A", report());
  sizing.attachmentActivity("A");
  sizing.report("B", report(70, 20));
  expect(sizing.current().tabs[0]?.ownerConnectionId).toBe("A");
  sizing.report("B", report(90, 25));
  expect(sizing.current().panes[0]?.size).toEqual({ cols: 100, rows: 29 });
  const changed = sizing.activity("B", 1);
  expect(changed.resizes).toEqual([{ paneId: "pane", size: { cols: 90, rows: 24 } }]);
  sizing.report("A", report(110, 40));
  expect(sizing.current().tabs[0]?.ownerConnectionId).toBe("B");
  expect(sizing.activity("B", 1).changed).toBe(false);
  sizing.activity("A", 1);
  expect(sizing.current().panes[0]?.size).toEqual({ cols: 110, rows: 39 });
});

test("same-size ownership transfer advances geometry without resizing a PTY", () => {
  const sizing = createTerminalSizing(catalog());
  sizing.report("A", report());
  sizing.attachmentActivity("A");
  sizing.report("B", report());
  const previousSequence = sizing.current().sequence;
  const transferred = sizing.attachmentActivity("B");
  expect(transferred.geometry.sequence).toBe(previousSequence + 1);
  expect(transferred.geometry.tabs[0]?.ownerConnectionId).toBe("B");
  expect(transferred.resizes).toEqual([]);
  expect(sizing.activity("B", 1).changed).toBe(false);
});

for (const withdrawal of ["detach", "covered", "withdraw"] as const) {
  test(`${withdrawal} reelects another viewer, then retains the last usable grid`, () => {
    const sizing = createTerminalSizing(catalog());
    sizing.report("A", report());
    sizing.attachmentActivity("A");
    sizing.report("B", report(70, 20));
    sizing.attachmentActivity("B");
    if (withdrawal === "detach") {
      sizing.remove("B");
    } else {
      sizing.report("B", withdrawal === "covered" ? { ...report(70, 20), eligible: false } : null);
    }
    expect(sizing.current().tabs[0]?.ownerConnectionId).toBe("A");
    expect(sizing.current().panes[0]?.size).toEqual({ cols: 100, rows: 29 });
    sizing.remove("A");
    expect(sizing.current().tabs[0]).toMatchObject({
      ownerConnectionId: null,
      canvas: { cols: 100, rows: 30 },
    });
    expect(sizing.current().panes[0]?.size).toEqual({ cols: 100, rows: 29 });
  });
}

test("a usable sibling qualifies without resizing an undersized pane", () => {
  const data = catalog();
  data.panes.push({ ...data.panes[0]!, id: "small" });
  data.tabs[0]!.layout = {
    type: "split",
    direction: "vertical",
    ratio: 0.9,
    first: { type: "pane", paneId: "pane" },
    second: { type: "pane", paneId: "small" },
  };
  const sizing = createTerminalSizing(data);
  sizing.report("A", report(100, 30));
  const result = sizing.attachmentActivity("A");
  expect(result.geometry.tabs[0]?.ownerConnectionId).toBe("A");
  expect(result.resizes).toEqual([{ paneId: "pane", size: { cols: 89, rows: 29 } }]);
  expect(result.geometry.panes.find(({ paneId }) => paneId === "small")?.size).toEqual({
    cols: 80,
    rows: 24,
  });
});

test("layout and process changes reevaluate eligibility without restarting or inventing grids", () => {
  const data = catalog();
  const sizing = createTerminalSizing(data);
  sizing.report("A", report());
  sizing.attachmentActivity("A");
  const exited = {
    ...data,
    panes: data.panes.map((pane) => ({ ...pane, processStatus: "exited" as const })),
  };
  expect(sizing.reconcile(exited).geometry.tabs[0]?.ownerConnectionId).toBeNull();
  expect(sizing.current().panes[0]?.size).toEqual({ cols: 100, rows: 29 });
  expect(sizing.reconcile(data).geometry.tabs[0]?.ownerConnectionId).toBe("A");
  expect(sizing.reconcile(data).changed).toBe(false);
});

test("only eligible viewers of the same tab compete across sessions", () => {
  const data = catalog();
  data.tabs.push({
    ...data.tabs[0]!,
    id: "other-tab",
    layout: { type: "pane", paneId: "other-pane" },
  });
  data.panes.push({ ...data.panes[0]!, id: "other-pane" });
  const sizing = createTerminalSizing(data);
  sizing.report("A", report());
  sizing.attachmentActivity("A");
  sizing.report("B", { ...report(80, 20), tabId: "other-tab" });
  sizing.attachmentActivity("B");
  expect(sizing.current().tabs.map(({ ownerConnectionId }) => ownerConnectionId)).toEqual([
    "A",
    "B",
  ]);
  sizing.report("B", report(80, 20));
  expect(sizing.current().tabs.map(({ ownerConnectionId }) => ownerConnectionId)).toEqual([
    "B",
    null,
  ]);
});

for (const size of [
  { cols: 59, rows: 30 },
  { cols: 100, rows: 5 },
]) {
  test(`a ${size.cols}x${size.rows} canvas does not bypass workbench protections`, () => {
    const sizing = createTerminalSizing(catalog());
    sizing.report("A", report(size.cols, size.rows));
    expect(sizing.attachmentActivity("A").geometry.tabs[0]?.ownerConnectionId).toBeNull();
    expect(sizing.current().panes[0]?.size).toEqual({ cols: 80, rows: 24 });
  });
}

for (const size of [
  { cols: 0, rows: 10 },
  { cols: 10.5, rows: 10 },
  { cols: Number.NaN, rows: 10 },
  { cols: 4097, rows: 10 },
  { cols: 4096, rows: 4096 },
  { cols: 10, rows: Number.MAX_SAFE_INTEGER + 1 },
]) {
  test(`invalid canvas ${size.cols}x${size.rows} rejects before changing policy`, () => {
    const sizing = createTerminalSizing(catalog());
    expect(() => sizing.report("A", report(size.cols, size.rows))).toThrow(/dimensions|canvas/);
    expect(sizing.current().sequence).toBe(0);
  });
}

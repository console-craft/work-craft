import { expect, test } from "bun:test";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import type { Snapshot } from "@work-craft/server/client";
import { act } from "react";
import { snapshotFixture } from "../test-fixtures.ts";
import { SurfaceView, terminalPaneKey } from "./surface-view.tsx";
import { TabBar } from "./tab-bar.tsx";

extend({ terminal: EmbeddedTerminalRenderable });

function surfaceSnapshot(): Snapshot {
  return snapshotFixture({
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
    categories: [
      {
        workspaceId: "workspace-shared",
        kind: "implementation",
        title: "Implementation",
        position: 0,
      },
    ],
    surfaces: [{ id: "surface-1", itemId: "item-1", activeTabId: "tab-1" }],
    tabs: [
      {
        id: "tab-1",
        surfaceId: "surface-1",
        title: "Shell",
        position: 0,
        layout: { type: "pane", paneId: "pane-1" },
      },
    ],
    panes: [
      {
        id: "pane-1",
        surfaceId: "surface-1",
        kind: "terminal",
        title: "Shell",
        cwd: "/tmp",
        restorePolicy: { type: "shell", executable: "/bin/sh", args: [] },
        processStatus: "running",
        errorText: null,
        startedAt: null,
        exitedAt: null,
      },
    ],
  });
}

test("terminal renderer identity includes the daemon epoch and replay cursor", () => {
  expect(terminalPaneKey("pane-1", undefined)).toBe("pane-1:pending:0");
  expect(terminalPaneKey("pane-1", { epoch: "epoch-2", historyCursor: 42 })).toBe(
    "pane-1:epoch-2:42",
  );
});

test("workbench warns before its content narrows below 60 columns", async () => {
  const snapshot = surfaceSnapshot();
  const small = await testRender(
    <SurfaceView
      focusedPaneId={null}
      snapshot={snapshot}
      stream={null}
      surface={snapshot.surfaces[0]!}
      terminals={new Map()}
      undersized
      workbenchFocused={false}
      onFocusPane={() => {}}
      onTerminalReady={() => {}}
    />,
    { width: 73, height: 20 },
  );
  await small.flush();
  expect(small.captureCharFrame()).toContain("too small.");
  act(() => small.renderer.destroy());
});

test("tab errors stay visible when tab labels overflow", async () => {
  const tab = surfaceSnapshot().tabs[0]!;
  const setup = await testRender(
    <TabBar
      activeId="tab-1"
      cursorId="tab-1"
      error="tab failed"
      focused
      tabs={Array.from({ length: 6 }, (_, index) => ({
        ...tab,
        id: `tab-${index + 1}`,
        title: `Long tab ${index + 1}`,
        position: index,
      }))}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 30, height: 1 },
  );
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("tab failed");
  act(() => setup.renderer.destroy());
});

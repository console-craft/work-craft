import { expect, test } from "bun:test";

import { paneNotice } from "@/workbench/pane-state.ts";

test("pane notices describe unavailable state without duplicating runtime errors", () => {
  expect(paneNotice("running", true)).toBeNull();
  for (const [processStatus, status, title, reactivate] of [
    ["starting", "info", "Starting terminal", false],
    ["exited", "warning", "Terminal exited", true],
    ["failed", "error", "Terminal failed", false],
    ["interrupted", "warning", "Terminal interrupted", false],
  ] as const) {
    expect(paneNotice(processStatus, true)).toEqual({ status, title, reactivate });
    expect(paneNotice(processStatus, false)).toEqual({
      status: "warning",
      title: "Disconnected",
      reactivate,
    });
  }
  expect(paneNotice("running", false)).toEqual({
    status: "warning",
    title: "Disconnected",
    reactivate: false,
  });
});

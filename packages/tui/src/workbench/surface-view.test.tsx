import { expect, test } from "bun:test";
import { terminalPaneKey } from "./surface-view.tsx";

test("terminal renderer identity includes the daemon epoch and replay cursor", () => {
  expect(terminalPaneKey("pane-1", undefined)).toBe("pane-1:pending:0");
  expect(terminalPaneKey("pane-1", { epoch: "epoch-2", historyCursor: 42 })).toBe(
    "pane-1:epoch-2:42",
  );
});

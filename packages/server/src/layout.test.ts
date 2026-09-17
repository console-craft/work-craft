import { expect, test } from "bun:test";
import { splitLayout } from "./layout.ts";

test("replaces one leaf with a stable recursive split", () => {
  const root = { type: "pane" as const, paneId: "a" };

  expect(splitLayout(root, "a", "b", "vertical")).toEqual({
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", paneId: "a" },
    second: { type: "pane", paneId: "b" },
  });
  expect(root).toEqual({ type: "pane", paneId: "a" });
});

test("rejects a missing split target", () => {
  expect(() => splitLayout({ type: "pane", paneId: "a" }, "missing", "b", "vertical")).toThrow(
    "exactly once",
  );
});

test("rejects a duplicate split target", () => {
  expect(() =>
    splitLayout(
      {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "pane", paneId: "a" },
        second: { type: "pane", paneId: "a" },
      },
      "a",
      "b",
      "vertical",
    ),
  ).toThrow("exactly once");
});

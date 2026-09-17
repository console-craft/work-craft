import { expect, test } from "bun:test";
import { parseArgs, UsageError } from "./args.ts";

test("parses resource-oriented commands", () => {
  const cases: Array<[string[], ReturnType<typeof parseArgs>]> = [
    [["snapshot", "--json"], { command: "snapshot", json: true }],
    [
      ["session", "create", "--name", "Main"],
      { command: "session.create", name: "Main", json: false },
    ],
    [
      ["workspace", "create", "--session", "s1", "--name", "Work"],
      { command: "workspace.create", sessionId: "s1", name: "Work", json: false },
    ],
    [
      [
        "project",
        "create",
        "--workspace",
        "w1",
        "--category",
        "implementation",
        "--name",
        "Work Craft",
      ],
      {
        command: "project.create",
        workspaceId: "w1",
        category: "implementation",
        name: "Work Craft",
        json: false,
      },
    ],
    [
      [
        "item",
        "create",
        "--project",
        "p1",
        "--kind",
        "generic",
        "--title",
        "Seed",
        "--data",
        '{"source":"cli"}',
        "--json",
      ],
      {
        command: "item.create",
        projectId: "p1",
        kind: "generic",
        title: "Seed",
        data: { source: "cli" },
        json: true,
      },
    ],
    [
      ["surface", "ensure", "--item", "i1", "--cwd", "/tmp"],
      { command: "surface.ensure", itemId: "i1", cwd: "/tmp", json: false },
    ],
    [
      ["surface", "ensure", "--project", "p1"],
      { command: "surface.ensure", projectId: "p1", json: false },
    ],
    [
      ["surface", "select-tab", "s1", "t1"],
      { command: "surface.selectTab", surfaceId: "s1", tabId: "t1", json: false },
    ],
    [
      ["tab", "create", "--surface", "s1", "--title", "Shell"],
      { command: "tab.create", surfaceId: "s1", title: "Shell", json: false },
    ],
    [
      ["pane", "split", "pn1", "--direction", "vertical", "--cwd", "/tmp"],
      {
        command: "pane.split",
        paneId: "pn1",
        direction: "vertical",
        cwd: "/tmp",
        json: false,
      },
    ],
    [["pane", "restart", "pn1"], { command: "process.restart", paneId: "pn1", json: false }],
    [["daemon", "status"], { command: "daemon.status", json: false }],
    [["daemon", "stop", "--json"], { command: "daemon.stop", json: true }],
    [["daemon", "destroy", "--force"], { command: "daemon.destroy", json: false }],
  ];

  for (const [argv, expected] of cases) {
    expect(parseArgs(argv)).toEqual(expected);
  }
});

test("rejects invalid resource-oriented commands", () => {
  const cases = [
    [],
    ["list"],
    ["ensure", "item-1"],
    ["status"],
    ["stop"],
    ["destroy"],
    ["session", "create"],
    ["session", "create", "--name", "Main", "--name", "Other"],
    ["workspace", "create", "--session", "s1"],
    ["project", "create", "--workspace", "w1", "--category", "unknown", "--name", "P"],
    ["item", "create", "--project", "p1", "--kind", "generic", "--title", "I", "--data", "[]"],
    ["item", "create", "--project", "p1", "--kind", "other", "--title", "I"],
    ["surface", "ensure"],
    ["surface", "ensure", "--item", "i1", "--project", "p1"],
    ["surface", "select-tab", "s1"],
    ["pane", "split", "pn1", "--direction", "diagonal"],
    ["daemon", "destroy"],
    ["daemon", "destroy", "--force", "--force"],
  ];

  for (const argv of cases) {
    expect(() => parseArgs(argv)).toThrow(UsageError);
  }
});

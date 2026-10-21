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
      ["session", "update", "s1", "--name", "Work", "--position", "0"],
      { command: "session.update", sessionId: "s1", name: "Work", position: 0, json: false },
    ],
    [["session", "delete", "s1"], { command: "session.delete", sessionId: "s1", json: false }],
    [
      ["session", "add-workspace", "s1", "--workspace", "w1"],
      { command: "session.workspace.add", sessionId: "s1", workspaceId: "w1", json: false },
    ],
    [
      ["session", "remove-workspace", "s1", "--workspace", "w1"],
      {
        command: "session.workspace.remove",
        sessionId: "s1",
        workspaceId: "w1",
        json: false,
      },
    ],
    [
      ["workspace", "create", "--session", "s1", "--name", "Work"],
      { command: "workspace.create", sessionId: "s1", name: "Work", json: false },
    ],
    [
      ["directory", "register", "--workspace", "w1", "--path", "/work/Work Craft"],
      {
        command: "directory.register",
        workspaceId: "w1",
        path: "/work/Work Craft",
        json: false,
      },
    ],
    [
      [
        "item",
        "create",
        "--workspace",
        "w1",
        "--category",
        "design",
        "--parent",
        "r1",
        "--title",
        "Seed",
        "--data",
        '{"source":"cli"}',
        "--json",
      ],
      {
        command: "item.create",
        workspaceId: "w1",
        category: "design",
        parentId: "r1",
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
      ["item", "archive", "i1", "--json"],
      { command: "item.setArchived", itemId: "i1", archived: true, json: true },
    ],
    [
      ["item", "restore", "i1"],
      { command: "item.setArchived", itemId: "i1", archived: false, json: false },
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
    ["snapshot", "--unknown"],
    ["session", "create"],
    ["session", "create", "--name", "Main", "--name", "Other"],
    ["session", "update", "--name", "Work"],
    ["session", "update", "s1"],
    ["session", "update", "s1", "--position", "-1"],
    ["session", "update", "s1", "--position", "1.5"],
    ["session", "update", "s1", "--name", "   "],
    ["session", "delete"],
    ["session", "add-workspace", "--workspace", "w1"],
    ["session", "add-workspace", "s1"],
    ["session", "remove-workspace", "--workspace", "w1"],
    ["session", "remove-workspace", "s1"],
    ["workspace", "create", "--session", "s1"],
    ["project", "create", "--workspace", "w1", "--category", "unknown", "--name", "P"],
    ["project", "create", "--workspace", "w1", "--category", "implementation", "--name", "P"],
    ["surface", "ensure", "--project", "p1"],
    ["item", "create", "--workspace", "w1", "--category", "implementation", "--title", "No"],
    [
      "item",
      "create",
      "--workspace",
      "w1",
      "--category",
      "design",
      "--kind",
      "generic",
      "--title",
      "No",
    ],
    ["item", "create", "--project", "p1", "--kind", "generic", "--title", "I", "--data", "[]"],
    ["item", "create", "--project", "p1", "--kind", "other", "--title", "I"],
    ["surface", "ensure"],
    ["surface", "ensure", "--item", "i1", "--project", "p1"],
    ["surface", "select-tab", "s1"],
    ["surface", "select-tab", "s1", "t1"],
    ["pane", "split", "pn1", "--direction", "diagonal"],
    ["daemon", "destroy"],
    ["daemon", "destroy", "--force", "--force"],
  ];

  for (const argv of cases) {
    expect(() => parseArgs(argv)).toThrow(UsageError);
  }
});

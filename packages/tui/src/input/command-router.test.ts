import { expect, test } from "bun:test";

import { parseKeypress } from "@opentui/core";

import {
  type CommandContext,
  commandHints,
  type CommandId,
  initialRouterState,
  isHyperKey,
  type KeyLike,
  routeKey,
} from "@/input/command-router.ts";

const allCommands = new Set<CommandId>([
  "focus.left",
  "focus.down",
  "focus.up",
  "focus.right",
  "category.previous",
  "category.next",
  "navigator.previous",
  "navigator.next",
  "navigator.toggle",
  "tab.previous",
  "tab.next",
  "tab.create",
  "session.open",
  "client.reload",
  "client.quit",
  "item.create",
  "pane.splitHorizontal",
  "pane.splitVertical",
  "pane.restart",
  "cursor.activate",
  "context.create",
  "project.openTerminal",
  "navigator.shrink",
  "navigator.grow",
  "dialog.cancel",
]);

const terminalContext: CommandContext = {
  focus: { region: "workbench", paneId: "pane-1" },
  connected: true,
  availableCommands: allCommands,
};

function route(key: KeyLike, context: CommandContext = terminalContext): CommandId | undefined {
  return routeKey(initialRouterState, key, context, 0).command;
}

test("common movement hints are hidden while application actions remain visible", () => {
  const keys = commandHints(initialRouterState, terminalContext).map((hint) => hint.keys);
  for (const key of ["Ctrl+h", "Ctrl+j", "Ctrl+k", "Ctrl+l"]) {
    expect(keys).not.toContain(key);
  }
  expect(keys).toContain("Hyper+r");
  expect(keys).toContain("Hyper+q");
  expect(keys).toContain("Hyper+j");
  const modal = { ...terminalContext, dialog: "sessions" as const };
  const modalKeys = commandHints(initialRouterState, modal).map((hint) => hint.keys);
  expect(modalKeys).toContain("Hyper+r");
  expect(modalKeys).toContain("Hyper+q");
  expect(modalKeys).toContain("n");
  expect(modalKeys).not.toContain("Hyper+j");
  expect(modalKeys).not.toContain("Tab");
  const navigator = { ...terminalContext, focus: { region: "navigator" as const } };
  expect(commandHints(initialRouterState, navigator).map(({ keys }) => keys)).not.toContain(
    "Ctrl+Left",
  );
  expect(commandHints(initialRouterState, navigator).map(({ keys }) => keys)).not.toContain(
    "Ctrl+Right",
  );
});

test("modal hints retain only available reconnect/quit and eligible dialog actions", () => {
  const context = { ...terminalContext, dialog: "create" as const };
  expect(commandHints(initialRouterState, context)).toEqual([
    { keys: "Hyper+r", label: "Reconnect" },
    { keys: "Hyper+q", label: "Quit" },
    { keys: "Escape", label: "Cancel" },
  ]);
  expect(
    commandHints(initialRouterState, { ...context, availableCommands: new Set(["client.quit"]) }),
  ).toEqual([{ keys: "Hyper+q", label: "Quit" }]);
});

test("native and physical Hyper forms are recognized", () => {
  expect(isHyperKey({ name: "h", hyper: true })).toBe(true);
  expect(isHyperKey({ name: "h", ctrl: true, meta: true, super: true })).toBe(true);
  expect(isHyperKey({ name: "h", ctrl: true, option: true, super: true })).toBe(true);
  expect(isHyperKey({ name: "h", ctrl: true, meta: true })).toBe(false);
});

test("ordinary terminal Ctrl+C and Escape remain unhandled", () => {
  expect(routeKey(initialRouterState, { name: "c", ctrl: true }, terminalContext, 0).handled).toBe(
    false,
  );
  expect(routeKey(initialRouterState, { name: "escape" }, terminalContext, 0).handled).toBe(false);
});

test("every global Hyper command resolves immediately", () => {
  const bindings: [string, CommandId][] = [
    ["h", "category.previous"],
    ["l", "category.next"],
    ["j", "navigator.next"],
    ["k", "navigator.previous"],
    ["[", "tab.previous"],
    ["]", "tab.next"],
    ["n", "tab.create"],
    ["s", "session.open"],
    ["r", "client.reload"],
    ["q", "client.quit"],
  ];
  for (const [name, command] of bindings) {
    expect(route({ name, hyper: true })).toBe(command);
  }
});

test("spatial Ctrl chords resolve without matching unrelated modifiers", () => {
  expect(route({ name: "h", ctrl: true })).toBe("focus.left");
  expect(route({ name: "j", ctrl: true })).toBe("focus.down");
  expect(route({ name: "k", ctrl: true })).toBe("focus.up");
  expect(route({ name: "l", ctrl: true })).toBe("focus.right");
  expect(route({ name: "h", ctrl: true, shift: true })).toBeUndefined();
});

test("legacy Ctrl+h and Ctrl+j bytes resolve as spatial focus chords", () => {
  expect(route(parseKeypress("\b", { useKittyKeyboard: true })!)).toBe("focus.left");
  expect(route(parseKeypress("\n", { useKittyKeyboard: true })!)).toBe("focus.down");
});

test("leader waits without a general timeout and resolves every continuation", () => {
  const bindings: [string, CommandId][] = [
    ["n", "item.create"],
    ["b", "navigator.toggle"],
    ["s", "pane.splitHorizontal"],
    ["v", "pane.splitVertical"],
    ["r", "pane.restart"],
  ];
  for (const [name, expected] of bindings) {
    const entered = routeKey(
      initialRouterState,
      { name: "space", ctrl: true },
      terminalContext,
      100,
    );
    const command = routeKey(entered.state, { name }, terminalContext, 10_000);
    expect(entered.statusMode).toBe("LEADER");
    expect(command.command).toBe(expected);
  }
});

test("terminal double prefix passes through only inside one second", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, terminalContext, 1_099)
      .passthroughLeader,
  ).toBe(true);
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, terminalContext, 1_100)
      .passthroughLeader,
  ).toBeUndefined();

  const shellContext = { ...terminalContext, focus: { region: "tabs" as const } };
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, shellContext, 200).passthroughLeader,
  ).toBeUndefined();
});

test("terminal double prefix rejects additional modifiers", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  for (const modifiers of [{ shift: true }, { meta: true }, { option: true }, { super: true }]) {
    const result = routeKey(
      entered.state,
      { name: "space", ctrl: true, ...modifiers },
      terminalContext,
      200,
    );
    expect(result.passthroughLeader).toBeUndefined();
    expect(result.statusMode).toBe("ERROR");
  }
});

test("invalid leader input is consumed and reports for one second", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  const invalid = routeKey(entered.state, { name: "x" }, terminalContext, 200);
  expect(invalid.handled).toBe(true);
  expect(invalid.statusMode).toBe("ERROR");
  expect(invalid.state.invalidMessage).toBe("Invalid leader key: x");
  expect(invalid.state.invalidMessageUntil).toBe(1_200);

  const cleared = routeKey(invalid.state, { name: "c", ctrl: true }, terminalContext, 1_200);
  expect(cleared.state.invalidMessage).toBeNull();
});

test("Escape cancels leader mode but otherwise passes through", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  const cancelled = routeKey(entered.state, { name: "escape" }, terminalContext, 200);
  expect(cancelled.handled).toBe(true);
  expect(cancelled.state.leaderStartedAt).toBeNull();
  expect(routeKey(cancelled.state, { name: "escape" }, terminalContext, 300).handled).toBe(false);
});

test("composite browsing and activation stay local while contextual commands route", () => {
  const context = (region: CommandContext["focus"]["region"]): CommandContext => ({
    ...terminalContext,
    focus: region === "workbench" ? { region, paneId: "pane-1" } : { region },
  });

  expect(route({ name: "n" }, context("workspace"))).toBe("context.create");
  expect(route({ name: "o" }, context("navigator"))).toBe("project.openTerminal");
  expect(route({ name: "left", ctrl: true }, context("navigator"))).toBe("navigator.shrink");
  expect(route({ name: "right", ctrl: true }, context("navigator"))).toBe("navigator.grow");
  for (const region of ["workspace", "category", "navigator", "tabs"] as const) {
    for (const name of [
      "h",
      "j",
      "k",
      "l",
      "left",
      "right",
      "up",
      "down",
      "return",
      "enter",
      "linefeed",
    ]) {
      expect(routeKey(initialRouterState, { name }, context(region), 0).handled).toBe(false);
    }
    expect(
      commandHints(initialRouterState, context(region)).map(({ label }) => label),
    ).not.toContain("Activate");
  }
  expect(route({ name: "n" }, context("navigator"))).toBe("context.create");
});

test("modal policy allows reconnect/quit and native input, not background commands", () => {
  for (const dialog of ["sessions", "create"] as const) {
    const context = { ...terminalContext, dialog };
    for (const name of ["h", "j", "k", "l", "[", "]", "n", "s"]) {
      const result = routeKey(initialRouterState, { name, hyper: true }, context, 0);
      expect(result.handled).toBe(true);
      expect(result.command).toBeUndefined();
    }
    expect(route({ name: "r", hyper: true }, context)).toBe("client.reload");
    expect(route({ name: "q", hyper: true }, context)).toBe("client.quit");
    for (const name of ["j", "k", "up", "down", "return"]) {
      expect(routeKey(initialRouterState, { name }, context, 0).handled).toBe(false);
    }
    for (const name of ["h", "j", "k", "l", "space"]) {
      expect(routeKey(initialRouterState, { name, ctrl: true }, context, 0).handled).toBe(false);
    }
    const pending = { ...initialRouterState, leaderStartedAt: 1 };
    expect(
      routeKey(pending, { name: "space", ctrl: true }, context, 2).state.leaderStartedAt,
    ).toBeNull();
  }
});

test("session dialog traps keys and has its own scoped commands", () => {
  const dialogContext: CommandContext = { ...terminalContext, dialog: "sessions" };
  expect(route({ name: "j" }, dialogContext)).toBeUndefined();
  expect(route({ name: "up" }, dialogContext)).toBeUndefined();
  expect(route({ name: "return" }, dialogContext)).toBeUndefined();
  expect(route({ name: "n" }, dialogContext)).toBe("context.create");
  expect(route({ name: "escape" }, dialogContext)).toBe("dialog.cancel");
  expect(route({ name: "q", hyper: true }, dialogContext)).toBe("client.quit");

  const createContext: CommandContext = {
    ...terminalContext,
    dialog: "create",
    focus: { region: "navigator" },
  };
  expect(route({ name: "escape" }, createContext)).toBe("dialog.cancel");
  expect(route({ name: "j" }, createContext)).toBeUndefined();
  expect(routeKey(initialRouterState, { name: "j" }, createContext, 0).handled).toBe(false);
  expect(routeKey(initialRouterState, { name: "h" }, createContext, 0).handled).toBe(false);
});

test("unavailable edge commands do not wrap or appear in hints", () => {
  const context = {
    ...terminalContext,
    availableCommands: new Set<CommandId>(["category.next"]),
  };
  expect(route({ name: "h", hyper: true }, context)).toBeUndefined();
  expect(route({ name: "l", hyper: true }, context)).toBe("category.next");
  expect(commandHints(initialRouterState, context).map(({ label }) => label)).not.toContain(
    "Prev category",
  );
});

test("disconnected clients reject durable commands but retain local controls", () => {
  const context = { ...terminalContext, connected: false };
  expect(route({ name: "n", hyper: true }, context)).toBeUndefined();
  expect(route({ name: "r", hyper: true }, context)).toBe("client.reload");
  expect(route({ name: "q", hyper: true }, context)).toBe("client.quit");
  expect(route({ name: "h", ctrl: true }, context)).toBe("focus.left");
});

test("Hyper Space and reserved later-stage bindings remain unhandled and hidden", () => {
  expect(
    routeKey(initialRouterState, { name: "space", hyper: true }, terminalContext, 0).handled,
  ).toBe(false);
  for (const key of [
    { name: "c", hyper: true },
    { name: "[", hyper: true, shift: true },
    { name: "]", hyper: true, shift: true },
    { name: "return", hyper: true },
  ]) {
    expect(route(key)).toBeUndefined();
  }

  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 0);
  expect(routeKey(entered.state, { name: "q" }, terminalContext, 1).command).toBeUndefined();
  expect(routeKey(entered.state, { name: "d" }, terminalContext, 1).command).toBeUndefined();
  expect(commandHints(initialRouterState, terminalContext).map(({ keys }) => keys)).not.toContain(
    "Hyper+c",
  );
});

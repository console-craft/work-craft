import { expect, test } from "bun:test";
import {
  commandHints,
  initialRouterState,
  isHyperKey,
  routeKey,
  type CommandContext,
  type CommandId,
  type KeyLike,
} from "./command-router.ts";

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
  "cursor.previous",
  "cursor.next",
  "cursor.left",
  "cursor.right",
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

test("terminal double prefix passes through only inside 400 milliseconds", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, terminalContext, 499).passthroughLeader,
  ).toBe(true);
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, terminalContext, 500).passthroughLeader,
  ).toBeUndefined();

  const shellContext = { ...terminalContext, focus: { region: "tabs" as const } };
  expect(
    routeKey(entered.state, { name: "space", ctrl: true }, shellContext, 200).passthroughLeader,
  ).toBeUndefined();
});

test("invalid leader input is consumed and reports for one second", () => {
  const entered = routeKey(initialRouterState, { name: "space", ctrl: true }, terminalContext, 100);
  const invalid = routeKey(entered.state, { name: "x" }, terminalContext, 200);
  expect(invalid.handled).toBe(true);
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

test("focused regions use the common local navigation grammar", () => {
  const context = (region: CommandContext["focus"]["region"]): CommandContext => ({
    ...terminalContext,
    focus: region === "workbench" ? { region, paneId: "pane-1" } : { region },
  });

  expect(route({ name: "h" }, context("workspace"))).toBe("cursor.left");
  expect(route({ name: "right" }, context("workspace"))).toBe("cursor.right");
  expect(route({ name: "n" }, context("workspace"))).toBe("context.create");
  expect(route({ name: "j" }, context("category"))).toBe("cursor.next");
  expect(route({ name: "up" }, context("category"))).toBe("cursor.previous");
  expect(route({ name: "down" }, context("navigator"))).toBe("cursor.next");
  expect(route({ name: "k" }, context("navigator"))).toBe("cursor.previous");
  expect(route({ name: "h" }, context("navigator"))).toBe("cursor.left");
  expect(route({ name: "l" }, context("navigator"))).toBe("cursor.right");
  expect(route({ name: "o" }, context("navigator"))).toBe("project.openTerminal");
  expect(route({ name: "left", ctrl: true }, context("navigator"))).toBe("navigator.shrink");
  expect(route({ name: "right", ctrl: true }, context("navigator"))).toBe("navigator.grow");
  expect(route({ name: "left" }, context("tabs"))).toBe("cursor.left");
  expect(route({ name: "l" }, context("tabs"))).toBe("cursor.right");

  for (const region of ["workspace", "category", "navigator", "tabs"] as const) {
    expect(route({ name: "return" }, context(region))).toBe("cursor.activate");
  }
  expect(route({ name: "n" }, context("navigator"))).toBe("context.create");
});

test("session dialog traps keys and has its own scoped commands", () => {
  const dialogContext: CommandContext = { ...terminalContext, dialog: "sessions" };
  expect(route({ name: "j" }, dialogContext)).toBe("cursor.next");
  expect(route({ name: "up" }, dialogContext)).toBe("cursor.previous");
  expect(route({ name: "return" }, dialogContext)).toBe("cursor.activate");
  expect(route({ name: "n" }, dialogContext)).toBe("context.create");
  expect(route({ name: "escape" }, dialogContext)).toBe("dialog.cancel");
  expect(route({ name: "q", hyper: true }, dialogContext)).toBeUndefined();

  const createContext: CommandContext = { ...terminalContext, dialog: "create" };
  expect(route({ name: "escape" }, createContext)).toBe("dialog.cancel");
  expect(route({ name: "j" }, createContext)).toBeUndefined();
});

test("unavailable edge commands do not wrap or appear in hints", () => {
  const context = {
    ...terminalContext,
    availableCommands: new Set<CommandId>(["category.next"]),
  };
  expect(route({ name: "h", hyper: true }, context)).toBeUndefined();
  expect(route({ name: "l", hyper: true }, context)).toBe("category.next");
  expect(commandHints(initialRouterState, context).map(({ label }) => label)).not.toContain(
    "Previous category",
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

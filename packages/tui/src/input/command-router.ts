import type { FocusTarget } from "@/input/focus.ts";

export type StatusMode = "HINTS" | "LEADER" | "INFO" | "ERROR";
export type CommandId =
  | "focus.left"
  | "focus.down"
  | "focus.up"
  | "focus.right"
  | "category.previous"
  | "category.next"
  | "navigator.previous"
  | "navigator.next"
  | "navigator.toggle"
  | "tab.previous"
  | "tab.next"
  | "tab.create"
  | "session.open"
  | "client.reload"
  | "client.quit"
  | "item.create"
  | "pane.splitHorizontal"
  | "pane.splitVertical"
  | "pane.restart"
  | "cursor.activate"
  | "context.create"
  | "project.openTerminal"
  | "navigator.shrink"
  | "navigator.grow"
  | "dialog.cancel";

export type KeyLike = {
  name: string;
  raw?: string;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
  shift?: boolean;
  super?: boolean;
  hyper?: boolean;
};

function legacyCtrlName(key: KeyLike): "h" | "j" | undefined {
  return key.raw === "\b" ? "h" : key.raw === "\n" ? "j" : undefined;
}

export type CommandContext = {
  focus: FocusTarget;
  dialog?: "sessions" | "create";
  connected: boolean;
  availableCommands: ReadonlySet<CommandId>;
};

export type RouterState = {
  leaderStartedAt: number | null;
  invalidMessage: string | null;
  invalidMessageUntil: number | null;
};

export const initialRouterState: RouterState = {
  leaderStartedAt: null,
  invalidMessage: null,
  invalidMessageUntil: null,
};

export type RouteResult = {
  state: RouterState;
  handled: boolean;
  command?: CommandId;
  passthroughLeader?: true;
  statusMode: StatusMode;
};

export type CommandHint = { keys: string; label: string };

type Route = {
  kind: "hyper" | "ctrl" | "leader" | "plain";
  names: readonly string[];
  scopes?: readonly FocusTarget["region"][];
  dialogs?: readonly NonNullable<CommandContext["dialog"]>[];
};

type CommandDefinition = CommandHint & {
  id: CommandId;
  durable?: true;
  showInHints?: boolean;
  routes: readonly Route[];
};

const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "focus.left",
    showInHints: false,
    keys: "Ctrl+h",
    label: "Focus left",
    routes: [{ kind: "ctrl", names: ["h"] }],
  },
  {
    id: "focus.down",
    showInHints: false,
    keys: "Ctrl+j",
    label: "Focus down",
    routes: [{ kind: "ctrl", names: ["j"] }],
  },
  {
    id: "focus.up",
    showInHints: false,
    keys: "Ctrl+k",
    label: "Focus up",
    routes: [{ kind: "ctrl", names: ["k"] }],
  },
  {
    id: "focus.right",
    showInHints: false,
    keys: "Ctrl+l",
    label: "Focus right",
    routes: [{ kind: "ctrl", names: ["l"] }],
  },
  {
    id: "category.previous",
    keys: "Hyper+h",
    label: "Prev category",
    routes: [{ kind: "hyper", names: ["h"] }],
  },
  {
    id: "category.next",
    keys: "Hyper+l",
    label: "Next category",
    routes: [{ kind: "hyper", names: ["l"] }],
  },
  {
    id: "navigator.previous",
    keys: "Hyper+k",
    label: "Prev item",
    durable: true,
    routes: [{ kind: "hyper", names: ["k"] }],
  },
  {
    id: "navigator.next",
    keys: "Hyper+j",
    label: "Next item",
    durable: true,
    routes: [{ kind: "hyper", names: ["j"] }],
  },
  {
    id: "navigator.toggle",
    keys: "leader+b",
    label: "Toggle navigator",
    routes: [{ kind: "leader", names: ["b"] }],
  },
  {
    id: "tab.previous",
    keys: "Hyper+[",
    label: "Prev tab",
    durable: true,
    routes: [{ kind: "hyper", names: ["["] }],
  },
  {
    id: "tab.next",
    keys: "Hyper+]",
    label: "Next tab",
    durable: true,
    routes: [{ kind: "hyper", names: ["]"] }],
  },
  {
    id: "tab.create",
    keys: "Hyper+n",
    label: "New tab",
    durable: true,
    routes: [{ kind: "hyper", names: ["n"] }],
  },
  {
    id: "session.open",
    keys: "Hyper+s",
    label: "Sessions",
    routes: [{ kind: "hyper", names: ["s"] }],
  },
  {
    id: "client.reload",
    keys: "Hyper+r",
    label: "Reconnect",
    routes: [{ kind: "hyper", names: ["r"] }],
  },
  {
    id: "client.quit",
    keys: "Hyper+q",
    label: "Quit",
    routes: [{ kind: "hyper", names: ["q"] }],
  },
  {
    id: "item.create",
    keys: "leader+n",
    label: "New item",
    durable: true,
    routes: [{ kind: "leader", names: ["n"] }],
  },
  {
    id: "pane.splitHorizontal",
    keys: "leader+s",
    label: "Split horizontally",
    durable: true,
    routes: [{ kind: "leader", names: ["s"] }],
  },
  {
    id: "pane.splitVertical",
    keys: "leader+v",
    label: "Split vertically",
    durable: true,
    routes: [{ kind: "leader", names: ["v"] }],
  },
  {
    id: "pane.restart",
    keys: "leader+r",
    label: "Restart pane",
    durable: true,
    routes: [{ kind: "leader", names: ["r"] }],
  },
  {
    id: "context.create",
    keys: "n",
    label: "Create",
    routes: [
      { kind: "plain", names: ["n"], scopes: ["session", "workspace", "navigator"] },
      { kind: "plain", names: ["n"], dialogs: ["sessions"] },
    ],
  },
  {
    id: "project.openTerminal",
    keys: "o",
    label: "Open terminal",
    durable: true,
    routes: [{ kind: "plain", names: ["o"], scopes: ["navigator"] }],
  },
  {
    id: "navigator.shrink",
    showInHints: false,
    keys: "Ctrl+Left",
    label: "Shrink navigator",
    routes: [{ kind: "ctrl", names: ["left"], scopes: ["navigator"] }],
  },
  {
    id: "navigator.grow",
    showInHints: false,
    keys: "Ctrl+Right",
    label: "Grow navigator",
    routes: [{ kind: "ctrl", names: ["right"], scopes: ["navigator"] }],
  },
  {
    id: "dialog.cancel",
    keys: "Escape",
    label: "Cancel",
    routes: [{ kind: "plain", names: ["escape"], dialogs: ["sessions", "create"] }],
  },
];

export function isHyperKey(key: KeyLike): boolean {
  return (
    key.hyper === true ||
    (key.ctrl === true && (key.meta === true || key.option === true) && key.super === true)
  );
}

function isPlain(key: KeyLike): boolean {
  return !key.ctrl && !key.meta && !key.option && !key.shift && !key.super && !key.hyper;
}

function routeMatches(route: Route, key: KeyLike, context: CommandContext): boolean {
  const legacyCtrl = legacyCtrlName(key);
  if (!route.names.includes(legacyCtrl ?? key.name.toLowerCase())) {
    return false;
  }
  if (route.dialogs !== undefined && !route.dialogs.includes(context.dialog!)) {
    return false;
  }
  if (route.scopes !== undefined && !route.scopes.includes(context.focus.region)) {
    return false;
  }
  if (route.kind === "hyper") {
    return isHyperKey(key) && !key.shift;
  }
  if (route.kind === "ctrl") {
    return (
      (key.ctrl === true || legacyCtrl !== undefined) &&
      !isHyperKey(key) &&
      !key.meta &&
      !key.option &&
      !key.shift &&
      !key.super
    );
  }
  return isPlain(key);
}

function available(definition: CommandDefinition, context: CommandContext): boolean {
  return context.availableCommands.has(definition.id) && (!definition.durable || context.connected);
}

function allowedUnderModal(id: CommandId): boolean {
  return id === "client.reload" || id === "client.quit";
}

function result(state: RouterState, handled: boolean, command?: CommandId): RouteResult {
  return {
    state,
    handled,
    ...(command === undefined ? {} : { command }),
    statusMode:
      state.invalidMessage !== null ? "ERROR" : state.leaderStartedAt === null ? "HINTS" : "LEADER",
  };
}

function commandFor(
  kind: Route["kind"],
  key: KeyLike,
  context: CommandContext,
): { definition: CommandDefinition; allowed: boolean } | undefined {
  for (const definition of COMMANDS) {
    if (
      definition.routes.some((route) => route.kind === kind && routeMatches(route, key, context))
    ) {
      return { definition, allowed: available(definition, context) };
    }
  }
  return undefined;
}

function dialogCommandFor(
  key: KeyLike,
  context: CommandContext,
): { definition: CommandDefinition; allowed: boolean } | undefined {
  for (const definition of COMMANDS) {
    if (
      definition.routes.some(
        (route) =>
          route.kind === "plain" &&
          route.dialogs !== undefined &&
          routeMatches(route, key, context),
      )
    ) {
      return { definition, allowed: available(definition, context) };
    }
  }
  return undefined;
}

function clearExpiredMessage(state: RouterState, now: number): RouterState {
  return state.invalidMessageUntil !== null && now >= state.invalidMessageUntil
    ? { ...state, invalidMessage: null, invalidMessageUntil: null }
    : state;
}

function invalidLeader(state: RouterState, key: KeyLike, now: number): RouteResult {
  const name = key.name === "space" && key.ctrl ? "Ctrl+Space" : key.name;
  return result(
    {
      ...state,
      leaderStartedAt: null,
      invalidMessage: `Invalid leader key: ${name}`,
      invalidMessageUntil: now + 1_000,
    },
    true,
  );
}

export function routeKey(
  currentState: RouterState,
  key: KeyLike,
  context: CommandContext,
  now: number,
): RouteResult {
  const state = clearExpiredMessage(currentState, now);

  if (context.dialog !== undefined) {
    const dialogState = { ...state, leaderStartedAt: null };
    const dialogMatch = dialogCommandFor(key, context);
    if (dialogMatch !== undefined) {
      return result(dialogState, true, dialogMatch.allowed ? dialogMatch.definition.id : undefined);
    }
    const globalMatch = commandFor("hyper", key, context);
    if (globalMatch !== undefined) {
      const id = globalMatch.definition.id;
      const modalAllowed = allowedUnderModal(id);
      return result(dialogState, true, modalAllowed && globalMatch.allowed ? id : undefined);
    }
    return result(dialogState, false);
  }

  if (state.leaderStartedAt !== null) {
    if (key.name === "escape" && isPlain(key)) {
      return result({ ...state, leaderStartedAt: null }, true);
    }
    if (
      context.focus.region === "workbench" &&
      key.name === "space" &&
      key.ctrl === true &&
      !isHyperKey(key) &&
      !key.meta &&
      !key.option &&
      !key.shift &&
      !key.super &&
      now - state.leaderStartedAt < 1_000
    ) {
      return {
        ...result({ ...state, leaderStartedAt: null }, true),
        passthroughLeader: true,
      };
    }
    const match = commandFor("leader", key, context);
    if (match?.allowed) {
      return result({ ...state, leaderStartedAt: null }, true, match.definition.id);
    }
    return invalidLeader(state, key, now);
  }

  if (
    key.name === "space" &&
    key.ctrl === true &&
    !isHyperKey(key) &&
    !key.meta &&
    !key.option &&
    !key.shift &&
    !key.super
  ) {
    return result({ ...state, leaderStartedAt: now }, true);
  }

  for (const kind of ["hyper", "ctrl", "plain"] as const) {
    const match = commandFor(kind, key, context);
    if (match !== undefined) {
      return result(state, true, match.allowed ? match.definition.id : undefined);
    }
  }
  return result(state, false);
}

export function commandHints(state: RouterState, context: CommandContext): readonly CommandHint[] {
  const routeKind = state.leaderStartedAt === null ? undefined : "leader";
  const seen = new Set<CommandId>();
  return COMMANDS.flatMap<CommandHint>((definition) => {
    if (
      definition.showInHints === false ||
      seen.has(definition.id) ||
      !available(definition, context)
    ) {
      return [];
    }
    const visible = definition.routes.some((route) => {
      if (context.dialog !== undefined) {
        return (
          route.dialogs?.includes(context.dialog) === true ||
          (route.kind === "hyper" && allowedUnderModal(definition.id))
        );
      }
      if (routeKind !== undefined) {
        return route.kind === routeKind;
      }
      return (
        route.kind !== "leader" &&
        route.dialogs === undefined &&
        (route.scopes === undefined || route.scopes.includes(context.focus.region))
      );
    });
    if (!visible) {
      return [];
    }
    seen.add(definition.id);
    return [{ keys: definition.keys, label: definition.label }];
  });
}

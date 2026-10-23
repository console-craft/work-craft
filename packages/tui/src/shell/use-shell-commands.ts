import { useRenderer } from "@opentui/react";
import { useRef, useState } from "react";

import type { WorkCraftState } from "@/client/store";
import type { CommandId } from "@/input/command-router";
import type { FocusTarget } from "@/input/focus";
import {
  type CompletionContext,
  completionContextFor,
  executeCommand,
  type ExecuteCommandInput,
  runDurableCommand,
  submitCreate,
} from "@/shell/commands";
import type { ShellEnvironment } from "@/shell/context";
import { commandSourceKey, OPERATIONAL_ERROR_DURATION } from "@/shell/errors";
import { focusTargetFor } from "@/shell/focus";
import type { DialogState, ShellAction } from "@/shell/state";
import type {
  PaneEntryHandle,
  TabEntryHandle,
  TerminalEntryCoordinator,
} from "@/shell/use-terminal-entry";
import { isEligibleFocusTarget } from "@/ui/interaction/focus-utils";
import { hasTerminalViewport } from "@/workbench/layout";

type ShellCommandView = ShellEnvironment & {
  focus: FocusTarget;
  focusedPaneId: string | null;
  terminalWidth: number;
};
type ShellCommandsOptions = {
  view(): ShellCommandView;
  read(): ShellEnvironment;
  workCraft: WorkCraftState;
  entry(): TerminalEntryCoordinator;
  dispatch(action: ShellAction): void;
  setFocus(target: FocusTarget): void;
  canReactivate(paneId: string): boolean;
  nextRequestId(): number;
};
export type ShellCommandsController = {
  attach(sessionId: string): Promise<void>;
  run: ExecuteCommandInput["run"];
  execute(
    command: CommandId,
    overrides?: Partial<
      Pick<ExecuteCommandInput, "model" | "state" | "focus" | "focusedPaneId" | "onItemOpened">
    >,
  ): Promise<void>;
  submitCreate(value: string): Promise<void>;
  archive(): Promise<void>;
  reactivate(paneId: string): void;
  isSubmitting(dialog: DialogState): boolean;
  isReactivating(paneId: string): boolean;
  reactivatingPaneIds: ReadonlySet<string>;
  /** Called at the existing shell layout-effect positions. */
  reconcileRestartProtection(): void;
  observeCompletion(context: CompletionContext): void;
};

/** Command identity and restart protection outlive cancellable focus intent. */
export function useShellCommands({
  view,
  read,
  workCraft,
  entry: getEntry,
  dispatch,
  setFocus,
  canReactivate,
  nextRequestId,
}: ShellCommandsOptions): ShellCommandsController {
  const renderer = useRenderer();
  const [reactivatingPaneIds, setReactivatingPaneIds] = useState<ReadonlySet<string>>(new Set());
  const reactivatingPaneIdsRef = useRef(
    new Map<string, { epoch: string; revision: number | null }>(),
  );
  const completionContextRef = useRef<CompletionContext>({
    key: "",
    navigationKey: "",
    dialog: null,
  });
  const submittingDialogRef = useRef<NonNullable<DialogState> | null>(null);
  const sourceOperations = useRef(new Map<string, number>());
  async function attachSession(sessionId: string): Promise<void> {
    const requestId = nextRequestId();
    const epoch = read().snapshot?.epoch ?? "";
    const contextKey = read().model.navigationKey;
    try {
      await workCraft.attach(sessionId);
      dispatch({ type: "session.attached" });
      dispatch({ type: "source.clear", sourceKey: "session:client.attach", requestId });
    } catch (cause) {
      const now = Date.now();
      dispatch({
        type: "source.report",
        now,
        error: {
          sourceKey: "session:client.attach",
          sourceLabel: "Session",
          operation: "Attach",
          epoch,
          contextKey,
          requestId,
          message: cause instanceof Error ? cause.message : String(cause),
          expiresAt: now + OPERATIONAL_ERROR_DURATION,
          origin: "direct",
        },
      });
    }
  }
  function reconcileRestartProtection(): void {
    const currentSnapshot = read().snapshot;
    let changed = false;
    for (const [paneId, restart] of reactivatingPaneIdsRef.current) {
      if (
        workCraft.status !== "connected" ||
        currentSnapshot?.epoch !== restart.epoch ||
        (restart.revision !== null &&
          (currentSnapshot.revision > restart.revision ||
            (currentSnapshot.revision === restart.revision &&
              !currentSnapshot.panes.some(
                (pane) =>
                  pane.id === paneId && ["exited", "interrupted"].includes(pane.processStatus),
              ))))
      ) {
        reactivatingPaneIdsRef.current.delete(paneId);
        changed = true;
      }
    }
    if (changed) {
      setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
    }
  }

  const runCommand: ExecuteCommandInput["run"] = (
    command,
    region,
    expected = completionContextRef.current,
  ) => {
    const { snapshot, state, model } = view();
    const entry = getEntry();
    if (command.type === "session.openItem" && expected.key === undefined) {
      // Activation owns this navigation change before React commits its reducer action.
      completionContextRef.current = expected;
    }
    const id =
      "itemId" in command
        ? command.itemId
        : "paneId" in command
          ? command.paneId
          : "surfaceId" in command
            ? command.surfaceId
            : region;
    const sourceKey = commandSourceKey(command, region);
    const operationKey =
      command.type === "session.navigate" ||
      command.type === "session.step" ||
      command.type === "session.openItem"
        ? `navigation:${command.sessionId}`
        : sourceKey;
    const requestId = nextRequestId();
    const entryIsCurrent = entry.commandStarted(command);
    sourceOperations.current.set(operationKey, requestId);
    const label =
      snapshot?.items.find((item) => item.id === id)?.title ??
      snapshot?.panes.find((pane) => pane.id === id)?.title ??
      (state.dialog?.kind === "create" ? "Create" : (model.activeItem?.title ?? region));
    return runDurableCommand({
      command,
      region,
      expected,
      current: () => ({
        ...completionContextFor(read().model, read().state.dialog),
        snapshot: read().snapshot ?? undefined,
        navigation: read().model.navigation,
      }),
      send: async (command) => {
        const restart =
          command.type === "process.restart"
            ? reactivatingPaneIdsRef.current.get(command.paneId)
            : undefined;
        const response = await workCraft.command(command);
        // RPC success owns protection even when newer input cancelled its focus handoff.
        if (restart) {
          restart.revision = response.revision;
        }
        return response;
      },
      dispatch,
      source: {
        key: sourceKey,
        label,
        requestId,
        epoch: snapshot?.epoch ?? "",
        isCurrent: () =>
          sourceOperations.current.get(operationKey) === requestId && entryIsCurrent(),
      },
    });
  };

  function execute(
    command: CommandId,
    overrides: Partial<
      Pick<ExecuteCommandInput, "model" | "state" | "focus" | "focusedPaneId" | "onItemOpened">
    > = {},
  ): Promise<void> {
    const {
      snapshot,
      layout: { focusNodes },
      focus,
      focusedPaneId,
      terminalWidth,
    } = view();
    const entry = getEntry();
    const currentState = read().state;
    const currentModel = read().model;
    const enteringPanes =
      command === "focus.right" &&
      (overrides.focus ?? focus).region === "navigator" &&
      focusNodes.some(
        ({ target, rect }) => target.region === "workbench" && hasTerminalViewport(rect),
      );
    // Navigator entry targets usable content; the strip remains reachable vertically.
    const nodes = focusNodes.filter(
      ({ target }) =>
        (!enteringPanes || target.region !== "tabs") &&
        (target.region !== "workbench" ||
          target.control !== "reactivate" ||
          canReactivate(target.paneId)),
    );
    for (const region of ["workspace", "session"] as const) {
      const node = renderer.root.findDescendantById(`region:${region}`);
      if (node && isEligibleFocusTarget(node, renderer.root)) {
        nodes.push({
          target: { region },
          rect: { x: node.screenX, y: node.screenY, width: node.width, height: node.height },
        });
      }
    }
    const restartPaneId =
      command === "pane.restart" ? (overrides.focusedPaneId ?? focusedPaneId) : null;
    if (restartPaneId && reactivatingPaneIdsRef.current.has(restartPaneId)) {
      return Promise.resolve();
    }
    if (
      restartPaneId &&
      focusTargetFor(renderer.currentFocusedRenderable)?.region === "workbench"
    ) {
      // Transfer our own origin before pending state disables the initiating action.
      setFocus({ region: "tabs" });
    }
    const restartEntry = restartPaneId
      ? entry.startPaneCommand("restart", restartPaneId)
      : undefined;
    let commandEntry: PaneEntryHandle | TabEntryHandle | undefined = restartEntry;
    const restart = restartPaneId
      ? {
          epoch: read().snapshot?.epoch ?? "",
          revision: null as number | null,
        }
      : null;
    if (restartPaneId && restart) {
      reactivatingPaneIdsRef.current.set(restartPaneId, restart);
      setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
    }
    return executeCommand({
      command,
      model: currentModel,
      state: currentState,
      snapshot,
      focus,
      focusedPaneId,
      focusNodes: nodes,
      terminalWidth,
      dispatch,
      setFocus,
      onItemOpened: undefined,
      onTabSelectionStarted: (id) => {
        const handle = entry.startTabSelection(id);
        return (revision, tabId, navigation) =>
          handle.complete(revision, tabId, undefined, navigation);
      },
      onTabCreateStarted: () => {
        const handle = entry.startTabSelection(undefined, false, true);
        commandEntry = handle;
        return (tabId, paneId, revision, navigation) =>
          handle.complete(revision, tabId, paneId, navigation);
      },
      onPaneRestarted: restartEntry?.complete,
      onPaneSplitStarted: () => {
        const handle = entry.startPaneCommand("split");
        commandEntry = handle;
        return handle.complete;
      },
      run: runCommand,
      reload: workCraft.reload,
      quit: () => renderer.destroy(),
      ...overrides,
    }).finally(() => {
      if (restartPaneId) {
        if (reactivatingPaneIdsRef.current.get(restartPaneId) === restart) {
          if (restart?.revision === null) {
            reactivatingPaneIdsRef.current.delete(restartPaneId);
            setReactivatingPaneIds(new Set(reactivatingPaneIdsRef.current.keys()));
          } else {
            reconcileRestartProtection();
          }
        }
      }
      commandEntry?.finish();
    });
  }

  function reactivatePane(paneId: string): void {
    if (!canReactivate(paneId)) {
      return;
    }
    const target: FocusTarget = { region: "workbench", paneId, control: "reactivate" };
    void execute("pane.restart", { focus: target, focusedPaneId: paneId });
  }

  function handleCreate(value: string): Promise<void> {
    const { model, snapshot } = view();
    const entry = getEntry();
    const currentState = read().state;
    if (
      currentState.dialog?.kind !== "create" ||
      submittingDialogRef.current === currentState.dialog
    ) {
      return Promise.resolve();
    }
    return submitCreate({
      value,
      model,
      state: currentState,
      snapshot,
      getSubmittingDialog: () => submittingDialogRef.current,
      setSubmittingDialog: (dialog) => {
        submittingDialogRef.current = dialog;
      },
      dispatch,
      run: runCommand,
      onItemCreated: entry.createdItemHandler(currentState.dialog),
      attach: attachSession,
    });
  }

  async function archive(): Promise<void> {
    const { snapshot, state } = view();
    if (renderer.width < 80) {
      return;
    }
    const dialog = state.dialog;
    if (dialog?.kind !== "archive" || submittingDialogRef.current === dialog) {
      return;
    }
    const item = snapshot?.items.find((item) => item.id === dialog.itemId);
    if (
      !item ||
      item.kind === "generic" ||
      item.archived ||
      item.data.availability !== "unavailable"
    ) {
      return;
    }
    submittingDialogRef.current = dialog;
    const result = await runCommand(
      { type: "item.setArchived", itemId: item.id, archived: true },
      "navigator",
    );
    if (submittingDialogRef.current === dialog) {
      submittingDialogRef.current = null;
    }
    if (result) {
      dispatch({ type: "dialog.close" });
    }
  }

  return {
    attach: attachSession,
    run: runCommand,
    execute,
    submitCreate: handleCreate,
    archive,
    reactivate: reactivatePane,
    isSubmitting: (dialog) => dialog !== null && submittingDialogRef.current === dialog,
    isReactivating: (paneId) => reactivatingPaneIdsRef.current.has(paneId),
    reactivatingPaneIds,
    reconcileRestartProtection,
    observeCompletion(context) {
      completionContextRef.current = context;
    },
  };
}

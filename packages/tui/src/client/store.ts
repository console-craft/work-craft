import {
  type ClientAttachment,
  type Command,
  type CommandResponse,
  type ControlSnapshot,
  decodeBytes,
  type InputStamp,
  type LayoutNode,
  type PaneHistoryResponse,
  type ServerMessage,
  type Snapshot,
  type StreamConnection,
  type TerminalGeometry,
  type WorkCraftClient,
} from "@work-craft/server/client";

import { observeOutput, outputProbeEnabled } from "@/client/output-probe";
import {
  appendTerminalChunk,
  mergePaneHistory,
  snapshotTerminals,
  type TerminalBuffer,
} from "@/client/terminal-buffer";
import { createTerminalOutputs, type TerminalOutputs } from "@/client/terminal-output";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type WorkCraftState = {
  /** Live authority for asynchronous callbacks whose React projection may lag. */
  getState(): WorkCraftState;
  connectionError: string | null;
  snapshot: ControlSnapshot | null;
  status: ConnectionStatus;
  /** Null awaits an acknowledgment; an acknowledged sessionId:null means explicitly detached. */
  attachment: ClientAttachment | null;
  requestedSessionId: string | null;
  geometry: TerminalGeometry;
  attach(sessionId: string | null): Promise<void>;
  /** Reads current authoritative state even from callbacks captured before a React commit. */
  canSendInput(paneId: string, stamp: InputStamp): boolean;
  canRespond(paneId: string, stamp: InputStamp): boolean;
  /** Live exited-action readiness; never grants terminal input eligibility. */
  canReactivate(paneId: string, stamp: InputStamp): boolean;
  command(command: Command): Promise<CommandResponse>;
  /** Repair retained output without withdrawing the current attachment or input context. */
  resync(): Promise<void>;
  resyncPane(paneId: string): Promise<void>;
  reload(): Promise<void>;
  stream: StreamConnection | null;
  outputs: TerminalOutputs;
};

export type WorkCraftStore = {
  apply(message: ServerMessage): Promise<void>;
  getState(): WorkCraftState;
  reload(): Promise<void>;
  snapshot(): ControlSnapshot | null;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
};

export type WorkCraftStoreOptions = {
  retryDelays?: readonly number[];
  sleep?(milliseconds: number): Promise<void>;
};

const RETRY_DELAYS = [100, 250, 500, 1000, 2000] as const;

function containsPane(layout: LayoutNode | null, paneId: string): boolean {
  if (layout === null) {
    return false;
  }
  return layout.type === "pane"
    ? layout.paneId === paneId
    : containsPane(layout.first, paneId) || containsPane(layout.second, paneId);
}

export function createWorkCraftStore(
  client: WorkCraftClient,
  options: WorkCraftStoreOptions = {},
): WorkCraftStore {
  const listeners = new Set<() => void>();
  const outputs = createTerminalOutputs();
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const sleep = options.sleep ?? Bun.sleep;
  let run = 0;
  let connectionGeneration = 0;
  let applying = Promise.resolve();
  let queuedMessages = 0;
  let desiredSession: string | null = null;
  let initialChoice = true;
  let attachmentRequest = 0;
  let state: WorkCraftState = {
    getState: () => state,
    connectionError: null,
    snapshot: null,
    status: "connecting",
    attachment: null,
    requestedSessionId: null,
    geometry: { sequence: 0, tabs: [], panes: [] },
    attach,
    canSendInput: (paneId, stamp) => canUsePane(paneId, stamp, "running", false),
    canRespond: (paneId, stamp) => canUsePane(paneId, stamp, "running", true),
    canReactivate: (paneId, stamp) => canUsePane(paneId, stamp, "exited", false),
    command: async (command) => {
      if (state.status !== "connected" || !state.stream || !state.attachment) {
        throw new Error("Cannot mutate while disconnected");
      }
      return state.stream.command(command, state.attachment.generation);
    },
    reload,
    resync,
    resyncPane: async (paneId) => {
      try {
        await resyncPane(paneId);
      } catch (cause) {
        update({
          connectionError: `Terminal ${paneId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    },
    stream: null,
    outputs,
  };

  type Recovery = {
    identity: string;
    controller: AbortController;
    promise: Promise<void>;
    resolve(): void;
    reject(error: unknown): void;
    started: boolean;
  };
  const recoveries = new Map<string, Recovery>();
  let activeRecoveries = 0;

  function recoveryIdentity(paneId: string): string | null {
    const snapshot = state.snapshot;
    const runtime = snapshot?.terminalStates.find((entry) => entry.paneId === paneId);
    const navigation = snapshot?.navigation.find(
      (entry) => entry.sessionId === state.attachment?.sessionId,
    );
    return snapshot && runtime
      ? [
          run,
          connectionGeneration,
          attachmentRequest,
          snapshot.epoch,
          runtime.runtimeGeneration,
          navigation?.generation,
          navigation?.itemId,
          navigation?.tabId,
        ].join(":")
      : null;
  }

  function discardObsoleteRecoveries(): void {
    for (const [paneId, job] of recoveries) {
      if (state.status !== "connected" || job.identity !== recoveryIdentity(paneId)) {
        recoveries.delete(paneId);
        job.controller.abort();
        job.resolve();
      }
    }
  }

  function pumpRecoveries(): void {
    for (const [paneId, job] of recoveries) {
      if (activeRecoveries >= 4) {
        break;
      }
      if (job.started) {
        continue;
      }
      job.started = true;
      activeRecoveries++;
      const buffer = outputs.buffers().get(paneId);
      const after = buffer?.needsHistory ? undefined : outputs.frontier(paneId)?.cursor;
      void client
        .paneHistory(paneId, after, { signal: job.controller.signal })
        .then((response: PaneHistoryResponse) => {
          if (
            recoveries.get(paneId) !== job ||
            job.identity !== recoveryIdentity(paneId) ||
            state.status !== "connected" ||
            response.epoch !== state.snapshot?.epoch ||
            response.paneId !== paneId ||
            response.history.paneId !== paneId ||
            response.runtimeGeneration !==
              state.snapshot.terminalStates.find((entry) => entry.paneId === paneId)
                ?.runtimeGeneration
          ) {
            return;
          }
          outputs.set(
            paneId,
            mergePaneHistory(response, outputs.buffers().get(paneId), state.geometry.sequence),
          );
        })
        .then(job.resolve, job.reject)
        .finally(() => {
          activeRecoveries--;
          if (recoveries.get(paneId) === job) {
            recoveries.delete(paneId);
          }
          pumpRecoveries();
        });
    }
  }

  function resyncPane(paneId: string): Promise<void> {
    const identity = recoveryIdentity(paneId);
    if (!identity || state.status !== "connected") {
      return Promise.resolve();
    }
    discardObsoleteRecoveries();
    const existing = recoveries.get(paneId);
    if (existing) {
      return existing.promise;
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    recoveries.set(paneId, {
      identity,
      promise,
      resolve,
      reject,
      started: false,
      controller: new AbortController(),
    });
    pumpRecoveries();
    return promise;
  }

  function requestPaneHistory(paneId: string): void {
    void resyncPane(paneId).catch((cause) => {
      update({
        connectionError: `Terminal ${paneId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    });
  }

  function recoverMissingHistories(): void {
    discardObsoleteRecoveries();
    for (const [paneId, buffer] of outputs.buffers()) {
      if (buffer.needsHistory) {
        requestPaneHistory(paneId);
      }
    }
  }

  async function attach(sessionId: string | null): Promise<void> {
    const stream = state.stream;
    if (state.status !== "connected" || !stream) {
      throw new Error("Cannot attach while disconnected");
    }
    const request = ++attachmentRequest;
    initialChoice = false;
    desiredSession = sessionId;
    update({ attachment: null, requestedSessionId: sessionId });
    discardObsoleteRecoveries();
    const attachment = await stream.attach(sessionId);
    if (request === attachmentRequest && stream === state.stream) {
      update({ attachment });
      recoverMissingHistories();
    }
  }

  function canUsePane(
    paneId: string,
    stamp: InputStamp,
    status: "running" | "exited",
    response: boolean,
  ): boolean {
    const snapshot = state.snapshot;
    const attachment = state.attachment;
    const navigation = snapshot?.navigation.find(
      ({ sessionId }) => sessionId === attachment?.sessionId,
    );
    const geometry = state.geometry.tabs.find(({ tabId }) => tabId === navigation?.tabId);
    if (
      state.status !== "connected" ||
      !snapshot ||
      !attachment ||
      !navigation ||
      snapshot.epoch !== stamp.epoch ||
      attachment.generation !== stamp.attachmentGeneration ||
      navigation.generation !== stamp.navigationGeneration ||
      geometry?.generation !== stamp.geometrySequence ||
      (response
        ? geometry.ownerConnectionId !== attachment.connectionId
        : status === "running" && navigation.paneId !== paneId)
    ) {
      return false;
    }
    const pane = snapshot.panes.find((pane) => pane.id === paneId);
    const surface = snapshot.surfaces.find((surface) => surface.id === pane?.surfaceId);
    const item = snapshot.items.find((item) => item.id === surface?.itemId);
    const parent = snapshot.items.find((parent) => parent.id === item?.parentId);
    const tab = snapshot.tabs.find(
      (tab) => tab.id === navigation.tabId && tab.surfaceId === surface?.id,
    );
    return (
      item !== undefined &&
      item.id === navigation.itemId &&
      item.workspaceId === navigation.workspaceId &&
      item.category === navigation.category &&
      snapshot.sessionWorkspaces.some(
        (entry) =>
          entry.sessionId === navigation.sessionId && entry.workspaceId === item.workspaceId,
      ) &&
      !item.archived &&
      (item.parentId === null ||
        (parent !== undefined &&
          !parent.archived &&
          parent.parentId === null &&
          parent.workspaceId === item.workspaceId &&
          parent.category === item.category)) &&
      pane?.kind === "terminal" &&
      outputs.buffers().get(paneId)?.runtimeGeneration ===
        snapshot.terminalStates.find((entry) => entry.paneId === paneId)?.runtimeGeneration &&
      pane.processStatus === status &&
      containsPane(tab?.layout ?? null, paneId)
    );
  }

  function update(patch: Partial<WorkCraftState>): void {
    state = { ...state, ...patch };
    if (outputProbeEnabled && ("attachment" in patch || "status" in patch || "snapshot" in patch)) {
      const navigation = state.snapshot?.navigation.find(
        (entry) => entry.sessionId === state.attachment?.sessionId,
      );
      observeOutput({
        stage: "control",
        paneId: navigation?.paneId ?? undefined,
        generation: navigation?.generation,
        pending: state.attachment?.generation,
      });
    }
    const notified = outputProbeEnabled ? performance.now() : 0;
    for (const listener of listeners) {
      listener();
    }
    if (outputProbeEnabled) {
      observeOutput({
        stage: "store.notify",
        pending: listeners.size,
        durationMs: performance.now() - notified,
      });
    }
  }

  function replaceSnapshot(incoming: Snapshot | ControlSnapshot): void {
    let snapshot: ControlSnapshot;
    if ("terminalHistories" in incoming) {
      const { terminalHistories: _histories, ...metadata } = incoming;
      snapshot = {
        ...metadata,
        terminalStates: incoming.terminalHistories.map(({ paneId }) => ({
          paneId,
          runtimeGeneration: outputs.buffers().get(paneId)?.runtimeGeneration ?? 0,
        })),
      };
      outputs.replace(snapshotTerminals(incoming, outputs.buffers()));
    } else {
      snapshot = incoming;
    }
    const current = state.snapshot;
    const sameEpoch = current?.epoch === snapshot.epoch;
    const geometry =
      sameEpoch && state.geometry.sequence >= snapshot.geometry.sequence
        ? state.geometry
        : snapshot.geometry;
    if (
      (current === null || !sameEpoch || snapshot.revision >= current.revision) &&
      desiredSession !== null &&
      !snapshot.sessions.some(({ id }) => id === desiredSession)
    ) {
      desiredSession = null;
      attachmentRequest += 1;
      update({ attachment: null, requestedSessionId: null });
    }
    if (
      current === null ||
      snapshot.epoch !== current.epoch ||
      snapshot.revision > current.revision
    ) {
      reconcileOutputs(snapshot);
      update({
        snapshot: geometry === snapshot.geometry ? snapshot : { ...snapshot, geometry },
        geometry,
      });
    } else if (snapshot.epoch === current.epoch && snapshot.revision === current.revision) {
      reconcileOutputs(snapshot);
      if (geometry !== state.geometry) {
        update({ geometry, snapshot: { ...current, geometry } });
      }
    } else if (sameEpoch && geometry !== state.geometry) {
      update({ geometry, snapshot: { ...current!, geometry } });
    }
    recoverMissingHistories();
  }

  function reconcileOutputs(snapshot: ControlSnapshot): void {
    const next = new Map<string, TerminalBuffer>();
    for (const { paneId, runtimeGeneration } of snapshot.terminalStates) {
      const previous = outputs.buffers().get(paneId);
      next.set(
        paneId,
        previous?.epoch === snapshot.epoch && previous.runtimeGeneration === runtimeGeneration
          ? previous
          : {
              epoch: snapshot.epoch,
              runtimeGeneration,
              resetGeneration: 0,
              needsHistory: true,
              history: new Uint8Array(),
              historyCursor: 0,
              historyStartCursor: 0,
              historyPrefixBytes: 0,
              initialSize:
                snapshot.geometry.panes.find((entry) => entry.paneId === paneId)?.size ?? null,
              initialGridSequence: null,
              resizes: [],
              chunks: [],
            },
      );
    }
    outputs.replace(next);
  }

  async function refresh(activeRun?: number, connection?: number): Promise<boolean> {
    const snapshot = await client.controlSnapshot();
    if (
      (activeRun !== undefined && run !== activeRun) ||
      (connection !== undefined && connection !== connectionGeneration)
    ) {
      return false;
    }
    replaceSnapshot(snapshot);
    return true;
  }

  // Transport orders snapshots within one connection; this queue also rejects obsolete store runs.
  // Equal-revision snapshots can still recover output missed across connections.
  async function applyMessage(
    message: ServerMessage,
    activeRun?: number,
    connection?: number,
  ): Promise<void> {
    if (message.type === "client.attached" && message.requestId === null) {
      desiredSession = message.attachment.sessionId;
      attachmentRequest += 1;
      update({ attachment: message.attachment, requestedSessionId: message.attachment.sessionId });
      return;
    }
    if (message.type === "terminal.geometry") {
      if (
        message.epoch !== state.snapshot?.epoch ||
        message.geometry.sequence <= state.geometry.sequence
      ) {
        return;
      }
      if (message.geometry.sequence !== state.geometry.sequence + 1) {
        await refresh(activeRun, connection);
        return;
      }
      const replacements = new Map<string, TerminalBuffer>();
      for (const { paneId, marker, runtimeGeneration } of message.resizes) {
        const buffer = replacements.get(paneId) ?? outputs.buffers().get(paneId);
        if (!buffer || buffer.runtimeGeneration !== runtimeGeneration) {
          continue;
        }
        if (
          marker.sequence !==
            (buffer.resizes.at(-1)?.sequence ?? buffer.initialGridSequence ?? 0) + 1 ||
          buffer.resizes.length >= 1024
        ) {
          requestPaneHistory(paneId);
          continue;
        }
        replacements.set(paneId, { ...buffer, resizes: [...buffer.resizes, marker] });
      }
      update({
        geometry: message.geometry,
        snapshot: { ...state.snapshot, geometry: message.geometry },
      });
      for (const [paneId, buffer] of replacements) {
        outputs.set(paneId, buffer);
      }
      return;
    }
    if (message.type === "terminal.output") {
      if (message.epoch !== state.snapshot?.epoch) {
        return;
      }
      if (message.geometrySequence > state.geometry.sequence) {
        await refresh(activeRun, connection);
        return;
      }
      const current = outputs.buffers().get(message.paneId);
      if (!current || current.runtimeGeneration !== message.runtimeGeneration) {
        return;
      }
      const lastCursor = current.chunks.at(-1)?.cursor ?? current.historyCursor;
      if (message.cursor <= lastCursor) {
        return;
      }
      const data = decodeBytes(message.data);
      if (message.cursor - data.byteLength > lastCursor) {
        requestPaneHistory(message.paneId);
      }
      const attachment = state.attachment;
      const navigation = state.snapshot.navigation.find(
        ({ sessionId }) => sessionId === attachment?.sessionId,
      );
      const geometry = state.geometry.tabs.find(({ tabId }) => tabId === navigation?.tabId);
      // Never assign newer authority to output overtaken by a snapshot/resync.
      const responseStamp =
        attachment && navigation && geometry && message.geometrySequence === state.geometry.sequence
          ? {
              epoch: message.epoch,
              attachmentGeneration: attachment.generation,
              navigationGeneration: navigation.generation,
              geometrySequence: geometry.generation,
            }
          : null;
      outputs.set(
        message.paneId,
        appendTerminalChunk(
          current,
          message.cursor,
          data,
          message.geometrySequence,
          "live",
          responseStamp && state.canRespond(message.paneId, responseStamp) ? responseStamp : null,
        ),
      );
      if (outputProbeEnabled) {
        const buffer = outputs.buffers().get(message.paneId)!;
        observeOutput({
          stage: "store.buffer",
          aggregateOnly: true,
          paneId: message.paneId,
          cursor: message.cursor,
          bytes:
            buffer.history.byteLength +
            buffer.chunks.reduce((n, chunk) => n + chunk.data.byteLength, 0),
        });
      }
      return;
    }
    if (message.type !== "snapshot" && message.type !== "control.snapshot") {
      return;
    }
    const current = state.snapshot;
    const next = message.snapshot;
    if (current === null || next.epoch !== current.epoch || next.revision <= current.revision + 1) {
      replaceSnapshot(next);
    } else if (next.revision > current.revision + 1) {
      await refresh(activeRun, connection);
    }
  }

  async function connect(activeRun: number): Promise<void> {
    const connection = ++connectionGeneration;
    let stream: StreamConnection | undefined;
    stream = await client.stream(
      {
        onMessage(message) {
          void apply(message, activeRun, connection).catch(() => stream?.close());
        },
        onClose() {
          if (run === activeRun && connection === connectionGeneration) {
            void reconnect(activeRun);
          }
        },
      },
      { snapshot: "control" },
    );
    if (run !== activeRun || connection !== connectionGeneration) {
      stream.close();
      return;
    }
    update({ status: "connected", stream, connectionError: null });
    if (initialChoice) {
      initialChoice = false;
      if (state.snapshot?.sessions.length === 1) {
        desiredSession = state.snapshot.sessions[0]!.id;
      }
    }
    await attach(desiredSession);
  }

  async function reconnect(activeRun: number): Promise<void> {
    if (run !== activeRun) {
      return;
    }
    connectionGeneration += 1;
    attachmentRequest += 1;
    update({ status: "connecting", stream: null, attachment: null });
    discardObsoleteRecoveries();
    for (const delay of retryDelays) {
      await sleep(delay);
      if (run !== activeRun) {
        return;
      }
      try {
        await connect(activeRun);
        return;
      } catch {
        // Continue through the bounded retry sequence.
      }
    }
    if (run !== activeRun) {
      return;
    }
    try {
      await client.ensureDaemon();
      if (run !== activeRun || !(await refresh(activeRun))) {
        return;
      }
      await connect(activeRun);
    } catch (cause) {
      if (run === activeRun) {
        update({
          status: "disconnected",
          stream: null,
          connectionError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  async function establish(activeRun: number, recoverDaemon: boolean): Promise<void> {
    update({ status: "connecting", stream: null, attachment: null });
    try {
      if (recoverDaemon) {
        await client.ensureDaemon();
      }
      if (run !== activeRun || !(await refresh(activeRun))) {
        return;
      }
      await connect(activeRun);
    } catch {
      if (run === activeRun) {
        await reconnect(activeRun);
      }
    }
  }

  async function reload(): Promise<void> {
    const activeRun = ++run;
    const oldStream = state.stream;
    attachmentRequest += 1;
    update({ status: "connecting", stream: null, attachment: null });
    oldStream?.close();
    await sleep(0);
    if (run !== activeRun) {
      return;
    }
    await establish(activeRun, false);
  }

  async function resync(): Promise<void> {
    const activeRun = run;
    const connection = connectionGeneration;
    try {
      await refresh(activeRun, connection);
      await Promise.all(
        state.snapshot?.terminalStates.map(({ paneId }) => resyncPane(paneId)) ?? [],
      );
    } catch {
      if (run === activeRun && connection === connectionGeneration) {
        await reload();
      }
    }
  }

  function apply(message: ServerMessage, activeRun?: number, connection?: number): Promise<void> {
    const enqueued = outputProbeEnabled ? performance.now() : 0;
    const metadata =
      outputProbeEnabled && message.type === "terminal.output"
        ? {
            paneId: message.paneId,
            cursor: message.cursor,
            geometrySequence: message.geometrySequence,
          }
        : undefined;
    if (outputProbeEnabled) {
      queuedMessages++;
      observeOutput({
        stage: "store.enqueue",
        ...metadata,
        generation: connection,
        pending: queuedMessages,
      });
    }
    const result = applying.then(() => {
      if (
        (activeRun !== undefined && run !== activeRun) ||
        (connection !== undefined && connection !== connectionGeneration)
      ) {
        if (outputProbeEnabled) {
          queuedMessages--;
        }
        return;
      }
      if (outputProbeEnabled) {
        const started = performance.now();
        observeOutput({
          stage: "store.apply.start",
          ...metadata,
          generation: connection,
          pending: queuedMessages,
          durationMs: started - enqueued,
        });
        const applied = applyMessage(message, activeRun, connection);
        observeOutput({
          stage: "store.apply.return",
          ...metadata,
          aggregateOnly: true,
          durationMs: performance.now() - started,
        });
        return applied.finally(() => {
          queuedMessages--;
          observeOutput({
            stage: "store.apply.end",
            ...metadata,
            generation: connection,
            pending: queuedMessages,
            durationMs: performance.now() - started,
          });
        });
      }
      return applyMessage(message, activeRun, connection);
    });
    applying = result.catch(() => {});
    return result;
  }

  return {
    apply,
    getState: () => state,
    reload,
    snapshot: () => state.snapshot,
    async start() {
      const activeRun = ++run;
      await establish(activeRun, true);
    },
    stop() {
      run += 1;
      state.stream?.close();
      attachmentRequest += 1;
      update({ status: "disconnected", stream: null, attachment: null });
      discardObsoleteRecoveries();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

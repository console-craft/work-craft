import {
  type ClientAttachment,
  type Command,
  type CommandResponse,
  decodeBytes,
  type InputStamp,
  type LayoutNode,
  type ServerMessage,
  type Snapshot,
  type StreamConnection,
  type TerminalGeometry,
  type WorkCraftClient,
} from "@work-craft/server/client";

import {
  appendTerminalChunk,
  snapshotTerminals,
  type TerminalBuffer,
} from "@/client/terminal-buffer";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type WorkCraftState = {
  connectionError: string | null;
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  attachment: ClientAttachment | null;
  geometry: TerminalGeometry;
  attach(sessionId: string | null): Promise<void>;
  /** Reads current authoritative state even from callbacks captured before a React commit. */
  canSendInput(paneId: string, stamp: InputStamp): boolean;
  canRespond(paneId: string, stamp: InputStamp): boolean;
  /** Live exited-action readiness; never grants terminal input eligibility. */
  canReactivate(paneId: string, stamp: InputStamp): boolean;
  command(command: Command): Promise<CommandResponse>;
  reload(): Promise<void>;
  stream: StreamConnection | null;
  terminals: ReadonlyMap<string, TerminalBuffer>;
};

export type WorkCraftStore = {
  apply(message: ServerMessage): Promise<void>;
  getState(): WorkCraftState;
  reload(): Promise<void>;
  snapshot(): Snapshot | null;
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
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const sleep = options.sleep ?? Bun.sleep;
  let run = 0;
  let connectionGeneration = 0;
  let applying = Promise.resolve();
  let desiredSession: string | null = null;
  let initialChoice = true;
  let attachmentRequest = 0;
  let state: WorkCraftState = {
    connectionError: null,
    snapshot: null,
    status: "connecting",
    attachment: null,
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
    stream: null,
    terminals: new Map(),
  };

  async function attach(sessionId: string | null): Promise<void> {
    const stream = state.stream;
    if (state.status !== "connected" || !stream) {
      throw new Error("Cannot attach while disconnected");
    }
    const request = ++attachmentRequest;
    initialChoice = false;
    desiredSession = sessionId;
    update({ attachment: null });
    const attachment = await stream.attach(sessionId);
    if (request === attachmentRequest && stream === state.stream) {
      update({ attachment });
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
      pane.processStatus === status &&
      containsPane(tab?.layout ?? null, paneId)
    );
  }

  function update(patch: Partial<WorkCraftState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  function replaceSnapshot(snapshot: Snapshot): void {
    const current = state.snapshot;
    const sameEpoch = current?.epoch === snapshot.epoch;
    const geometry =
      sameEpoch && state.geometry.sequence >= snapshot.geometry.sequence
        ? state.geometry
        : snapshot.geometry;
    if (desiredSession !== null && !snapshot.sessions.some(({ id }) => id === desiredSession)) {
      desiredSession = null;
      attachmentRequest += 1;
      update({ attachment: null });
    }
    if (
      current === null ||
      snapshot.epoch !== current.epoch ||
      snapshot.revision > current.revision
    ) {
      update({
        snapshot: geometry === snapshot.geometry ? snapshot : { ...snapshot, geometry },
        geometry,
        terminals: snapshotTerminals(snapshot, state.terminals),
      });
    } else if (snapshot.epoch === current.epoch && snapshot.revision === current.revision) {
      const terminals = snapshotTerminals(snapshot, state.terminals);
      if (terminals !== state.terminals || geometry !== state.geometry) {
        update({ terminals, geometry, snapshot: { ...current, geometry } });
      }
    } else if (sameEpoch && geometry !== state.geometry) {
      update({ geometry, snapshot: { ...current!, geometry } });
    }
  }

  async function refresh(activeRun?: number, connection?: number): Promise<boolean> {
    const snapshot = await client.snapshot();
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
      update({ attachment: message.attachment });
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
      const terminals = new Map(state.terminals);
      for (const { paneId, marker } of message.resizes) {
        const buffer = terminals.get(paneId);
        if (!buffer) {
          continue;
        }
        if (
          marker.sequence !==
            (buffer.resizes.at(-1)?.sequence ?? buffer.initialGridSequence ?? 0) + 1 ||
          buffer.resizes.length >= 1024
        ) {
          await refresh(activeRun, connection);
          return;
        }
        terminals.set(paneId, { ...buffer, resizes: [...buffer.resizes, marker] });
      }
      update({
        geometry: message.geometry,
        snapshot: { ...state.snapshot, geometry: message.geometry },
        terminals,
      });
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
      const current = state.terminals.get(message.paneId);
      if (!current) {
        await refresh(activeRun, connection);
        return;
      }
      const lastCursor = current.chunks.at(-1)?.cursor ?? current.historyCursor;
      if (message.cursor <= lastCursor) {
        return;
      }
      if (message.cursor - decodeBytes(message.data).byteLength > lastCursor) {
        await refresh(activeRun, connection);
        return;
      }
      const terminals = new Map(state.terminals);
      terminals.set(
        message.paneId,
        appendTerminalChunk(
          current,
          message.cursor,
          decodeBytes(message.data),
          message.geometrySequence,
        ),
      );
      update({ terminals });
      return;
    }
    if (message.type !== "snapshot") {
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
    stream = await client.stream({
      onMessage(message) {
        void apply(message, activeRun, connection).catch(() => stream?.close());
      },
      onClose() {
        if (run === activeRun && connection === connectionGeneration) {
          void reconnect(activeRun);
        }
      },
    });
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

  function apply(message: ServerMessage, activeRun?: number, connection?: number): Promise<void> {
    const result = applying.then(() => {
      if (
        (activeRun !== undefined && run !== activeRun) ||
        (connection !== undefined && connection !== connectionGeneration)
      ) {
        return;
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
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

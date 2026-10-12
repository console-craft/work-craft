import { type CliRenderer, CliRenderEvents, type Clock, SystemClock } from "@opentui/core";

export type NotificationVariant = "default" | "success" | "warning" | "error" | "info";
export type NotificationDelivery = "auto" | "toast" | "native";

export interface NotificationAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface NotificationOptions {
  variant?: NotificationVariant;
  description?: string;
  delivery?: NotificationDelivery;
  duration?: number;
  action?: NotificationAction;
}

export interface NotificationRecord {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly variant: NotificationVariant;
  readonly delivery: NotificationDelivery;
  readonly channel: "toast" | "native" | null;
  readonly createdAt: number;
  readonly deliveredAt: number | null;
  readonly dismissedAt: number | null;
}

export interface NotificationStore {
  (title: string, options?: NotificationOptions): string;
  dismiss(id: string): void;
  clear(id: string): void;
  clearAll(): void;
  getSnapshot(): readonly NotificationRecord[];
  subscribe(listener: () => void): () => void;
}

export interface NotificationStoreOptions {
  maxHistory?: number;
}

/** @internal For Toaster and colocated library tests only. */
export interface NotificationStoreController {
  connect(renderer: CliRenderer, maxVisible: number, clock?: Clock): () => void;
  setMaxVisible(maxVisible: number): void;
  setHovered(id: string, hovered: boolean): void;
  getAction(id: string): NotificationAction | undefined;
}

const controllers = new WeakMap<NotificationStore, NotificationStoreController>();

/** @internal Not an application delivery-adapter API. */
export function getNotificationStoreController(
  store: NotificationStore,
): NotificationStoreController {
  const controller = controllers.get(store);
  if (!controller) {
    throw new Error("Notification store was not created by createNotificationStore");
  }
  return controller;
}

// Runtime data is private and released when delivery is cancelled or history is removed.
type Entry = {
  duration: number;
  remaining: number;
  action?: NotificationAction;
  timer?: ReturnType<Clock["setTimeout"]>;
  startedAt: number;
  hovered: boolean;
};

function validateLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validateDuration(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("duration must be finite and nonnegative");
  }
}

/** Isolated client-local history; notifications stay pending until a Toaster connects. */
export function createNotificationStore(options: NotificationStoreOptions = {}): NotificationStore {
  const maxHistory = options.maxHistory ?? 100;
  validateLimit(maxHistory, "maxHistory");
  let snapshot: readonly NotificationRecord[] = Object.freeze([]);
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let renderer: CliRenderer | undefined;
  let terminalFocused: boolean | null = null;
  let clock: Clock = new SystemClock();
  let maxVisible = 3;
  let currentDisconnect: (() => void) | undefined;

  function publish(records: readonly NotificationRecord[]): void {
    snapshot = Object.freeze(records.map((record) => Object.freeze(record)));
    for (const listener of listeners) {
      listener();
    }
  }

  function pause(entry: Entry): void {
    if (entry.timer === undefined) {
      return;
    }
    clock.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.remaining = Math.max(0, entry.remaining - (clock.now() - entry.startedAt));
  }

  function release(id: string): void {
    const entry = entries.get(id);
    if (entry) {
      pause(entry);
      entries.delete(id);
    }
  }

  function schedule(id: string, entry: Entry): void {
    if (!renderer || entry.duration === 0 || entry.hovered || entry.timer !== undefined) {
      return;
    }
    entry.startedAt = clock.now();
    // Clocks may truncate fractional delays; round up to avoid a zero-delay rescheduling loop.
    entry.timer = clock.setTimeout(
      () => {
        pause(entry);
        if (entry.remaining === 0) {
          dismiss(id);
        } else {
          schedule(id, entry);
        }
      },
      Math.min(Math.ceil(entry.remaining), 2_147_483_647),
    );
  }

  function dismissRecord(record: NotificationRecord): NotificationRecord {
    release(record.id);
    return { ...record, dismissedAt: Date.now() };
  }

  function enforceVisibleLimit(
    records: readonly NotificationRecord[],
  ): readonly NotificationRecord[] {
    const active = records.filter(
      (record) => record.channel === "toast" && record.dismissedAt === null,
    );
    if (active.length <= maxVisible) {
      return records;
    }
    // Release oldest first; publish only after every overflow transition is complete.
    const dismissed = new Map(
      active
        .slice(maxVisible)
        .reverse()
        .map((record) => [record.id, dismissRecord(record)]),
    );
    return records.map((record) => dismissed.get(record.id) ?? record);
  }

  function tryNative(record: NotificationRecord): boolean {
    if (!renderer?.capabilities?.notifications) {
      return false;
    }
    try {
      return renderer.triggerNotification(record.description ?? record.title, record.title);
    } catch {
      return false;
    }
  }

  function deliver(id: string): void {
    const record = snapshot.find((record) => record.id === id);
    const entry = entries.get(id);
    if (!renderer || !record || !entry || record.channel !== null || record.dismissedAt !== null) {
      return;
    }
    const wantsNative =
      record.delivery === "native" || (record.delivery === "auto" && terminalFocused !== true);
    const channel = wantsNative && tryNative(record) ? "native" : "toast";
    const delivered: NotificationRecord = { ...record, channel, deliveredAt: Date.now() };
    if (channel === "native") {
      release(id);
    } else {
      schedule(id, entry);
    }
    publish(enforceVisibleLimit(snapshot.map((record) => (record.id === id ? delivered : record))));
  }

  function createNotification(title: string, options: NotificationOptions = {}): string {
    const duration = options.duration ?? 5_000;
    validateDuration(duration);
    const record: NotificationRecord = Object.freeze({
      id: crypto.randomUUID(),
      title,
      description: options.description,
      variant: options.variant ?? "default",
      delivery: options.delivery ?? "auto",
      channel: null,
      createdAt: Date.now(),
      deliveredAt: null,
      dismissedAt: null,
    });
    const action = options.action;
    entries.set(record.id, {
      duration,
      remaining: duration,
      action: action ? Object.freeze({ label: action.label, onPress: action.onPress }) : undefined,
      startedAt: 0,
      hovered: false,
    });
    const records = [record, ...snapshot];
    for (const evicted of records.slice(maxHistory)) {
      release(evicted.id);
    }
    publish(records.slice(0, maxHistory));
    deliver(record.id);
    return record.id;
  }

  function dismiss(id: string): void {
    const record = snapshot.find((record) => record.id === id);
    if (!record || record.dismissedAt !== null || record.channel === "native") {
      return;
    }
    const dismissed = dismissRecord(record);
    publish(snapshot.map((record) => (record.id === id ? dismissed : record)));
  }

  function clear(id: string): void {
    if (!snapshot.some((record) => record.id === id)) {
      return;
    }
    release(id);
    publish(snapshot.filter((record) => record.id !== id));
  }

  function clearAll(): void {
    if (snapshot.length === 0) {
      return;
    }
    for (const id of entries.keys()) {
      release(id);
    }
    publish([]);
  }

  function getSnapshot(): readonly NotificationRecord[] {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return function unsubscribe(): void {
      listeners.delete(listener);
    };
  }

  function setMaxVisible(limit: number): void {
    validateLimit(limit, "maxVisible");
    maxVisible = limit;
    const records = enforceVisibleLimit(snapshot);
    if (records !== snapshot) {
      publish(records);
    }
  }

  function setHovered(id: string, hovered: boolean): void {
    const entry = entries.get(id);
    const record = snapshot.find((record) => record.id === id);
    if (!renderer || !entry || record?.channel !== "toast" || entry.hovered === hovered) {
      return;
    }
    entry.hovered = hovered;
    if (hovered) {
      pause(entry);
    } else {
      schedule(id, entry);
    }
  }

  function connect(
    nextRenderer: CliRenderer,
    limit: number,
    nextClock: Clock = new SystemClock(),
  ): () => void {
    validateLimit(limit, "maxVisible");
    if (renderer) {
      throw new Error("Notification store already has a connected Toaster");
    }
    renderer = nextRenderer;
    clock = nextClock;
    terminalFocused = null;
    function onFocus(): void {
      terminalFocused = true;
    }
    function onBlur(): void {
      terminalFocused = false;
    }
    nextRenderer.on(CliRenderEvents.FOCUS, onFocus);
    nextRenderer.on(CliRenderEvents.BLUR, onBlur);
    function disconnect(): void {
      if (currentDisconnect !== disconnect) {
        return;
      }
      for (const entry of entries.values()) {
        pause(entry);
        entry.hovered = false;
      }
      nextRenderer.off(CliRenderEvents.FOCUS, onFocus);
      nextRenderer.off(CliRenderEvents.BLUR, onBlur);
      renderer = undefined;
      terminalFocused = null;
      currentDisconnect = undefined;
    }
    currentDisconnect = disconnect;
    setMaxVisible(limit);
    for (const record of [...snapshot].reverse()) {
      if (currentDisconnect !== disconnect) {
        break;
      }
      if (record.channel === null) {
        deliver(record.id);
      } else if (record.channel === "toast") {
        const entry = entries.get(record.id);
        if (entry) {
          schedule(record.id, entry);
        }
      }
    }
    return disconnect;
  }

  const store = Object.assign(createNotification, {
    dismiss,
    clear,
    clearAll,
    getSnapshot,
    subscribe,
  });
  controllers.set(store, {
    connect,
    setMaxVisible,
    setHovered,
    getAction: (id) => entries.get(id)?.action,
  });
  return store;
}

export const notify: NotificationStore = createNotificationStore();

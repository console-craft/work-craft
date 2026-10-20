import { expect, spyOn, test } from "bun:test";

import { CliRenderEvents } from "@opentui/core";
import { createTestRenderer, ManualClock, setRendererCapabilities } from "@opentui/core/testing";

import * as notifications from "@/ui/notifications";
import type { NotificationStore } from "@/ui/notifications";

const { createNotificationStore, notify } = notifications;

function controller(notify: NotificationStore) {
  expect(notifications.getNotificationStoreController).toBeFunction();
  return notifications.getNotificationStoreController(notify);
}

test("retains dismissed records, bounds history, and publishes immutable snapshots", () => {
  const notify = createNotificationStore({ maxHistory: 2 });
  let changes = 0;
  const unsubscribe = notify.subscribe(() => {
    changes += 1;
  });
  const first = notify("First", { duration: 0 });
  const original = notify.getSnapshot();
  expect(original).toHaveLength(1);
  expect(notify.getSnapshot()).toBe(original);
  expect(Object.isFrozen(original)).toBe(true);
  expect(Object.isFrozen(original[0])).toBe(true);
  notify.dismiss(first);
  expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
  expect(original[0]!.dismissedAt).toBeNull();
  const second = notify("Second");
  const third = notify("Third");
  expect(notify.getSnapshot().map((record) => record.id)).toEqual([third, second]);
  const beforeUnsubscribe = changes;
  unsubscribe();
  notify.clear(third);
  expect(changes).toBe(beforeUnsubscribe);
  expect(notify.getSnapshot().map((record) => record.id)).toEqual([second]);
  notify.clearAll();
  expect(notify.getSnapshot()).toEqual([]);
});

test("rejects invalid limits and durations before mutation", () => {
  for (const maxHistory of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createNotificationStore({ maxHistory })).toThrow(RangeError);
  }
  const notify = createNotificationStore({ maxHistory: 1 });
  notify("Retained");
  const original = notify.getSnapshot();
  let changes = 0;
  notify.subscribe(() => {
    changes += 1;
  });
  for (const duration of [-1, NaN, Infinity, -Infinity]) {
    expect(() => notify("Invalid", { duration })).toThrow(RangeError);
  }
  expect(notify.getSnapshot()).toBe(original);
  expect(changes).toBe(0);
  expect(notify.getSnapshot()[0]!.title).toBe("Retained");
  const emptyNotify = createNotificationStore();
  expect(() => emptyNotify("Invalid", { duration: -1 })).toThrow(RangeError);
  expect(emptyNotify.getSnapshot()).toEqual([]);
});

test("creates distinct pending records with default metadata", () => {
  const notify = createNotificationStore();
  const empty = notify.getSnapshot();
  expect(Object.isFrozen(empty)).toBe(true);
  expect(notify.getSnapshot()).toBe(empty);
  const before = Date.now();
  const first = notify("First");
  const second = notify("Second", { duration: 0.5 });
  const after = Date.now();
  expect(first).toBeString();
  expect(second).not.toBe(first);
  expect(notify.getSnapshot().map((record) => record.id)).toEqual([second, first]);
  expect(notify.getSnapshot()[1]).toEqual({
    id: first,
    title: "First",
    description: undefined,
    variant: "default",
    delivery: "auto",
    channel: null,
    createdAt: expect.any(Number),
    deliveredAt: null,
    dismissedAt: null,
  });
  for (const record of notify.getSnapshot()) {
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(after);
  }
});

test("copies notification metadata without exposing runtime options or actions", () => {
  const notify = createNotificationStore();
  let presses = 0;
  const options = {
    description: "Original body",
    variant: "warning" as const,
    delivery: "native" as const,
    duration: 0,
    action: {
      label: "Open",
      onPress() {
        presses += 1;
      },
    },
  };
  notify("Warning", options);
  options.description = "Changed body";
  options.action.label = "Changed action";
  expect(notify.getSnapshot()).toHaveLength(1);
  const record = notify.getSnapshot()[0]!;
  expect(record.title).toBe("Warning");
  expect(record.description).toBe("Original body");
  expect(record.variant).toBe("warning");
  expect(record.delivery).toBe("native");
  expect(record).not.toHaveProperty("action");
  expect(record).not.toHaveProperty("duration");
  expect(record).not.toHaveProperty("remaining");
  expect(presses).toBe(0);
});

test("cancels pending delivery once while retaining its undelivered history", () => {
  const notify = createNotificationStore();
  const id = notify("Pending", { delivery: "toast", duration: 0 });
  const original = notify.getSnapshot();
  let changes = 0;
  notify.subscribe(() => {
    changes += 1;
  });
  const before = Date.now();
  notify.dismiss(id);
  const cancelled = notify.getSnapshot();
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]!.dismissedAt).toBeGreaterThanOrEqual(before);
  expect(cancelled[0]!.dismissedAt).toBeLessThanOrEqual(Date.now());
  expect(cancelled[0]!.channel).toBeNull();
  expect(cancelled[0]!.deliveredAt).toBeNull();
  expect(original[0]!.dismissedAt).toBeNull();
  expect(cancelled).not.toBe(original);
  notify.dismiss(id);
  expect(notify.getSnapshot()).toBe(cancelled);
  expect(changes).toBe(1);
});

test("missing and evicted IDs leave snapshots and subscriptions unchanged", () => {
  const notify = createNotificationStore({ maxHistory: 1 });
  const evicted = notify("Evicted");
  notify("Retained");
  const original = notify.getSnapshot();
  expect(original.map((record) => record.title)).toEqual(["Retained"]);
  let changes = 0;
  notify.subscribe(() => {
    changes += 1;
  });
  for (const id of ["missing", evicted]) {
    notify.dismiss(id);
    notify.clear(id);
  }
  expect(notify.getSnapshot()).toBe(original);
  expect(changes).toBe(0);
});

test("publishes new history before notifying every subscribed listener", () => {
  const notify = createNotificationStore();
  const observed: string[][] = [];
  const unsubscribe = notify.subscribe(() => {
    observed.push(notify.getSnapshot().map((record) => record.title));
  });
  let otherChanges = 0;
  notify.subscribe(() => {
    otherChanges += 1;
  });
  const first = notify("First");
  const second = notify("Second");
  notify.clear(first);
  unsubscribe();
  unsubscribe();
  notify.dismiss(second);
  notify.clearAll();
  expect(observed).toEqual([["First"], ["Second", "First"], ["Second"]]);
  expect(otherChanges).toBe(5);
});

test("clearAll removes pending and dismissed records without mutating old snapshots", () => {
  const notify = createNotificationStore();
  const dismissed = notify("Dismissed");
  const pending = notify("Pending");
  notify.dismiss(dismissed);
  const original = notify.getSnapshot();
  let changes = 0;
  notify.subscribe(() => {
    changes += 1;
  });
  notify.clearAll();
  const empty = notify.getSnapshot();
  expect(empty).toEqual([]);
  expect(Object.isFrozen(empty)).toBe(true);
  expect(original.map((record) => record.title)).toEqual(["Pending", "Dismissed"]);
  notify.clearAll();
  notify.dismiss(pending);
  notify.clear(dismissed);
  expect(notify.getSnapshot()).toBe(empty);
  expect(changes).toBe(1);
  notify("New pending");
  expect(notify.getSnapshot().map((record) => record.title)).toEqual(["New pending"]);
});

test("default history retention evicts the oldest record after 100 creations", () => {
  const notify = createNotificationStore();
  const oldest = notify("Oldest");
  for (let index = 1; index <= 100; index += 1) {
    notify(`Notification ${index}`);
  }
  const records = notify.getSnapshot();
  expect(records).toHaveLength(100);
  expect(records[0]!.title).toBe("Notification 100");
  expect(records[99]!.title).toBe("Notification 1");
  expect(records.some((record) => record.id === oldest)).toBe(false);
});

test("factory stores have independent history and subscriptions from the default store", () => {
  const firstNotify = createNotificationStore();
  const secondNotify = createNotificationStore();
  const originalSecond = secondNotify.getSnapshot();
  const originalDefault = notify.getSnapshot();
  let changes = 0;
  secondNotify.subscribe(() => {
    changes += 1;
  });
  const id = firstNotify("Isolated");
  expect(firstNotify.getSnapshot().map((record) => record.id)).toEqual([id]);
  secondNotify.dismiss(id);
  secondNotify.clear(id);
  firstNotify.clearAll();
  expect(secondNotify.getSnapshot()).toBe(originalSecond);
  expect(notify.getSnapshot()).toBe(originalDefault);
  expect(changes).toBe(0);
  const defaultId = notify("Default");
  try {
    expect(notify.getSnapshot()[0]!.id).toBe(defaultId);
    expect(firstNotify.getSnapshot()).toEqual([]);
    expect(secondNotify.getSnapshot()).toBe(originalSecond);
  } finally {
    notify.clear(defaultId);
  }
});

test.each([
  ["auto", "focused", "toast"],
  ["auto", "blurred", "native"],
  ["auto", "unknown", "native"],
  ["toast", "focused", "toast"],
  ["toast", "blurred", "toast"],
  ["toast", "unknown", "toast"],
  ["native", "focused", "native"],
  ["native", "blurred", "native"],
  ["native", "unknown", "native"],
] as const)("%s delivery while %s selects %s once", async (delivery, focus, channel) => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  const clock = new ManualClock();
  const send = spyOn(renderer, "triggerNotification").mockReturnValue(true);
  let disconnect = () => {};
  try {
    setRendererCapabilities(renderer, { notifications: true });
    const control = controller(notify);
    disconnect = control.connect(renderer, 3, clock);
    if (focus !== "unknown") {
      renderer.emit(focus === "focused" ? CliRenderEvents.FOCUS : CliRenderEvents.BLUR);
    }
    const before = Date.now();
    const id = notify("Build finished", { delivery, description: "No errors", duration: 0 });
    expect(notify.getSnapshot()).toHaveLength(1);
    expect(notify.getSnapshot()[0]!.channel).toBe(channel);
    expect(notify.getSnapshot()[0]!.deliveredAt).toBeGreaterThanOrEqual(before);
    expect(notify.getSnapshot()[0]!.deliveredAt).toBeLessThanOrEqual(Date.now());
    if (channel === "native") {
      expect(send).toHaveBeenCalledWith("No errors", "Build finished");
      notify.dismiss(id);
      expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    }
    const delivered = notify.getSnapshot();
    renderer.emit(CliRenderEvents.FOCUS);
    renderer.emit(CliRenderEvents.BLUR);
    setRendererCapabilities(renderer, { notifications: false });
    renderer.emit(CliRenderEvents.CAPABILITIES, renderer.capabilities);
    setRendererCapabilities(renderer, { notifications: true });
    renderer.emit(CliRenderEvents.CAPABILITIES, renderer.capabilities);
    expect(notify.getSnapshot()).toBe(delivered);
    expect(send).toHaveBeenCalledTimes(channel === "native" ? 1 : 0);
  } finally {
    disconnect();
    send.mockRestore();
    renderer.destroy();
  }
});

test.each(["unsupported", "false", "throw"] as const)(
  "native %s falls back to one actionable toast",
  async (failure) => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 });
    const notify = createNotificationStore();
    const clock = new ManualClock();
    const send = spyOn(renderer, "triggerNotification").mockImplementation(() => {
      if (failure === "throw") {
        throw new Error("Terminal refused");
      }
      return false;
    });
    let disconnect = () => {};
    try {
      setRendererCapabilities(renderer, { notifications: failure !== "unsupported" });
      const control = controller(notify);
      disconnect = control.connect(renderer, 3, clock);
      const action = { label: "Open", onPress() {} };
      const id = notify("Fallback", { delivery: "native", duration: 100, action });
      expect(notify.getSnapshot()).toHaveLength(1);
      expect(notify.getSnapshot()[0]!.channel).toBe("toast");
      expect(control.getAction(id)?.label).toBe("Open");
      expect(send).toHaveBeenCalledTimes(failure === "unsupported" ? 0 : 1);
      if (failure !== "unsupported") {
        expect(send).toHaveBeenCalledWith("Fallback", "Fallback");
      }
      clock.advance(100);
      expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
      expect(control.getAction(id)).toBeUndefined();
    } finally {
      disconnect();
      send.mockRestore();
      renderer.destroy();
    }
  },
);

test.each(["dismiss", "clear", "clearAll", "evict"] as const)(
  "%s of pending records prevents later native delivery and releases actions",
  async (operation) => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 });
    const notify = createNotificationStore({ maxHistory: 1 });
    const send = spyOn(renderer, "triggerNotification").mockReturnValue(true);
    let disconnect = () => {};
    try {
      const control = controller(notify);
      const id = notify("Cancelled", { action: { label: "Open", onPress() {} } });
      expect(control.getAction(id)?.label).toBe("Open");
      if (operation === "evict") {
        notify("Retained", { delivery: "toast", duration: 0 });
      } else if (operation === "clearAll") {
        notify.clearAll();
      } else {
        notify[operation](id);
      }
      expect(control.getAction(id)).toBeUndefined();
      setRendererCapabilities(renderer, { notifications: true });
      const clock = new ManualClock();
      disconnect = control.connect(renderer, 3, clock);
      clock.advance(10_000);
      expect(send).not.toHaveBeenCalled();
      if (operation === "dismiss") {
        expect(notify.getSnapshot()[0]!.channel).toBeNull();
        expect(notify.getSnapshot()[0]!.deliveredAt).toBeNull();
        expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
      } else {
        expect(notify.getSnapshot().some((record) => record.id === id)).toBe(false);
      }
    } finally {
      disconnect();
      send.mockRestore();
      renderer.destroy();
    }
  },
);

test("pending delivery is oldest-first and publishes fully consistent overflow state", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  let disconnect = () => {};
  try {
    const control = controller(notify);
    const ids = ["First", "Second", "Third"].map((title) =>
      notify(title, { delivery: "toast", duration: 0, action: { label: title, onPress() {} } }),
    );
    const observed: string[] = [];
    notify.subscribe(() => {
      const records = notify.getSnapshot();
      const active = records.filter(
        (record) => record.channel === "toast" && record.dismissedAt === null,
      );
      expect(active.length).toBeLessThanOrEqual(2);
      for (const record of records) {
        if (record.dismissedAt !== null) {
          expect(control.getAction(record.id)).toBeUndefined();
        }
        if (record.channel !== null && !observed.includes(record.title)) {
          observed.push(record.title);
        }
      }
    });
    disconnect = control.connect(renderer, 2, new ManualClock());
    expect(observed).toEqual(["First", "Second", "Third"]);
    expect(notify.getSnapshot().map((record) => record.id)).toEqual([...ids].reverse());
    expect(notify.getSnapshot()[2]!.dismissedAt).not.toBeNull();
    expect(control.getAction(ids[0]!)).toBeUndefined();
    control.setMaxVisible(1);
    expect(notify.getSnapshot()[1]!.dismissedAt).not.toBeNull();
    expect(control.getAction(ids[1]!)).toBeUndefined();
    notify.dismiss(ids[2]!);
    expect(notify.getSnapshot().every((record) => record.dismissedAt !== null)).toBe(true);
  } finally {
    disconnect();
    renderer.destroy();
  }
});

test("options and action copies survive caller mutation until default expiry", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  let disconnect = () => {};
  try {
    const control = controller(notify);
    let presses = 0;
    const options = {
      delivery: "toast" as const,
      description: "Original",
      action: {
        label: "Open",
        onPress() {
          presses += 1;
        },
      },
    };
    const id = notify("Copied", options);
    options.description = "Changed";
    options.action.label = "Changed";
    options.action.onPress = () => {
      presses += 100;
    };
    const clock = new ManualClock();
    clock.advance(20_000);
    disconnect = control.connect(renderer, 3, clock);
    expect(notify.getSnapshot()[0]!.description).toBe("Original");
    expect(control.getAction(id)?.label).toBe("Open");
    control.getAction(id)?.onPress();
    expect(presses).toBe(1);
    clock.advance(4_999);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    clock.advance(1);
    expect(notify.getSnapshot()).toHaveLength(1);
    expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
    expect(control.getAction(id)).toBeUndefined();
  } finally {
    disconnect();
    renderer.destroy();
  }
});

test("hover and disconnect preserve remaining duration across clocks and reset hover", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  let disconnect = () => {};
  try {
    const control = controller(notify);
    const clock = new ManualClock();
    disconnect = control.connect(renderer, 3, clock);
    const id = notify("Saved", { delivery: "toast", duration: 100 });
    const deliveredAt = notify.getSnapshot()[0]!.deliveredAt;
    clock.advance(40);
    control.setHovered(id, true);
    control.setHovered(id, true);
    clock.advance(1_000);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    control.setHovered(id, false);
    clock.advance(20);
    control.setHovered(id, false);
    control.setHovered(id, true);
    disconnect();
    clock.advance(1_000);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    const remountClock = new ManualClock();
    disconnect = control.connect(renderer, 3, remountClock);
    clock.advance(10_000);
    remountClock.advance(39);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    expect(notify.getSnapshot()[0]!.deliveredAt).toBe(deliveredAt);
    remountClock.advance(1);
    expect(notify.getSnapshot()).toHaveLength(1);
    expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
  } finally {
    disconnect();
    renderer.destroy();
  }
});

test("persistent and long finite durations do not expire early", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  let disconnect = () => {};
  try {
    const control = controller(notify);
    const clock = new ManualClock();
    disconnect = control.connect(renderer, 3, clock);
    const persistent = notify("Persistent", { delivery: "toast", duration: 0 });
    notify("Long", { delivery: "toast", duration: 2_147_483_657 });
    const fractional = notify("Fractional", { delivery: "toast", duration: 0.5 });
    clock.advance(1);
    expect(
      notify.getSnapshot().find((record) => record.id === fractional)!.dismissedAt,
    ).not.toBeNull();
    clock.advance(2_147_483_646);
    expect(notify.getSnapshot()[1]!.dismissedAt).toBeNull();
    clock.advance(9);
    expect(notify.getSnapshot()[1]!.dismissedAt).toBeNull();
    clock.advance(1);
    expect(notify.getSnapshot()[1]!.dismissedAt).not.toBeNull();
    expect(notify.getSnapshot().find((record) => record.id === persistent)!.dismissedAt).toBeNull();
  } finally {
    disconnect();
    renderer.destroy();
  }
});

test.each(["dismiss", "clear", "clearAll", "evict", "overflow"] as const)(
  "%s releases an active toast action and cancels subsequent expiry changes",
  async (operation) => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 });
    const notify = createNotificationStore({ maxHistory: operation === "evict" ? 1 : 100 });
    let disconnect = () => {};
    try {
      const control = controller(notify);
      const clock = new ManualClock();
      disconnect = control.connect(renderer, operation === "overflow" ? 1 : 3, clock);
      const id = notify("Removed", {
        delivery: "toast",
        duration: 100,
        action: { label: "Open", onPress() {} },
      });
      clock.advance(40);
      if (operation === "evict" || operation === "overflow") {
        notify("Retained", { delivery: "toast", duration: 0 });
      } else if (operation === "clearAll") {
        notify.clearAll();
      } else {
        notify[operation](id);
      }
      expect(control.getAction(id)).toBeUndefined();
      const removed = notify.getSnapshot();
      clock.runAll();
      expect(clock.now()).toBe(40);
      clock.advance(1_000);
      expect(notify.getSnapshot()).toBe(removed);
      control.setHovered(id, true);
      control.setHovered(id, false);
      expect(notify.getSnapshot()).toBe(removed);
    } finally {
      disconnect();
      renderer.destroy();
    }
  },
);

test("connection validates without mutation, rejects duplicates, and ignores stale cleanup", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  let disconnect = () => {};
  try {
    const control = controller(notify);
    const clock = new ManualClock();
    notify("Pending", { delivery: "toast", duration: 100 });
    const pending = notify.getSnapshot();
    const focusListeners = renderer.listenerCount(CliRenderEvents.FOCUS);
    const blurListeners = renderer.listenerCount(CliRenderEvents.BLUR);
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => control.connect(renderer, limit, clock)).toThrow(RangeError);
      expect(() => control.setMaxVisible(limit)).toThrow(RangeError);
    }
    expect(notify.getSnapshot()).toBe(pending);
    expect(renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusListeners);
    disconnect = control.connect(renderer, 3, clock);
    expect(() => control.connect(renderer, 1, new ManualClock())).toThrow();
    clock.advance(40);
    const oldDisconnect = disconnect;
    oldDisconnect();
    oldDisconnect();
    expect(renderer.listenerCount(CliRenderEvents.FOCUS)).toBe(focusListeners);
    expect(renderer.listenerCount(CliRenderEvents.BLUR)).toBe(blurListeners);
    clock.advance(1_000);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    disconnect = control.connect(renderer, 3, clock);
    oldDisconnect();
    clock.advance(59);
    expect(notify.getSnapshot()[0]!.dismissedAt).toBeNull();
    clock.advance(1);
    expect(notify.getSnapshot()[0]!.dismissedAt).not.toBeNull();
  } finally {
    disconnect();
    renderer.destroy();
  }
});

test("remount starts focus unknown, delivers new pending records, and never resends native history", async () => {
  const { renderer } = await createTestRenderer({ width: 80, height: 24 });
  const notify = createNotificationStore();
  const send = spyOn(renderer, "triggerNotification").mockReturnValue(true);
  let disconnect = () => {};
  try {
    const control = controller(notify);
    setRendererCapabilities(renderer, { notifications: true });
    const clock = new ManualClock();
    disconnect = control.connect(renderer, 3, clock);
    const native = notify("Native", { action: { label: "Unused", onPress() {} } });
    expect(control.getAction(native)).toBeUndefined();
    const delivered = notify.getSnapshot()[0]!;
    renderer.emit(CliRenderEvents.FOCUS);
    disconnect();
    renderer.emit(CliRenderEvents.BLUR);
    const pending = notify("Pending");
    expect(notify.getSnapshot()[0]!.channel).toBeNull();
    disconnect = control.connect(renderer, 3, clock);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[1])).toEqual(["Native", "Pending"]);
    expect(notify.getSnapshot().find((record) => record.id === pending)!.channel).toBe("native");
    expect(notify.getSnapshot().find((record) => record.id === native)).toEqual(delivered);
    clock.advance(10_000);
    expect(notify.getSnapshot().every((record) => record.dismissedAt === null)).toBe(true);
  } finally {
    disconnect();
    send.mockRestore();
    renderer.destroy();
  }
});

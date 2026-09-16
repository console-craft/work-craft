import { expect, test } from "bun:test";
import type { WorkCraftClient } from "@work-craft/server/client";
import type { Snapshot } from "@work-craft/server";
import { buildNavigation } from "./navigation.ts";
import { createWorkCraftStore } from "./use-work-craft.ts";

function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: "epoch-a",
    revision: 4,
    sessions: [{ id: "session-1", name: "Main", position: 0 }],
    workspaces: [{ id: "workspace-1", sessionId: "session-1", name: "Work", position: 0 }],
    categories: [
      { workspaceId: "workspace-1", kind: "inbox", title: "Inbox", position: 0 },
      { workspaceId: "workspace-1", kind: "today", title: "Today", position: 1 },
      { workspaceId: "workspace-1", kind: "design", title: "Design", position: 2 },
      {
        workspaceId: "workspace-1",
        kind: "implementation",
        title: "Implementation",
        position: 3,
      },
      {
        workspaceId: "workspace-1",
        kind: "collaboration",
        title: "Collaboration",
        position: 4,
      },
      { workspaceId: "workspace-1", kind: "operations", title: "Operations", position: 5 },
    ],
    projects: [
      {
        id: "project-1",
        workspaceId: "workspace-1",
        category: "implementation",
        name: "Work Craft",
        position: 0,
      },
    ],
    items: [
      {
        id: "item-1",
        projectId: "project-1",
        kind: "surface",
        title: "Ship navigator",
        position: 0,
        data: {},
        provenanceItemId: null,
      },
    ],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
    ...overrides,
  };
}

function fakeClient(replacement: Snapshot): WorkCraftClient & { refreshCount(): number } {
  let refreshes = 0;
  return {
    ensureDaemon: async () => {},
    health: async () => ({ epoch: replacement.epoch, revision: replacement.revision, pid: 1 }),
    snapshot: async () => {
      refreshes += 1;
      return replacement;
    },
    command: async () => ({ ok: true, revision: replacement.revision, result: { id: "id" } }),
    stream: async () => {
      throw new Error("not used");
    },
    streamOnce: async () => ({ type: "snapshot", snapshot: replacement }),
    refreshCount: () => refreshes,
  };
}

test("projects and items appear under each fixed workspace category", () => {
  const tree = buildNavigation(snapshotFixture());
  const categories = tree[0]?.children?.[0]?.children;

  expect(categories?.map((node) => node.label)).toEqual([
    "Inbox",
    "Today",
    "Design",
    "Implementation",
    "Collaboration",
    "Operations",
  ]);
  expect(categories?.[3]?.children?.[0]).toEqual({
    key: "project:project-1",
    kind: "project",
    id: "project-1",
    label: "Work Craft",
    children: [{ key: "item:item-1", kind: "item", id: "item-1", label: "Ship navigator" }],
  });
});

test("a revision gap requests a replacement snapshot", async () => {
  const client = fakeClient(snapshotFixture({ revision: 4 }));
  const store = createWorkCraftStore(client);
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });

  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) });

  expect(store.snapshot()?.revision).toBe(4);
  expect(client.refreshCount()).toBe(1);
});

test("snapshots apply only in order unless the daemon epoch changes", async () => {
  const store = createWorkCraftStore(fakeClient(snapshotFixture()));
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 5 }) });
  await store.apply({
    type: "snapshot",
    snapshot: snapshotFixture({ epoch: "epoch-b", revision: 1 }),
  });

  expect(store.snapshot()?.epoch).toBe("epoch-b");
  expect(store.snapshot()?.revision).toBe(1);
});

test("a failed refresh does not prevent later snapshots", async () => {
  const client = fakeClient(snapshotFixture({ revision: 5 }));
  const replacement = client.snapshot;
  client.snapshot = async () => {
    client.snapshot = replacement;
    throw new Error("refresh failed");
  };
  const store = createWorkCraftStore(client);
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 4 }) });

  await expect(
    store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 6 }) }),
  ).rejects.toThrow("refresh failed");
  await store.apply({ type: "snapshot", snapshot: snapshotFixture({ revision: 5 }) });

  expect(store.snapshot()?.revision).toBe(5);
});

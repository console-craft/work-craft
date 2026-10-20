import type { Snapshot } from "@work-craft/server/client";

export function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: "epoch-a",
    revision: 4,
    sessions: [
      { id: "session-work", name: "Work", position: 0 },
      { id: "session-personal", name: "Personal", position: 1 },
    ],
    workspaces: [
      { id: "workspace-shared", name: "Shared" },
      { id: "workspace-work", name: "Work Only" },
      { id: "workspace-personal", name: "Personal Only" },
    ],
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "workspace-work", position: 1 },
      { sessionId: "session-work", workspaceId: "workspace-shared", position: 0 },
      { sessionId: "session-personal", workspaceId: "workspace-personal", position: 1 },
      { sessionId: "session-personal", workspaceId: "workspace-shared", position: 0 },
    ],
    categories: [
      { workspaceId: "workspace-shared", kind: "inbox", title: "Inbox", position: 0 },
      { workspaceId: "workspace-shared", kind: "today", title: "Today", position: 1 },
      { workspaceId: "workspace-shared", kind: "design", title: "Design", position: 2 },
      {
        workspaceId: "workspace-shared",
        kind: "implementation",
        title: "Implementation",
        position: 3,
      },
      {
        workspaceId: "workspace-shared",
        kind: "collaboration",
        title: "Collaboration",
        position: 4,
      },
      {
        workspaceId: "workspace-shared",
        kind: "operations",
        title: "Operations",
        position: 5,
      },
    ],
    items: [
      {
        id: "root-1",
        workspaceId: "workspace-shared",
        category: "implementation",
        parentId: null,
        kind: "directory",
        title: "Work Craft",
        archived: false,
        data: {
          path: "/work/Work Craft",
          branch: "trunk",
          availability: "available",
          isGitCheckout: true,
          gitCommonDir: "/work/Work Craft/.git",
        },
        position: 0,
      },
      {
        id: "item-1",
        workspaceId: "workspace-shared",
        category: "implementation",
        parentId: "root-1",
        kind: "worktree",
        title: "Ship navigator",
        position: 0,
        archived: false,
        data: { path: "/work/Ship navigator", branch: "feature", availability: "available" },
      },
    ],
    surfaces: [],
    tabs: [],
    panes: [],
    terminalHistories: [],
    ...overrides,
  };
}

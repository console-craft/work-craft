import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCommand } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { createApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import type { DirectoryScan } from "./directories.ts";
import {
  createGenericItem,
  parseWorkItem,
  reconcileDirectoryScan,
  registerDirectory,
  setItemArchived,
} from "./items.ts";
import { normalizeSessionNavigations, readNavigationCatalog } from "./navigation-store.ts";
import { readSnapshot } from "./snapshot.ts";

function fixture() {
  const db = openDatabase(":memory:");
  const sessionId = applyCommand(db, { type: "session.create", name: "Main" }).result.id;
  const workspaceId = applyCommand(db, { type: "workspace.create", sessionId, name: "Work" }).result
    .id;
  const scan: DirectoryScan = {
    path: "/root",
    available: true,
    git: {
      commonDir: "/root/.git",
      primary: { path: "/root", branch: "trunk", available: true },
      branch: "trunk",
      worktrees: [{ path: "/external", branch: "feature", available: true }],
    },
  };
  return { db, workspaceId, scan };
}

function linkedScan(scan: DirectoryScan): DirectoryScan {
  return {
    ...scan,
    path: "/external",
    git: { ...scan.git!, branch: "feature", worktrees: [scan.git!.primary] },
  };
}

test("linked reconciliation uses the primary record and keeps the requested checkout as a child", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const { itemId } = registerDirectory(db, workspaceId, scan);
    const child = readSnapshot(db, "e", 0).items.find((item) => item.parentId === itemId)!;
    const linked = linkedScan(scan);
    linked.git = {
      ...linked.git!,
      branch: "changed",
      primary: { ...scan.git!.primary, available: false, reason: "Primary inaccessible" },
    };
    expect(reconcileDirectoryScan(db, itemId, linked)).toBe(true);
    const after = readSnapshot(db, "e", 0);
    expect(after.items.find((item) => item.id === itemId)?.data).toMatchObject({
      path: "/root",
      branch: "trunk",
      availability: "unavailable",
    });
    expect(after.items.find((item) => item.id === child.id)).toMatchObject({
      parentId: itemId,
      data: { path: "/external", branch: "changed", availability: "available" },
    });
    expect(after.items).toHaveLength(2);
    expect(reconcileDirectoryScan(db, itemId, linked)).toBe(false);
  } finally {
    db.close();
  }
});

test("missing registry is not authoritative empty membership for a known Git group", () => {
  for (const available of [true, false]) {
    const { db, workspaceId, scan } = fixture();
    try {
      const { itemId } = registerDirectory(db, workspaceId, scan);
      const children = readSnapshot(db, "e", 0).items.filter((item) => item.parentId === itemId);
      const failed = { path: scan.path, available, git: null };
      expect(reconcileDirectoryScan(db, itemId, failed)).toBe(true);
      const after = readSnapshot(db, "e", 0);
      expect(after.items.find((item) => item.id === itemId)?.data).toMatchObject({
        branch: "trunk",
        isGitCheckout: true,
        gitCommonDir: "/root/.git",
        availability: available ? "available" : "unavailable",
        discoveryError: expect.any(String),
      });
      expect(after.items.filter((item) => item.parentId === itemId)).toEqual(children);
      expect(reconcileDirectoryScan(db, itemId, failed)).toBe(false);
    } finally {
      db.close();
    }
  }
});

test("reconciliation rejects alien or archived linked sources and preserves group identity", () => {
  for (const change of ["commonDir", "primary", "unknown", "archived", "reparented"]) {
    const { db, workspaceId, scan } = fixture();
    try {
      const { itemId } = registerDirectory(db, workspaceId, scan);
      const child = readSnapshot(db, "e", 0).items.find((item) => item.parentId === itemId)!;
      const linked = linkedScan(scan);
      linked.git!.branch = "alien";
      if (change === "commonDir") {
        linked.git!.commonDir = "/alien/.git";
      } else if (change === "primary") {
        linked.git!.primary = { path: "/alien", branch: null, available: true };
      } else if (change === "unknown") {
        linked.path = "/unknown";
      } else if (change === "archived") {
        setItemArchived(db, child.id, true);
      } else {
        const other = registerDirectory(db, workspaceId, {
          path: "/other",
          available: true,
          git: null,
        });
        db.query("UPDATE items SET parent_id = ? WHERE id = ?").run(other.itemId, child.id);
      }
      const before = readSnapshot(db, "e", 0);
      expect(reconcileDirectoryScan(db, itemId, linked)).toBe(false);
      expect(readSnapshot(db, "e", 0)).toEqual(before);
    } finally {
      db.close();
    }
  }
});

test("a root scan with changed repository identity reports failure without retargeting", () => {
  for (const change of ["commonDir", "primary"]) {
    const { db, workspaceId, scan } = fixture();
    try {
      const { itemId } = registerDirectory(db, workspaceId, scan);
      const before = readSnapshot(db, "e", 0).items;
      const alien = { ...scan, git: { ...scan.git!, branch: "alien" } };
      if (change === "commonDir") {
        alien.git.commonDir = "/alien/.git";
      } else {
        alien.git.primary = { path: "/alien", branch: null, available: true };
      }
      expect(reconcileDirectoryScan(db, itemId, alien)).toBe(true);
      const after = readSnapshot(db, "e", 0).items;
      expect(after.find((item) => item.id === itemId)?.data).toMatchObject({
        branch: "trunk",
        gitCommonDir: "/root/.git",
        discoveryError: expect.stringMatching(/identity|resolution/i),
      });
      expect(after.filter((item) => item.parentId === itemId)).toEqual(
        before.filter((item) => item.parentId === itemId),
      );
      expect(reconcileDirectoryScan(db, itemId, alien)).toBe(false);
    } finally {
      db.close();
    }
  }
});

test("linked-first and reverse registration resolve the requested item", () => {
  for (const linkedFirst of [true, false]) {
    const { db, workspaceId, scan } = fixture();
    try {
      registerDirectory(db, workspaceId, linkedFirst ? linkedScan(scan) : scan);
      const linked = registerDirectory(db, workspaceId, linkedScan(scan));
      const primary = registerDirectory(db, workspaceId, scan);
      expect(linked.itemId).not.toBe(linked.rootItemId);
      expect(primary.itemId).toBe(linked.rootItemId);
      expect(primary.rootItemId).toBe(primary.itemId);
      expect(registerDirectory(db, workspaceId, linkedScan(scan))).toEqual({
        ...linked,
        changed: false,
      });
      const snapshot = readSnapshot(db, "e", 0);
      expect(snapshot.items.filter(({ parentId }) => parentId === null)).toHaveLength(1);
      expect(snapshot.items.filter(({ parentId }) => parentId === primary.itemId)).toHaveLength(1);
      expect(snapshot.items.find(({ id }) => id === primary.itemId)?.data).toMatchObject({
        path: "/root",
        branch: "trunk",
        gitCommonDir: "/root/.git",
      });
      expect(snapshot.items.find(({ id }) => id === linked.itemId)?.data).toMatchObject({
        path: "/external",
        branch: "feature",
      });
      expect(snapshot.surfaces).toEqual([]);
    } finally {
      db.close();
    }
  }
});

test("registration immediately reconciles new children and scopes groups to shared workspaces", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const primary = registerDirectory(db, workspaceId, scan);
    const extraSession = applyCommand(db, { type: "session.create", name: "Other" }).result.id;
    applyCommand(db, { type: "session.workspace.add", sessionId: extraSession, workspaceId });
    const updated = {
      ...scan,
      git: {
        ...scan.git!,
        worktrees: [...scan.git!.worktrees, { path: "/new", branch: null, available: true }],
      },
    };
    const child = registerDirectory(db, workspaceId, {
      ...updated,
      path: "/new",
      git: { ...updated.git, branch: null, worktrees: [scan.git!.primary, ...scan.git!.worktrees] },
    });
    expect(child.rootItemId).toBe(primary.itemId);
    expect(child.itemId).not.toBe(primary.itemId);
    expect(child.changed).toBe(true);
    expect(registerDirectory(db, workspaceId, updated).changed).toBe(false);
    const otherWorkspace = applyCommand(db, {
      type: "workspace.create",
      sessionId: extraSession,
      name: "Independent",
    }).result.id;
    expect(registerDirectory(db, otherWorkspace, scan).rootItemId).not.toBe(primary.itemId);
    const snapshot = readSnapshot(db, "e", 0);
    expect(
      snapshot.sessionWorkspaces.filter((entry) => entry.workspaceId === workspaceId),
    ).toHaveLength(2);
    expect(snapshot.items.filter((item) => item.workspaceId === workspaceId)).toHaveLength(3);
    expect(snapshot.surfaces).toEqual([]);
  } finally {
    db.close();
  }
});

test("archived group or target requires Restore without mutation", () => {
  for (const archiveRoot of [true, false]) {
    const { db, workspaceId, scan } = fixture();
    try {
      const root = registerDirectory(db, workspaceId, scan);
      const child = readSnapshot(db, "e", 0).items.find((item) => item.parentId === root.itemId)!;
      const opened = applyCommand(db, { type: "surface.ensure", itemId: child.id });
      db.query(
        "INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES (?, 0, 2, X'6f6b')",
      ).run(opened.result.paneId!);
      setItemArchived(db, archiveRoot ? root.itemId : child.id, true);
      const before = readSnapshot(db, "e", 0);
      const changedScan = linkedScan(scan);
      changedScan.git!.primary = { ...scan.git!.primary, branch: "changed" };
      expect(() => registerDirectory(db, workspaceId, changedScan)).toThrow(/Restore/);
      expect(readSnapshot(db, "e", 0)).toEqual(before);
    } finally {
      db.close();
    }
  }
});

test("registration rejects identity changes and conflicting path owners without touching history", () => {
  for (const conflict of ["marker", "commonDir", "primary", "plain-child", "foreign-child"]) {
    const { db, workspaceId, scan } = fixture();
    try {
      if (conflict === "plain-child") {
        registerDirectory(db, workspaceId, { path: "/external", available: true, git: null });
      } else if (conflict === "foreign-child") {
        registerDirectory(db, workspaceId, {
          ...scan,
          path: "/other",
          git: {
            ...scan.git!,
            commonDir: "/other/.git",
            primary: { path: "/other", branch: null, available: true },
          },
        });
      } else {
        registerDirectory(db, workspaceId, scan);
      }
      const owner = readSnapshot(db, "e", 0).items[0]!;
      const opened = applyCommand(db, { type: "surface.ensure", itemId: owner.id });
      db.query(
        "INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES (?, 0, 2, X'6f6b')",
      ).run(opened.result.paneId!);
      const before = readSnapshot(db, "e", 0);
      const attempt: DirectoryScan =
        conflict === "marker"
          ? { ...scan, git: null }
          : conflict === "commonDir"
            ? { ...scan, git: { ...scan.git!, commonDir: "/changed/.git" } }
            : conflict === "primary"
              ? {
                  ...scan,
                  git: { ...scan.git!, primary: { path: "/moved", branch: null, available: true } },
                }
              : scan;
      expect(() => registerDirectory(db, workspaceId, attempt)).toThrow(
        /identity|conflict|resolution/i,
      );
      expect(readSnapshot(db, "e", 0)).toEqual(before);
    } finally {
      db.close();
    }
  }
});

for (const ownerKind of ["plain", "other group"] as const) {
  for (const archived of [false, true]) {
    test(`reconciliation contains ${archived ? "archived" : "active"} ${ownerKind} path-owner conflict without changing membership or history`, () => {
      const { db, workspaceId, scan } = fixture();
      try {
        const root = registerDirectory(db, workspaceId, scan);
        const owner = registerDirectory(
          db,
          workspaceId,
          ownerKind === "plain"
            ? { path: "/conflict", available: true, git: null }
            : {
                path: "/other",
                available: true,
                git: {
                  commonDir: "/other/.git",
                  primary: { path: "/other", branch: "other", available: true },
                  branch: "other",
                  worktrees: [{ path: "/conflict", branch: "owned", available: true }],
                },
              },
        );
        const opened = applyCommand(db, { type: "surface.ensure", itemId: owner.itemId });
        db.query(
          "INSERT INTO terminal_chunks (pane_id, cursor_start, cursor_end, data) VALUES (?, 0, 2, X'6f6b')",
        ).run(opened.result.paneId!);
        const conflictOwner = readSnapshot(db, "e", 0).items.find(
          (item) => item.kind !== "generic" && item.data.path === "/conflict",
        )!;
        setItemArchived(db, conflictOwner.id, archived);
        const before = readSnapshot(db, "e", 0);
        const conflict = {
          ...scan,
          git: { ...scan.git!, worktrees: [{ path: "/conflict", branch: "new", available: true }] },
        };
        expect(reconcileDirectoryScan(db, root.itemId, conflict)).toBe(true);
        const after = readSnapshot(db, "e", 0);
        expect(after.items.find((item) => item.id === root.itemId)?.data).toMatchObject({
          discoveryError: expect.stringMatching(/path.*conflict.*explicit resolution/i),
        });
        expect(after.items.filter((item) => item.id !== root.itemId)).toEqual(
          before.items.filter((item) => item.id !== root.itemId),
        );
        expect(after.surfaces).toEqual(before.surfaces);
        expect(after.panes).toEqual(before.panes);
        expect(after.terminalHistories).toEqual(before.terminalHistories);
        expect(reconcileDirectoryScan(db, root.itemId, conflict)).toBe(false);
      } finally {
        db.close();
      }
    });
  }
}

test("failed discovery and a missing workspace cannot create registration records", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    expect(() =>
      registerDirectory(db, workspaceId, {
        ...scan,
        git: null,
        discoveryError: "Unsupported repository layout",
      }),
    ).toThrow(/Unsupported repository layout/);
    db.transaction(() => {
      const before = readNavigationCatalog(db);
      db.query("DELETE FROM session_workspaces WHERE workspace_id = ?").run(workspaceId);
      db.query("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
      normalizeSessionNavigations(db, before);
    })();
    expect(() => registerDirectory(db, workspaceId, scan)).toThrow(/workspace/);
    expect(readSnapshot(db, "e", 0).items).toEqual([]);
  } finally {
    db.close();
  }
});

test("a trusted linked registration retains an unavailable primary instead of promoting the child", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const linked = linkedScan(scan);
    const primary = { ...scan.git!.primary, available: false, reason: "Primary is inaccessible" };
    linked.git = { ...linked.git!, primary, worktrees: [primary] };
    const registered = registerDirectory(db, workspaceId, linked);
    const snapshot = readSnapshot(db, "e", 0);
    expect(snapshot.items.find((item) => item.id === registered.rootItemId)).toMatchObject({
      kind: "directory",
      parentId: null,
      data: { path: "/root", availability: "unavailable", branch: "trunk" },
    });
    expect(snapshot.items.find((item) => item.id === registered.itemId)).toMatchObject({
      kind: "worktree",
      parentId: registered.rootItemId,
      data: { path: "/external", availability: "available" },
    });
    expect(registerDirectory(db, workspaceId, linked).changed).toBe(false);
    expect(snapshot.surfaces).toEqual([]);
  } finally {
    db.close();
  }
});

test("directory roots and discovered children directly own unique surfaces and no-op revisions", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const root = registerDirectory(db, workspaceId, scan);
    expect(root.changed).toBe(true);
    expect(registerDirectory(db, workspaceId, scan)).toEqual({
      itemId: root.itemId,
      rootItemId: root.itemId,
      changed: false,
    });
    let snapshot = readSnapshot(db, "epoch", 0);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.surfaces).toEqual([]);
    const child = snapshot.items.find((item) => item.parentId === root.itemId)!;
    const opened = applyCommand(db, { type: "surface.ensure", itemId: root.itemId });
    const childOpened = applyCommand(db, { type: "surface.ensure", itemId: child.id });
    expect(opened.result.surfaceId).not.toBe(childOpened.result.surfaceId);
    expect(opened.changed).toBe(true);
    expect(applyCommand(db, { type: "surface.ensure", itemId: root.itemId })).toMatchObject({
      changed: false,
      result: { surfaceId: opened.result.surfaceId },
    });
    const tab = applyCommand(db, {
      type: "tab.create",
      surfaceId: childOpened.result.surfaceId!,
      title: "New",
    });
    snapshot = readSnapshot(db, "epoch", 0);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.panes.find((pane) => pane.id === opened.result.paneId)?.cwd).toBe("/root");
    expect(snapshot.panes.find((pane) => pane.id === tab.result.paneId)?.cwd).toBe("/external");
    expect(() =>
      applyCommand(db, { type: "surface.ensure", itemId: root.itemId, cwd: "/override" }),
    ).toThrow(/cwd/);
    expect(registerDirectory(db, workspaceId, linkedScan(scan)).itemId).toBe(child.id);
    expect(() =>
      registerDirectory(db, workspaceId, { ...scan, path: "/external", git: null }),
    ).toThrow(/identity|conflict/i);
  } finally {
    db.close();
  }
});

test("archive and scan failure preserve identity metadata surfaces and child archive bits", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const { itemId } = registerDirectory(db, workspaceId, scan);
    const child = readSnapshot(db, "e", 0).items.find((item) => item.parentId === itemId)!;
    const surface = applyCommand(db, { type: "surface.ensure", itemId: child.id });
    expect(
      reconcileDirectoryScan(db, itemId, { ...scan, git: null, discoveryError: "denied" }),
    ).toBe(true);
    expect(readSnapshot(db, "e", 0).items.find((item) => item.id === itemId)?.data).toMatchObject({
      branch: "trunk",
      isGitCheckout: true,
      discoveryError: "denied",
    });
    expect(
      reconcileDirectoryScan(db, itemId, { ...scan, git: null, discoveryError: "denied" }),
    ).toBe(false);
    setItemArchived(db, child.id, true);
    expect(setItemArchived(db, child.id, true).changed).toBe(false);
    setItemArchived(db, itemId, true);
    expect(reconcileDirectoryScan(db, itemId, scan)).toBe(false);
    expect(() => registerDirectory(db, workspaceId, scan)).toThrow(/Restore/);
    expect(() =>
      applyCommand(db, { type: "tab.create", surfaceId: surface.result.surfaceId!, title: "No" }),
    ).toThrow(/archived/);
    setItemArchived(db, itemId, false);
    reconcileDirectoryScan(db, itemId, scan);
    expect(readSnapshot(db, "e", 0).items.find((item) => item.id === child.id)?.archived).toBe(
      true,
    );
    setItemArchived(db, child.id, false);
    reconcileDirectoryScan(db, itemId, { ...scan, git: { ...scan.git!, worktrees: [] } });
    expect(applyCommand(db, { type: "surface.ensure", itemId: child.id }).result.surfaceId).toBe(
      surface.result.surfaceId,
    );
    expect(() =>
      applyCommand(db, { type: "tab.create", surfaceId: surface.result.surfaceId!, title: "No" }),
    ).toThrow(/unavailable/);
  } finally {
    db.close();
  }
});

test("prepared scans revalidate current root path and kind inside their transaction", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const { itemId } = registerDirectory(db, workspaceId, { ...scan, git: null });
    const current = readSnapshot(db, "e", 0).items.find((item) => item.id === itemId)!;
    db.query("UPDATE items SET title = 'renamed', data_json = ? WHERE id = ?").run(
      JSON.stringify({ ...current.data, path: "/renamed" }),
      itemId,
    );
    expect(reconcileDirectoryScan(db, itemId, scan)).toBe(false);
    expect(readSnapshot(db, "e", 0).items).toHaveLength(1);
    expect(readSnapshot(db, "e", 0).items[0]?.data.path).toBe("/renamed");
    db.query(
      "UPDATE items SET category = 'design', kind = 'generic', data_json = '{}' WHERE id = ?",
    ).run(itemId);
    expect(reconcileDirectoryScan(db, itemId, scan)).toBe(false);
    expect(readSnapshot(db, "e", 0).items[0]?.kind).toBe("generic");
  } finally {
    db.close();
  }
});

test("generic hierarchy rejects fabricated Coding kinds invalid ancestry and archived parents", () => {
  const { db, workspaceId } = fixture();
  try {
    const root = createGenericItem(db, {
      type: "item.create",
      workspaceId,
      category: "design",
      title: "Root",
      data: { flag: true },
    });
    const child = createGenericItem(db, {
      type: "item.create",
      workspaceId,
      category: "design",
      parentId: root.itemId,
      title: "Child",
    });
    expect(readSnapshot(db, "e", 0).items.find((item) => item.id === root.itemId)?.data).toEqual({
      flag: true,
    });
    for (const extra of [
      { category: "implementation" },
      { parentId: child.itemId },
      { parentId: root.itemId, category: "today" },
      { workspaceId: "missing" },
      { parentId: "missing" },
    ]) {
      expect(() =>
        createGenericItem(db, {
          type: "item.create",
          workspaceId,
          category: "design",
          title: "No",
          ...extra,
        } as Parameters<typeof createGenericItem>[1]),
      ).toThrow();
    }
    setItemArchived(db, root.itemId, true);
    expect(() =>
      createGenericItem(db, {
        type: "item.create",
        workspaceId,
        category: "design",
        parentId: root.itemId,
        title: "No",
      }),
    ).toThrow();
    expect(() => applyCommand(db, { type: "surface.ensure", itemId: child.itemId })).toThrow(
      /archived/,
    );
    for (const value of [
      null,
      {},
      { ...readSnapshot(db, "e", 0).items[0], kind: "worktree", data: { path: "relative" } },
    ]) {
      expect(() => parseWorkItem(value)).toThrow();
    }
    db.query("UPDATE items SET parent_id = ? WHERE id = ?").run(child.itemId, root.itemId);
    expect(() => readSnapshot(db, "e", 0)).toThrow(/parent|ancestry/);
  } finally {
    db.close();
  }
});

test("unavailable targets cannot create surfaces and a prepared registration is required", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const { itemId } = registerDirectory(db, workspaceId, {
      ...scan,
      available: false,
      reason: "missing",
      git: null,
    });
    expect(() => applyCommand(db, { type: "surface.ensure", itemId })).toThrow(/unavailable/);
    expect(() =>
      applyCommand(db, { type: "directory.register", workspaceId, path: "/root" }),
    ).toThrow(/inspection/);
    expect(readSnapshot(db, "e", 0).surfaces).toEqual([]);
  } finally {
    db.close();
  }
});

test("protocol rejects retired commands kinds discovery payload and invalid fields", () => {
  for (const value of [
    { type: "project.create" },
    { type: "surface.ensureHere" },
    { type: "item.create", workspaceId: "w", category: "implementation", title: "No" },
    { type: "item.create", workspaceId: "w", category: "design", title: "No", kind: "generic" },
    { type: "item.setArchived", itemId: "i", archived: "false" },
  ]) {
    expect(() => parseCommand(value)).toThrow();
  }
  for (const [value, field] of [
    [{ type: "directory.register", workspaceId: "w", path: " " }, "path"],
    [{ type: "item.create", workspaceId: "w", category: "design", title: "" }, "title"],
    [{ type: "session.create", name: "" }, "name"],
  ] as const) {
    try {
      parseCommand(value);
      throw new Error("accepted invalid field");
    } catch (error) {
      expect((error as { field?: string }).field).toBe(field);
    }
  }
});

test("persisted discriminants reject mismatched metadata and nonboolean archival", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    const { itemId } = registerDirectory(db, workspaceId, scan);
    const item = readSnapshot(db, "e", 0).items.find((item) => item.id === itemId)!;
    for (const value of [
      { ...item, title: "invented" },
      { ...item, data: { ...item.data, isGitCheckout: false } },
      { ...item, data: { ...item.data, gitCommonDir: "/bad\0path" } },
    ]) {
      expect(() => parseWorkItem(value)).toThrow();
    }
    db.exec("PRAGMA ignore_check_constraints = ON; UPDATE items SET archived = 2");
    expect(() => readSnapshot(db, "e", 0)).toThrow(/archiv|boolean/i);
  } finally {
    db.close();
  }
});

test("Coding roots and discovered children retain whitespace-only basename bytes", () => {
  const { db, workspaceId, scan } = fixture();
  try {
    for (const basename of ["   ", "\n"]) {
      const path = `/work/${basename}`;
      const root = registerDirectory(db, workspaceId, { path, available: true, git: null });
      expect(readSnapshot(db, "e", 0).items.find((item) => item.id === root.itemId)).toMatchObject({
        title: basename,
        data: { path },
      });
    }
    const root = registerDirectory(db, workspaceId, {
      ...scan,
      git: {
        ...scan.git!,
        worktrees: [
          { path: "/children/   ", branch: "spaces", available: true },
          { path: "/children/\n", branch: null, available: true },
        ],
      },
    });
    const children = readSnapshot(db, "e", 0).items.filter((item) => item.parentId === root.itemId);
    expect(children.map((item) => item.title).sort()).toEqual(["\n", "   "]);
    expect(children.map((item) => item.data.path).sort()).toEqual([
      "/children/\n",
      "/children/   ",
    ]);
    expect(() =>
      createGenericItem(db, { type: "item.create", workspaceId, category: "design", title: "\n" }),
    ).toThrow();
    expect(() =>
      parseWorkItem({ ...children[0], category: "design", kind: "generic", title: "\n", data: {} }),
    ).toThrow();
  } finally {
    db.close();
  }
});

test("concurrent registration reuses IDs without terminals or no-op publications", async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "work-craft-register-")));
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  try {
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    const messages: string[] = [];
    app.subscribe({
      send: (message: string) => {
        messages.push(message);
        return 1;
      },
    } as Bun.ServerWebSocket);
    const command = { type: "directory.register" as const, workspaceId, path };
    const [first, second] = await Promise.all([app.execute(command), app.execute(command)]);
    expect(first.result.itemId).toBe(second.result.itemId);
    expect(app.snapshot().items).toHaveLength(1);
    expect(app.snapshot().surfaces).toEqual([]);
    expect(app.snapshot().panes).toEqual([]);
    expect(messages.filter((message) => JSON.parse(message).type === "snapshot")).toHaveLength(2);
    const revision = app.health().revision;
    expect((await app.execute(command)).revision).toBe(revision);
    expect(messages.filter((message) => JSON.parse(message).type === "snapshot")).toHaveLength(2);
    await app.execute({ type: "item.setArchived", itemId: first.result.id, archived: true });
    await expect(app.execute(command)).rejects.toThrow(/Restore/);
    const archivedRevision = app.health().revision;
    expect(
      (await app.execute({ type: "item.setArchived", itemId: first.result.id, archived: true }))
        .revision,
    ).toBe(archivedRevision);
  } finally {
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("concurrent canonical aliases create one group", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-group-alias-")));
  const primary = join(home, "primary");
  const linked = join(home, "linked");
  const alias = join(home, "alias");
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  try {
    await mkdir(primary);
    for (const args of [
      ["init", "--initial-branch=trunk"],
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=t@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ],
      ["worktree", "add", "-b", "feature", linked],
    ]) {
      expect(Bun.spawnSync(["git", "-C", primary, ...args]).exitCode).toBe(0);
    }
    await symlink(linked, alias);
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    const [child, root, aliased] = await Promise.all(
      [linked, primary, alias].map((path) =>
        app.execute({ type: "directory.register", workspaceId, path }),
      ),
    );
    expect(child!.result.id).toBe(aliased!.result.id);
    expect(child!.result.rootItemId).toBe(root!.result.id);
    expect(child!.result.id).not.toBe(root!.result.id);
    const snapshot = app.snapshot();
    expect(snapshot.revision).toBe(3);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.surfaces).toEqual([]);
    expect(
      (await app.execute({ type: "directory.register", workspaceId, path: alias })).revision,
    ).toBe(snapshot.revision);
  } finally {
    await app.closeDirectoryRefresh();
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("registration rechecks workspace and archive state after awaiting inspection", async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "work-craft-register-commit-")));
  try {
    for (const change of ["workspace", "root", "child"]) {
      const { db, workspaceId, scan } = fixture();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<DirectoryScan>();
      const app = createApp({
        db,
        inspectDirectory: () => {
          entered.resolve();
          return release.promise;
        },
      });
      let pending: Promise<unknown> | undefined;
      try {
        const prepared = linkedScan(scan);
        prepared.path = path;
        const root =
          change === "workspace"
            ? undefined
            : registerDirectory(db, workspaceId, {
                ...scan,
                git: { ...scan.git!, worktrees: [{ path, branch: "feature", available: true }] },
              });
        pending = app.execute({ type: "directory.register", workspaceId, path });
        await entered.promise;
        if (change === "workspace") {
          db.transaction(() => {
            const before = readNavigationCatalog(db);
            db.query("DELETE FROM session_workspaces WHERE workspace_id = ?").run(workspaceId);
            db.query("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
            normalizeSessionNavigations(db, before);
          })();
        } else {
          const id =
            change === "root"
              ? root!.itemId
              : app.snapshot().items.find((item) => item.parentId === root!.itemId)!.id;
          await app.execute({ type: "item.setArchived", itemId: id, archived: true });
        }
        const before = app.snapshot();
        release.resolve(prepared);
        await expect(pending).rejects.toThrow(change === "workspace" ? /workspace/ : /Restore/);
        expect(app.snapshot()).toEqual(before);
      } finally {
        release.resolve(scan);
        await pending?.catch(() => {});
        await app.closeDirectoryRefresh();
        await app.runtime.stopAll();
        await app.history.close();
        db.close();
      }
    }
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("Coding spawn races retain committed owners panes and history", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-cwd-race-")));
  const path = join(home, "target");
  await mkdir(path);
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  try {
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    const itemId = (await app.execute({ type: "directory.register", workspaceId, path })).result.id;
    await rm(path, { recursive: true });
    const opened = await app.execute({ type: "surface.ensure", itemId });
    const pane = app.snapshot().panes.find((pane) => pane.id === opened.result.paneId)!;
    expect(pane).toMatchObject({ cwd: path, processStatus: "failed" });
    app.history.append(pane.id, new TextEncoder().encode("retained"));
    await app.history.flush();
    expect((await app.execute({ type: "surface.ensure", itemId })).result.surfaceId).toBe(
      opened.result.surfaceId,
    );
    expect(app.snapshot().items).toHaveLength(1);
    expect(new TextDecoder().decode(app.history.read(pane.id).data)).toContain("retained");
  } finally {
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("registration races after path validation are operational not field failures", async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "work-craft-registration-race-")));
  const db = openDatabase(":memory:");
  const app = createApp({
    db,
    inspectDirectory: async (canonical) => ({
      path: canonical,
      available: false,
      reason: "Directory became inaccessible",
      git: null,
    }),
  });
  try {
    const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
    const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
      .result.id;
    try {
      await app.execute({ type: "directory.register", workspaceId, path });
      throw new Error("accepted raced registration");
    } catch (error) {
      expect((error as Error).message).toContain("became inaccessible");
      expect((error as { field?: string }).field).toBeUndefined();
    }
    expect(app.snapshot().items).toEqual([]);
  } finally {
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(path, { recursive: true, force: true });
  }
});

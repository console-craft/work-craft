import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerMessage, WorkItem } from "../api/protocol.ts";
import { openDatabase } from "../persistence/database.ts";
import { createApp, type WorkCraftApp } from "./app.ts";
import { type DirectoryScan, inspectDirectory } from "./directories.ts";

const fixtures: { app: WorkCraftApp; close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
  }
});

function git(path: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", path, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(inspect?: typeof inspectDirectory, repository = true) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "work-craft-discovery-")));
  const path = join(home, "root");
  await mkdir(path);
  if (repository) {
    git(path, "init", "--initial-branch=trunk");
    git(path, "commit", "--allow-empty", "-m", "initial");
  }
  const db = openDatabase(":memory:");
  const app = createApp({ db, ...(inspect === undefined ? {} : { inspectDirectory: inspect }) });
  const close = async () => {
    await app.closeDirectoryRefresh?.();
    await app.runtime.stopAll();
    await app.history.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  };
  fixtures.push({ app, close });
  const sessionId = (await app.execute({ type: "session.create", name: "Main" })).result.id;
  const workspaceId = (await app.execute({ type: "workspace.create", sessionId, name: "Work" }))
    .result.id;
  const messages: ServerMessage[] = [];
  app.subscribe({
    send(message: string) {
      messages.push(JSON.parse(message) as ServerMessage);
      return 1;
    },
  } as Bun.ServerWebSocket);
  const register = async (target = path) =>
    (await app.execute({ type: "directory.register", workspaceId, path: target })).result.id;
  return { home, path, db, app, workspaceId, messages, register };
}

function target(app: WorkCraftApp, id: string): Exclude<WorkItem, { kind: "generic" }> {
  const item = app.snapshot().items.find((item) => item.id === id);
  if (item === undefined || item.kind === "generic") {
    throw new Error("Coding item missing");
  }
  return item;
}

test("unchanged scans do not revise or broadcast", async () => {
  const f = await fixture();
  await f.register();
  const revision = f.app.health().revision;
  const count = f.messages.length;
  await f.app.refreshDirectories();
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
  expect(f.messages).toHaveLength(count);
  expect(f.app.snapshot().surfaces).toEqual([]);
});

test("external add remove reappear preserves IDs surfaces and history", async () => {
  const f = await fixture();
  const rootId = await f.register();
  const external = join(f.home, "external tree");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const before = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(before + 1);
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  expect(child).toMatchObject({
    data: { path: external, branch: "feature", availability: "available" },
  });
  const opened = await f.app.execute({ type: "surface.ensure", itemId: child.id });
  const paneId = opened.result.paneId!;
  f.app.history.append(paneId, new TextEncoder().encode("preserved-discovery-history"));
  await f.app.history.flush();
  const cursor = f.app.history.read(paneId).cursor;
  const startedAt = f.app.snapshot().panes.find((pane) => pane.id === paneId)!.startedAt;
  git(f.path, "worktree", "remove", "--force", external);
  await f.app.refreshDirectories();
  expect(target(f.app, child.id).data.availability).toBe("unavailable");
  const unavailableRevision = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(unavailableRevision);
  expect(f.app.runtime.isLive(paneId)).toBe(true);
  expect((await f.app.execute({ type: "surface.ensure", itemId: child.id })).result.surfaceId).toBe(
    opened.result.surfaceId,
  );
  git(f.path, "worktree", "add", external, "feature");
  await f.app.refreshDirectories();
  expect(target(f.app, child.id).data.availability).toBe("available");
  expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toHaveLength(1);
  expect(f.app.runtime.isLive(paneId)).toBe(true);
  expect(f.app.snapshot().panes.find((pane) => pane.id === paneId)?.startedAt).toBe(startedAt);
  expect(f.app.history.read(paneId).cursor).toBeGreaterThanOrEqual(cursor);
  expect(new TextDecoder().decode(f.app.history.read(paneId).data)).toContain(
    "preserved-discovery-history",
  );
  expect(f.messages.filter((message) => message.type === "snapshot").at(-1)).toMatchObject({
    snapshot: {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: child.id,
          data: expect.objectContaining({ availability: "available" }),
        }),
      ]),
    },
  });
});

test("failed scan retains children and last branch", async () => {
  let failed = false;
  const f = await fixture(async (path, signal) =>
    failed
      ? { path, available: true, git: null, discoveryError: "Git permission denied" }
      : inspectDirectory(path, signal),
  );
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const original = f.app.snapshot().items;
  failed = true;
  await f.app.refreshDirectories();
  expect(target(f.app, rootId).data).toMatchObject({
    branch: "trunk",
    discoveryError: "Git permission denied",
  });
  expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toEqual(
    original.filter((item) => item.parentId === rootId),
  );
  const revision = f.app.health().revision;
  const count = f.messages.length;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
  expect(f.messages).toHaveLength(count);
  failed = false;
  git(f.path, "checkout", "-b", "changed");
  await f.app.refreshDirectories();
  expect(target(f.app, rootId).data).toMatchObject({ branch: "changed" });
  expect(target(f.app, rootId).data).not.toHaveProperty("discoveryError");
});

test("unavailable primary uses same-group linked registry without changing runtime owners", async () => {
  const f = await fixture();
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  const opened = await f.app.execute({ type: "surface.ensure", itemId: child.id });
  const paneId = opened.result.paneId!;
  f.app.history.append(paneId, new TextEncoder().encode("fallback-history"));
  await f.app.history.flush();
  const cursor = f.app.history.read(paneId).cursor;
  const panes = f.app.snapshot().panes;
  // Traversal keeps shared Git metadata reachable; the checkout itself cannot be read.
  await chmod(f.path, 0o111);
  try {
    expect((await inspectDirectory(f.path)).available).toBe(false);
    git(external, "checkout", "-b", "changed");
    await f.app.refreshDirectories();
    expect(target(f.app, rootId)).toMatchObject({
      id: rootId,
      kind: "directory",
      data: { path: f.path, branch: "trunk", availability: "unavailable" },
    });
    expect(target(f.app, child.id)).toMatchObject({
      parentId: rootId,
      data: { branch: "changed" },
    });
    expect(f.app.snapshot().panes).toEqual(panes);
    expect(f.app.runtime.isLive(paneId)).toBe(true);
    expect(f.app.history.read(paneId).cursor).toBeGreaterThanOrEqual(cursor);
    expect(target(f.app, rootId).data).not.toHaveProperty("discoveryError");
    const revision = f.app.health().revision;
    await f.app.refreshDirectories();
    expect(f.app.health().revision).toBe(revision);
  } finally {
    await chmod(f.path, 0o755);
  }
});

test("removed Git marker preserves membership and branches once rather than becoming plain", async () => {
  const inspected: string[] = [];
  const f = await fixture((path, signal) => {
    inspected.push(path);
    return inspectDirectory(path, signal);
  });
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const previousChildren = f.app.snapshot().items.filter((item) => item.parentId === rootId);
  await rm(join(f.path, ".git"), { recursive: true });
  inspected.length = 0;
  await f.app.refreshDirectories();
  expect(inspected).toEqual([f.path, external]);
  expect(target(f.app, rootId).data).toMatchObject({
    availability: "available",
    branch: "trunk",
    isGitCheckout: true,
    discoveryError: expect.any(String),
  });
  expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toEqual(
    previousChildren,
  );
  const revision = f.app.health().revision;
  const count = f.messages.length;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
  expect(f.messages).toHaveLength(count);
});

test("fallback rejects an alien child, skips archived probes and stops at the first trusted child", async () => {
  let failed = false;
  const inspected: string[] = [];
  const f = await fixture(async (path, signal) => {
    if (!failed) {
      return inspectDirectory(path, signal);
    }
    inspected.push(path);
    if (path === f.path) {
      return { path, available: false, reason: "unreachable", git: null };
    }
    const scan = await inspectDirectory(path, signal);
    if (path.endsWith("alien")) {
      return { ...scan, git: { ...scan.git!, commonDir: "/alien/.git" } };
    }
    return { ...scan, git: { ...scan.git!, branch: "changed" } };
  });
  for (const name of ["archived", "alien", "trusted", "unused"]) {
    git(f.path, "worktree", "add", "-b", name, join(f.home, name));
  }
  const rootId = await f.register();
  const children = f.app.snapshot().items.filter((item) => item.parentId === rootId);
  const archived = children.find((item) => item.data.path === join(f.home, "archived"))!;
  await f.app.execute({ type: "item.setArchived", itemId: archived.id, archived: true });
  failed = true;
  await f.app.refreshDirectories();
  expect(inspected).toEqual([f.path, join(f.home, "alien"), join(f.home, "trusted")]);
  const trusted = children.find((item) => item.data.path === join(f.home, "trusted"))!;
  expect(target(f.app, trusted.id).data.branch).toBe("changed");
  expect(target(f.app, archived.id)).toMatchObject({
    archived: true,
    data: { branch: "archived" },
  });
  expect(target(f.app, rootId).data).toMatchObject({
    gitCommonDir: join(f.path, ".git"),
    branch: "trunk",
  });
});

test("a surviving fallback discovers moved children and preserves IDs when paths reappear", async () => {
  let failed = false;
  const f = await fixture((path, signal) =>
    failed && path === f.path
      ? Promise.resolve({ path, available: false, reason: "Primary unreachable", git: null })
      : inspectDirectory(path, signal),
  );
  const old = join(f.home, "old");
  const moved = join(f.home, "moved");
  git(f.path, "worktree", "add", "-b", "feature", old);
  git(f.path, "worktree", "add", "-b", "survivor", join(f.home, "survivor"));
  const rootId = await f.register();
  const original = f.app.snapshot().items.find((item) => item.data.path === old)!;
  failed = true;
  git(f.path, "worktree", "move", old, moved);
  await f.app.refreshDirectories();
  const current = f.app.snapshot().items.find((item) => item.data.path === moved)!;
  expect(current.id).not.toBe(original.id);
  expect(current.parentId).toBe(rootId);
  expect(target(f.app, original.id).data.availability).toBe("unavailable");
  git(f.path, "worktree", "move", moved, old);
  await f.app.refreshDirectories();
  expect(target(f.app, original.id).data.availability).toBe("available");
  expect(target(f.app, current.id).data.availability).toBe("unavailable");
  expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toHaveLength(3);
  const revision = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
});

test("registration shares a pending fallback probe and does not publish a stale second write", async () => {
  let failed = false;
  let probes = 0;
  const entered = deferred<void>();
  const release = deferred<DirectoryScan>();
  const f = await fixture((path, signal) => {
    if (!failed) {
      return inspectDirectory(path, signal);
    }
    if (path === f.path) {
      return Promise.resolve({ path, available: false, reason: "Primary unreachable", git: null });
    }
    probes += 1;
    entered.resolve();
    return release.promise;
  });
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  git(external, "checkout", "-b", "changed");
  const prepared = await inspectDirectory(external);
  failed = true;
  const registration = f.register(external);
  let pass: Promise<void> | undefined;
  try {
    await Promise.race([
      entered.promise,
      Bun.sleep(300).then(() => {
        throw new Error("Fallback was not started");
      }),
    ]);
    pass = f.app.refreshDirectories();
    // Drain the root's promise continuations while the linked probe stays blocked.
    await Bun.sleep(0);
    const revision = f.app.health().revision;
    const count = f.messages.length;
    release.resolve(prepared);
    await pass;
    expect(await registration).toBe(child.id);
    expect(probes).toBe(1);
    expect(f.app.health().revision).toBe(revision + 1);
    expect(f.messages).toHaveLength(count + 1);
    expect(target(f.app, child.id).data.branch).toBe("changed");
    expect(f.app.snapshot().items).toHaveLength(2);
  } finally {
    release.resolve(prepared);
    await pass;
    await registration;
  }
});

for (const change of ["archive", "path", "commonDir"]) {
  test(`identity change during root scan (${change}) does not retarget the group or start fallback`, async () => {
    let hold = false;
    const entered = deferred<void>();
    const release = deferred<DirectoryScan>();
    const inspected: string[] = [];
    const f = await fixture((path, signal) => {
      inspected.push(path);
      if (hold) {
        entered.resolve();
        return release.promise;
      }
      return inspectDirectory(path, signal);
    });
    git(f.path, "worktree", "add", "-b", "feature", join(f.home, "child"));
    const rootId = await f.register();
    hold = true;
    inspected.length = 0;
    const pass = f.app.refreshDirectories();
    try {
      await entered.promise;
      if (change === "archive") {
        await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: true });
      } else {
        const data = target(f.app, rootId).data;
        f.db.query("UPDATE items SET title = ?, data_json = ? WHERE id = ?").run(
          change === "path" ? "moved" : "root",
          JSON.stringify({
            ...data,
            ...(change === "path"
              ? { path: join(f.home, "moved") }
              : { gitCommonDir: join(f.home, "different") }),
          }),
          rootId,
        );
      }
      const before = f.app.snapshot();
      release.resolve({ path: f.path, available: false, reason: "gone", git: null });
      await pass;
      expect(f.app.snapshot()).toEqual(before);
      expect(inspected).toEqual([f.path]);
    } finally {
      release.resolve({ path: f.path, available: false, git: null });
      await pass;
    }
  });
}

for (const change of [
  "root-archive",
  "root-path",
  "root-commonDir",
  "child-archive",
  "child-path",
  "child-parent",
]) {
  test(`fallback revalidates ${change} after its inspection awaits`, async () => {
    let hold = false;
    const entered = deferred<void>();
    const release = deferred<DirectoryScan>();
    const f = await fixture((path, signal) => {
      if (!hold) {
        return inspectDirectory(path, signal);
      }
      if (path === f.path) {
        return Promise.resolve({ path, available: false, reason: "gone", git: null });
      }
      if (path !== join(f.home, "child")) {
        return inspectDirectory(path, signal);
      }
      entered.resolve();
      return release.promise;
    });
    const external = join(f.home, "child");
    git(f.path, "worktree", "add", "-b", "feature", external);
    const rootId = await f.register();
    const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
    const prepared = await inspectDirectory(external);
    prepared.git!.worktrees.push({
      path: join(f.home, "must-not-appear"),
      branch: null,
      available: true,
    });
    let otherId: string | undefined;
    if (change === "child-parent") {
      const other = join(f.home, "other");
      await mkdir(other);
      otherId = await f.register(other);
      await f.app.execute({ type: "item.setArchived", itemId: otherId, archived: true });
    }
    hold = true;
    const pass = f.app.refreshDirectories();
    try {
      await Promise.race([
        entered.promise,
        Bun.sleep(300).then(() => {
          throw new Error("Fallback was not started");
        }),
      ]);
      const id = change.startsWith("root") ? rootId : child.id;
      if (change.endsWith("archive")) {
        await f.app.execute({ type: "item.setArchived", itemId: id, archived: true });
      } else if (change === "child-parent") {
        // Reparenting is a persisted race, not a new fallback source.
        f.db.query("UPDATE items SET parent_id = ? WHERE id = ?").run(otherId!, id);
      } else {
        const data = target(f.app, id).data;
        f.db.query("UPDATE items SET title = ?, data_json = ? WHERE id = ?").run(
          change.endsWith("path") ? "moved" : "root",
          JSON.stringify({
            ...data,
            ...(change.endsWith("path")
              ? { path: join(f.home, "moved") }
              : { gitCommonDir: join(f.home, "different") }),
          }),
          id,
        );
      }
      const before = f.app.snapshot();
      release.resolve(prepared);
      await pass;
      expect(f.app.snapshot().items.filter((item) => item.parentId !== null)).toEqual(
        before.items.filter((item) => item.parentId !== null),
      );
      expect(
        f.app.snapshot().items.some((item) => item.data.path === join(f.home, "must-not-appear")),
      ).toBe(false);
      if (change.startsWith("root")) {
        expect(f.app.snapshot()).toEqual(before);
      }
    } finally {
      release.resolve(prepared);
      await pass;
    }
  });
}

test("archive and restore do not get undone by refresh", async () => {
  const f = await fixture();
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  const opened = await f.app.execute({ type: "surface.ensure", itemId: child.id });
  await f.app.execute({ type: "item.setArchived", itemId: child.id, archived: true });
  await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: true });
  const revision = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
  await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: false });
  await f.app.refreshDirectories();
  expect(target(f.app, child.id).archived).toBe(true);
  await f.app.execute({ type: "item.setArchived", itemId: child.id, archived: false });
  await f.app.refreshDirectories();
  expect((await f.app.execute({ type: "surface.ensure", itemId: child.id })).result.surfaceId).toBe(
    opened.result.surfaceId,
  );
  expect(f.app.runtime.isLive(opened.result.paneId!)).toBe(true);
});

test("archived parent masks descendants without rewriting their own flags", async () => {
  const inspected: string[] = [];
  const f = await fixture((path, signal) => {
    inspected.push(path);
    return inspectDirectory(path, signal);
  });
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: true });
  inspected.length = 0;
  await f.app.refreshDirectories();
  expect(inspected).toEqual([]);
  expect(target(f.app, child.id).archived).toBe(false);
  await expect(f.app.execute({ type: "surface.ensure", itemId: child.id })).rejects.toThrow(
    /archived/,
  );
  expect(f.app.snapshot().surfaces).toEqual([]);
});

test("registration reuses the discovered child and its surface without creating an independent root", async () => {
  const f = await fixture();
  const external = join(f.home, "external");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  const registeredId = await f.register(external);
  const first = await f.app.execute({ type: "surface.ensure", itemId: child.id });
  const second = await f.app.execute({ type: "surface.ensure", itemId: registeredId });
  git(external, "checkout", "--detach");
  await f.app.refreshDirectories();
  expect(registeredId).toBe(child.id);
  expect(first.result.surfaceId).toBe(second.result.surfaceId);
  expect(target(f.app, child.id).data.branch).toBeNull();
  expect(
    f.app.snapshot().items.filter((item) => item.kind !== "generic" && item.data.path === external),
  ).toHaveLength(1);
  expect(f.app.runtime.isLive(first.result.paneId!)).toBe(true);
  expect(f.app.snapshot().panes).toHaveLength(1);
});

test("moved and prunable worktrees retain old identities and stable unavailability", async () => {
  const f = await fixture();
  const old = join(f.home, "old");
  const moved = join(f.home, "moved");
  git(f.path, "worktree", "add", "-b", "feature", old);
  const rootId = await f.register();
  const original = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  git(f.path, "worktree", "move", old, moved);
  await f.app.refreshDirectories();
  const current = f.app
    .snapshot()
    .items.find(
      (item) => item.parentId === rootId && item.kind === "worktree" && item.data.path === moved,
    )!;
  expect(current.id).not.toBe(original.id);
  expect(target(f.app, original.id).data.availability).toBe("unavailable");
  await rm(moved, { recursive: true });
  await f.app.refreshDirectories();
  expect(target(f.app, current.id).data.availability).toBe("unavailable");
  const revision = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
});

test("plain roots refresh availability and remembered paths never follow retargeted symlinks", async () => {
  const f = await fixture(undefined, false);
  const rootId = await f.register();
  const replacement = join(f.home, "replacement");
  await mkdir(replacement);
  await rename(f.path, join(f.home, "original"));
  await symlink(replacement, f.path);
  await f.app.refreshDirectories();
  expect(target(f.app, rootId).data).toMatchObject({
    path: f.path,
    availability: "unavailable",
    isGitCheckout: false,
  });
  expect(f.app.snapshot().items).toHaveLength(1);
  const separate = await f.register(f.path);
  expect(separate).not.toBe(rootId);
  expect(target(f.app, separate).data.path).toBe(replacement);
  await rm(f.path);
  await rename(join(f.home, "original"), f.path);
  await f.app.refreshDirectories();
  expect(target(f.app, rootId).data.availability).toBe("available");
  expect(f.app.snapshot().items.filter((item) => item.parentId !== null)).toEqual([]);
});

test("registration and refresh share a pending root inspection without a stale second write", async () => {
  let hold = false;
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const entered = deferred<void>();
  const release = deferred<DirectoryScan>();
  const f = await fixture(async (path, signal) => {
    calls += 1;
    maximum = Math.max(maximum, ++active);
    try {
      if (hold) {
        entered.resolve();
        return await release.promise;
      }
      return await inspectDirectory(path, signal);
    } finally {
      active -= 1;
    }
  });
  const rootId = await f.register();
  const prepared = await inspectDirectory(f.path);
  git(f.path, "checkout", "-b", "changed");
  hold = true;
  const registration = f.register();
  try {
    await entered.promise;
    const pass = f.app.refreshDirectories();
    expect(f.app.refreshDirectories()).toBe(pass);
    release.resolve({
      ...prepared,
      git: {
        ...prepared.git!,
        branch: "changed",
        primary: { ...prepared.git!.primary, branch: "changed" },
      },
    });
    await pass;
    expect(await registration).toBe(rootId);
    expect(maximum).toBe(1);
    expect(calls).toBe(2);
    expect(target(f.app, rootId).data.branch).toBe("changed");
    expect(f.app.snapshot().items).toHaveLength(1);
  } finally {
    release.resolve(prepared);
    await registration;
  }
});

test("archive while a scan awaits wins without resurrecting newly discovered children", async () => {
  let hold = false;
  const entered = deferred<void>();
  const release = deferred<DirectoryScan>();
  const f = await fixture(async (path, signal) => {
    if (hold) {
      entered.resolve();
      return release.promise;
    }
    return inspectDirectory(path, signal);
  });
  const rootId = await f.register();
  const external = join(f.home, "new-child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const prepared = await inspectDirectory(f.path);
  hold = true;
  const pass = f.app.refreshDirectories();
  try {
    await entered.promise;
    await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: true });
    const revision = f.app.health().revision;
    const count = f.messages.length;
    release.resolve(prepared);
    await pass;
    expect(f.app.health().revision).toBe(revision);
    expect(f.messages).toHaveLength(count);
    expect(f.app.snapshot().items).toHaveLength(1);
    expect(target(f.app, rootId).archived).toBe(true);
    hold = false;
    await f.app.execute({ type: "item.setArchived", itemId: rootId, archived: false });
    await f.app.refreshDirectories();
    expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toHaveLength(1);
  } finally {
    release.resolve(prepared);
    await pass;
  }
});

test("one inspection failure does not prevent unrelated roots from refreshing", async () => {
  let failedPath: string | undefined;
  let active = 0;
  let maximum = 0;
  const f = await fixture(async (path, signal) => {
    maximum = Math.max(maximum, ++active);
    try {
      if (path === failedPath) {
        throw new Error("Inspection failed");
      }
      return await inspectDirectory(path, signal);
    } finally {
      active -= 1;
    }
  });
  const rootId = await f.register();
  const other = join(f.home, "other");
  await mkdir(other);
  const otherId = await f.register(other);
  await rm(other, { recursive: true });
  failedPath = f.path;
  await f.app.refreshDirectories();
  expect(maximum).toBe(1);
  expect(target(f.app, rootId).data).toMatchObject({
    branch: "trunk",
    discoveryError: "Inspection failed",
  });
  expect(target(f.app, otherId).data.availability).toBe("unavailable");
  const revision = f.app.health().revision;
  await f.app.refreshDirectories();
  expect(f.app.health().revision).toBe(revision);
});

for (const archived of [false, true]) {
  test(`discovered path-owner conflict (${archived ? "archived" : "active"}) reports once and does not starve later roots`, async () => {
    const f = await fixture();
    const existing = join(f.home, "existing-child");
    git(f.path, "worktree", "add", "-b", "existing", existing);
    const rootId = await f.register();
    const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
    const opened = await f.app.execute({ type: "surface.ensure", itemId: child.id });
    const paneId = opened.result.paneId!;
    f.app.history.append(paneId, new TextEncoder().encode("conflict-history"));
    await f.app.history.flush();
    const conflictPath = join(f.home, "conflict");
    const laterPath = join(f.home, "later");
    await mkdir(conflictPath);
    await mkdir(laterPath);
    const ownerId = await f.register(conflictPath);
    const laterId = await f.register(laterPath);
    if (archived) {
      await f.app.execute({ type: "item.setArchived", itemId: ownerId, archived: true });
    }
    const before = f.app.snapshot();
    git(f.path, "worktree", "add", "-b", "conflict", conflictPath);
    await rm(laterPath, { recursive: true });
    await f.app.refreshDirectories();
    expect(target(f.app, rootId).data).toMatchObject({
      discoveryError: expect.stringMatching(/path.*conflict.*explicit resolution/i),
    });
    expect(f.app.snapshot().items.find((item) => item.id === ownerId)).toEqual(
      before.items.find((item) => item.id === ownerId),
    );
    expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toEqual(
      before.items.filter((item) => item.parentId === rootId),
    );
    expect(f.app.snapshot().surfaces).toEqual(before.surfaces);
    expect(f.app.runtime.isLive(paneId)).toBe(true);
    expect(new TextDecoder().decode(f.app.history.read(paneId).data)).toContain("conflict-history");
    expect(target(f.app, laterId).data.availability).toBe("unavailable");
    const revision = f.app.health().revision;
    // Live PTY output is independent of discovery's snapshot broadcasts.
    const snapshots = f.messages.filter((message) => message.type === "snapshot").length;
    await f.app.refreshDirectories();
    expect(f.app.health().revision).toBe(revision);
    expect(f.messages.filter((message) => message.type === "snapshot")).toHaveLength(snapshots);
  });
}

test("close cancels a pending pass and awaits cleanup without late database access or publication", async () => {
  let hold = false;
  let signal: AbortSignal | undefined;
  const entered = deferred<void>();
  const release = deferred<DirectoryScan>();
  const f = await fixture(async (path, nextSignal) => {
    if (hold) {
      signal = nextSignal;
      entered.resolve();
      return release.promise;
    }
    return inspectDirectory(path, nextSignal);
  });
  await f.register();
  hold = true;
  const pass = f.app.refreshDirectories();
  await entered.promise;
  const revision = f.app.health().revision;
  const count = f.messages.length;
  let closed = false;
  const closing = f.app.closeDirectoryRefresh().then(() => {
    closed = true;
  });
  try {
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(false);
    release.resolve({ path: f.path, available: false, reason: "gone", git: null });
    await closing;
    await pass;
    expect(f.app.health().revision).toBe(revision);
    expect(f.messages).toHaveLength(count);
    const queries = spyOn(f.db, "query");
    try {
      f.app.startDirectoryRefresh();
      await f.app.refreshDirectories();
      await f.app.closeDirectoryRefresh();
      await expect(f.register()).rejects.toThrow(/closed/);
      expect(queries).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
    }
  } finally {
    release.resolve({ path: f.path, available: true, git: null });
    await closing;
  }
});

test("close also awaits registration inspections that have no refresh pass", async () => {
  const entered = deferred<AbortSignal | undefined>();
  const release = deferred<DirectoryScan>();
  const f = await fixture(async (_path, signal) => {
    entered.resolve(signal);
    return release.promise;
  });
  const registration = f.register();
  const rejected = registration.then(
    () => null,
    (error: unknown) => error,
  );
  const signal = await entered.promise;
  let closed = false;
  const closing = f.app.closeDirectoryRefresh().then(() => {
    closed = true;
  });
  try {
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(false);
    release.resolve({ path: f.path, available: true, git: null });
    await closing;
    expect(await rejected).toMatchObject({ message: expect.stringContaining("closed") });
    expect(f.app.snapshot().items).toEqual([]);
  } finally {
    release.resolve({ path: f.path, available: true, git: null });
    await closing;
    await registration.catch(() => {});
  }
});

test("startup and five-second timer passes never overlap or queue catch-up work", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: { handle: ReturnType<typeof setTimeout>; fire(): void }[] = [];
  let scheduled = deferred<() => void>();
  const schedule = spyOn(globalThis, "setTimeout").mockImplementation(
    Object.assign(
      (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== 5000 || typeof callback !== "function") {
          return realSetTimeout(callback, delay, ...args);
        }
        const handle = realSetTimeout(() => {}, 2147483647);
        handle.unref();
        const fire = () => {
          realClearTimeout(handle);
          (callback as (...args: unknown[]) => void)(...args);
        };
        timers.push({ handle, fire });
        scheduled.resolve(fire);
        return handle;
      },
      { __promisify__: realSetTimeout.__promisify__ },
    ) as typeof setTimeout,
  );
  const clear = spyOn(globalThis, "clearTimeout");
  let hold = false;
  let active = 0;
  let maximum = 0;
  let calls = 0;
  let entered = deferred<void>();
  let release = deferred<DirectoryScan>();
  const f = await fixture(async (path, signal) => {
    calls += 1;
    maximum = Math.max(maximum, ++active);
    try {
      if (hold) {
        entered.resolve();
        return await release.promise;
      }
      return await inspectDirectory(path, signal);
    } finally {
      active -= 1;
    }
  });
  let prepared: DirectoryScan = { path: f.path, available: true, git: null };
  try {
    const rootId = await f.register();
    const external = join(f.home, "startup-child");
    git(f.path, "worktree", "add", "-b", "feature", external);
    prepared = await inspectDirectory(f.path);
    hold = true;
    f.app.startDirectoryRefresh();
    f.app.startDirectoryRefresh();
    await entered.promise;
    const pass = f.app.refreshDirectories();
    expect(f.app.refreshDirectories()).toBe(pass);
    expect(timers).toHaveLength(0);
    release.resolve(prepared);
    await pass;
    const fire = await scheduled.promise;
    expect(f.app.snapshot().items.filter((item) => item.parentId === rootId)).toHaveLength(1);
    entered = deferred<void>();
    release = deferred<DirectoryScan>();
    scheduled = deferred<() => void>();
    fire();
    await entered.promise;
    expect(timers).toHaveLength(1);
    const nextPass = f.app.refreshDirectories();
    expect(f.app.refreshDirectories()).toBe(nextPass);
    release.resolve(prepared);
    await nextPass;
    const lateTimer = await scheduled.promise;
    expect(timers).toHaveLength(2);
    expect(maximum).toBe(1);
    expect(calls).toBe(3);
    await f.app.closeDirectoryRefresh();
    expect(clear.mock.calls.some(([handle]) => handle === timers[1]!.handle)).toBe(true);
    lateTimer();
    await Promise.resolve();
    expect(calls).toBe(3);
    expect(timers).toHaveLength(2);
  } finally {
    release.resolve(prepared);
    await f.app.closeDirectoryRefresh();
    schedule.mockRestore();
    clear.mockRestore();
    for (const timer of timers) {
      realClearTimeout(timer.handle);
    }
  }
});

test("registration of an unrelated root does not wait behind another root's scan", async () => {
  let blocked: string | undefined;
  const entered = deferred<void>();
  const release = deferred<DirectoryScan>();
  const f = await fixture(async (path, signal) => {
    if (path === blocked) {
      entered.resolve();
      return release.promise;
    }
    return inspectDirectory(path, signal);
  });
  const rootId = await f.register();
  const prepared = await inspectDirectory(f.path);
  const other = join(f.home, "other");
  await mkdir(other);
  blocked = f.path;
  const pass = f.app.refreshDirectories();
  await entered.promise;
  let releasedByDeadline = false;
  const deadline = setTimeout(() => {
    releasedByDeadline = true;
    release.resolve(prepared);
  }, 1000);
  try {
    const registered = await f.register(other);
    expect(releasedByDeadline).toBe(false);
    expect(registered).not.toBe(rootId);
    expect(f.app.snapshot().items).toHaveLength(2);
    expect(f.app.snapshot().surfaces).toEqual([]);
  } finally {
    clearTimeout(deadline);
    release.resolve(prepared);
    await pass;
  }
});

test("refresh timeouts stay stable and shutdown aborts and reaps a real Git process", async () => {
  const f = await fixture();
  const rootId = await f.register();
  const bin = join(f.home, "bin");
  const pidFile = join(f.home, "git.pid");
  await mkdir(bin);
  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`,
    { mode: 0o755 },
  );
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    await f.app.refreshDirectories();
    expect(target(f.app, rootId).data).toMatchObject({
      branch: "trunk",
      discoveryError: expect.stringMatching(/timed out/i),
    });
    let pid = Number(await Bun.file(pidFile).text());
    expect(() => process.kill(pid, 0)).toThrow();
    const revision = f.app.health().revision;
    const count = f.messages.length;
    await f.app.refreshDirectories();
    expect(f.app.health().revision).toBe(revision);
    expect(f.messages).toHaveLength(count);
    pid = Number(await Bun.file(pidFile).text());
    expect(() => process.kill(pid, 0)).toThrow();
    await rm(pidFile);
    const pass = f.app.refreshDirectories();
    const ready = Date.now() + 1500;
    while (!(await Bun.file(pidFile).exists()) && Date.now() < ready) {
      await Bun.sleep(1);
    }
    pid = Number(await Bun.file(pidFile).text());
    const start = Date.now();
    await f.app.closeDirectoryRefresh();
    await pass;
    expect(Date.now() - start).toBeLessThan(1000);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(f.app.health().revision).toBe(revision);
    expect(f.messages).toHaveLength(count);
  } finally {
    process.env.PATH = savedPath;
    await f.app.closeDirectoryRefresh();
  }
}, 10000);

test("shutdown during fallback reaps its real Git helper without late publication or PTY effects", async () => {
  let failed = false;
  const f = await fixture((path, signal) =>
    failed && path === f.path
      ? Promise.resolve({ path, available: false, reason: "Primary unreachable", git: null })
      : inspectDirectory(path, signal),
  );
  const external = join(f.home, "child");
  git(f.path, "worktree", "add", "-b", "feature", external);
  const rootId = await f.register();
  const child = f.app.snapshot().items.find((item) => item.parentId === rootId)!;
  const paneId = (await f.app.execute({ type: "surface.ensure", itemId: child.id })).result.paneId!;
  const bin = join(f.home, "bin");
  const pidFile = join(f.home, "fallback.pid");
  await mkdir(bin);
  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`,
    { mode: 0o755 },
  );
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  failed = true;
  const pass = f.app.refreshDirectories();
  try {
    const deadline = Date.now() + 1500;
    while (!(await Bun.file(pidFile).exists()) && Date.now() < deadline) {
      await Bun.sleep(1);
    }
    expect(await Bun.file(pidFile).exists()).toBe(true);
    const pid = Number(await Bun.file(pidFile).text());
    const before = f.app.snapshot();
    const snapshots = f.messages.filter((message) => message.type === "snapshot").length;
    const start = Date.now();
    await f.app.closeDirectoryRefresh();
    await pass;
    expect(Date.now() - start).toBeLessThan(1000);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(f.app.health().revision).toBe(before.revision);
    expect(f.messages.filter((message) => message.type === "snapshot")).toHaveLength(snapshots);
    expect(f.app.snapshot().items).toEqual(before.items);
    expect(f.app.snapshot().panes).toEqual(before.panes);
    expect(f.app.runtime.isLive(paneId)).toBe(true);
  } finally {
    process.env.PATH = savedPath;
    await f.app.closeDirectoryRefresh();
    await pass;
  }
});

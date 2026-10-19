import type { Database } from "bun:sqlite";
import { basename, isAbsolute, normalize, parse } from "node:path";

import {
  type Command,
  type DirectoryData,
  parseCommand,
  ProtocolError,
  type WorkItem,
} from "../api/protocol.ts";
import type { DirectoryScan } from "./directories.ts";

type ItemRow = Omit<WorkItem, "data" | "archived"> & { dataJson: string; archived: number };
const ITEM_COLUMNS =
  "id, workspace_id AS workspaceId, category, parent_id AS parentId, kind, title, position, archived, data_json AS dataJson";

/** Persisted payloads are untrusted too; ancestry is checked by the snapshot/transactions. */
export function parseWorkItem(value: unknown): WorkItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("Invalid work item");
  }
  const item = value as WorkItem;
  for (const text of [item.id, item.workspaceId]) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new ProtocolError("Invalid work item identity/title");
    }
  }
  if (
    !["inbox", "today", "design", "implementation", "collaboration", "operations"].includes(
      item.category,
    ) ||
    (item.parentId !== null &&
      (typeof item.parentId !== "string" || item.parentId.trim() === "")) ||
    !Number.isSafeInteger(item.position) ||
    item.position < 0 ||
    typeof item.archived !== "boolean" ||
    typeof item.data !== "object" ||
    item.data === null ||
    Array.isArray(item.data)
  ) {
    throw new ProtocolError("Invalid work item envelope/data");
  }
  if (item.kind === "generic") {
    if (typeof item.title !== "string" || item.title.trim() === "") {
      throw new ProtocolError("Invalid generic item title");
    }
    if (item.category === "implementation") {
      throw new ProtocolError("Coding cannot contain generic items");
    }
  } else if (item.kind === "directory" || item.kind === "worktree") {
    const data = item.data;
    if (
      item.category !== "implementation" ||
      (item.kind === "directory" ? item.parentId !== null : item.parentId === null) ||
      typeof data.path !== "string" ||
      !isAbsolute(data.path) ||
      data.path.includes("\0") ||
      normalize(data.path) !== data.path ||
      (data.branch !== null && (typeof data.branch !== "string" || data.branch === "")) ||
      !["available", "unavailable"].includes(data.availability) ||
      (data.failureReason !== undefined && typeof data.failureReason !== "string")
    ) {
      throw new ProtocolError("Invalid Coding item payload/parent");
    }
    if (item.title !== titleFor(data.path)) {
      throw new ProtocolError("Coding item title must be its directory basename");
    }
    if (
      item.kind === "directory" &&
      (typeof item.data.isGitCheckout !== "boolean" ||
        (item.data.gitCommonDir !== null &&
          (typeof item.data.gitCommonDir !== "string" || !isAbsolute(item.data.gitCommonDir))) ||
        item.data.isGitCheckout !== (item.data.gitCommonDir !== null) ||
        (item.data.discoveryError !== undefined && typeof item.data.discoveryError !== "string"))
    ) {
      throw new ProtocolError("Invalid directory discovery payload");
    }
    if (
      item.kind === "directory" &&
      item.data.gitCommonDir !== null &&
      (item.data.gitCommonDir.includes("\0") ||
        normalize(item.data.gitCommonDir) !== item.data.gitCommonDir)
    ) {
      throw new ProtocolError("Invalid directory discovery path");
    }
  } else {
    throw new ProtocolError("Invalid work item kind");
  }
  return item;
}

export function readItems(db: Database): WorkItem[] {
  return db
    .query<ItemRow, []>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY position, id`)
    .all()
    .map(({ dataJson, archived, ...item }) => {
      if (archived !== 0 && archived !== 1) {
        throw new ProtocolError("Invalid item archival boolean");
      }
      let data: unknown;
      try {
        data = JSON.parse(dataJson);
      } catch {
        throw new ProtocolError("Invalid items.data_json");
      }
      return parseWorkItem({ ...item, data, archived: archived === 1 });
    });
}

export function validateItemAncestry(items: readonly WorkItem[]): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.parentId === null) {
      continue;
    }
    const parent = byId.get(item.parentId);
    if (
      parent === undefined ||
      parent.parentId !== null ||
      parent.id === item.id ||
      parent.workspaceId !== item.workspaceId ||
      parent.category !== item.category ||
      (item.kind === "worktree" ? parent.kind !== "directory" : parent.kind !== "generic")
    ) {
      throw new ProtocolError("Invalid item parent/ancestry");
    }
  }
}

function insertItem(db: Database, item: Omit<WorkItem, "position">): void {
  parseWorkItem({ ...item, position: 0 });
  db.query(`INSERT INTO items (id, workspace_id, category, parent_id, kind, title, position, archived, data_json)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE workspace_id = ? AND category = ? AND parent_id IS ?), ?, ?)`).run(
    item.id,
    item.workspaceId,
    item.category,
    item.parentId,
    item.kind,
    item.title,
    item.workspaceId,
    item.category,
    item.parentId,
    Number(item.archived),
    JSON.stringify(item.data),
  );
}

function targetData(scan: {
  path: string;
  branch?: string | null;
  available: boolean;
  reason?: string;
}) {
  return {
    path: scan.path,
    branch: scan.branch ?? null,
    availability: scan.available ? ("available" as const) : ("unavailable" as const),
    ...(scan.reason === undefined ? {} : { failureReason: scan.reason }),
  };
}

function titleFor(path: string): string {
  return basename(path) || parse(path).root;
}

/** A registry can refresh a group only when both durable path identities match. */
export function isTrustedGroupScan(data: DirectoryData, scan: DirectoryScan): boolean {
  return (
    scan.discoveryError === undefined &&
    scan.git !== null &&
    scan.git.primary.path === data.path &&
    (data.gitCommonDir === null || scan.git.commonDir === data.gitCommonDir)
  );
}

function hasCheckoutPathConflict(
  items: readonly WorkItem[],
  workspaceId: string,
  scan: DirectoryScan,
  rootItemId: string | undefined,
): boolean {
  const paths = [scan.path, ...(scan.git?.worktrees.map((record) => record.path) ?? [])];
  return items.some(
    (owner) =>
      owner.kind !== "generic" &&
      owner.workspaceId === workspaceId &&
      paths.includes(owner.data.path) &&
      (owner.data.path === scan.path
        ? owner.id !== rootItemId
        : owner.kind !== "worktree" || owner.parentId !== rootItemId),
  );
}

function reconcile(db: Database, itemId: string, scan: DirectoryScan): boolean {
  const items = readItems(db);
  validateItemAncestry(items);
  const root = items.find((item) => item.id === itemId);
  if (root?.kind !== "directory" || root.archived) {
    return false;
  }
  if (scan.path !== root.data.path) {
    const source = items.find(
      (item) =>
        item.kind === "worktree" &&
        item.parentId === itemId &&
        item.workspaceId === root.workspaceId &&
        !item.archived &&
        item.data.path === scan.path,
    );
    if (source === undefined || !isTrustedGroupScan(root.data, scan)) {
      return false;
    }
  }
  if (root.data.isGitCheckout && !isTrustedGroupScan(root.data, scan)) {
    scan = {
      path: root.data.path,
      available: scan.available,
      ...(scan.reason === undefined ? {} : { reason: scan.reason }),
      git: null,
      discoveryError:
        scan.discoveryError ??
        (scan.git === null
          ? "Git registry unavailable; retaining last-known repository metadata."
          : "Repository identity conflict requires explicit resolution."),
    };
  } else if (scan.git !== null && scan.discoveryError === undefined) {
    if (!isTrustedGroupScan(root.data, scan)) {
      return false;
    }
    scan = primaryScan(scan);
  }
  if (
    scan.discoveryError === undefined &&
    hasCheckoutPathConflict(items, root.workspaceId, scan, itemId)
  ) {
    scan = {
      ...scan,
      discoveryError: "Checkout path identity conflict requires explicit resolution.",
    };
  }
  const retainGit = scan.discoveryError !== undefined || (!scan.available && scan.git === null);
  const data: DirectoryData = {
    ...targetData(scan),
    branch: retainGit ? root.data.branch : (scan.git?.branch ?? null),
    isGitCheckout: retainGit ? root.data.isGitCheckout : scan.git !== null,
    gitCommonDir: retainGit ? root.data.gitCommonDir : (scan.git?.commonDir ?? null),
    ...(scan.discoveryError === undefined ? {} : { discoveryError: scan.discoveryError }),
  };
  let changed = JSON.stringify(data) !== JSON.stringify(root.data);
  if (changed) {
    db.query("UPDATE items SET data_json = ? WHERE id = ?").run(JSON.stringify(data), itemId);
  }
  if (scan.discoveryError !== undefined) {
    return changed;
  }
  const children = items.filter((item) => item.parentId === itemId && item.kind === "worktree");
  const records = scan.git?.worktrees ?? [];
  for (const record of records) {
    const child = children.find((item) => item.data.path === record.path);
    const payload = targetData(record);
    if (child === undefined) {
      insertItem(db, {
        id: crypto.randomUUID(),
        workspaceId: root.workspaceId,
        category: "implementation",
        parentId: itemId,
        kind: "worktree",
        title: titleFor(record.path),
        archived: false,
        data: payload,
      });
      changed = true;
    } else if (!child.archived && JSON.stringify(child.data) !== JSON.stringify(payload)) {
      db.query("UPDATE items SET data_json = ? WHERE id = ?").run(
        JSON.stringify(payload),
        child.id,
      );
      changed = true;
    }
  }
  for (const child of children) {
    if (!child.archived && !records.some((record) => record.path === child.data.path)) {
      const payload = {
        ...child.data,
        availability: "unavailable",
        failureReason: "Worktree directory is unavailable.",
      };
      if (JSON.stringify(payload) !== JSON.stringify(child.data)) {
        db.query("UPDATE items SET data_json = ? WHERE id = ?").run(
          JSON.stringify(payload),
          child.id,
        );
        changed = true;
      }
    }
  }
  return changed;
}

export function reconcileDirectoryScan(db: Database, itemId: string, scan: DirectoryScan): boolean {
  return db.transaction(() => reconcile(db, itemId, scan))();
}

function primaryScan(scan: DirectoryScan): DirectoryScan {
  if (scan.git === null) {
    return scan;
  }
  const { primary } = scan.git;
  const records = new Map(
    [...scan.git.worktrees, { ...scan, branch: scan.git.branch }, primary].map((record) => [
      record.path,
      record,
    ]),
  );
  records.delete(primary.path);
  return {
    ...primary,
    git: { ...scan.git, branch: primary.branch, worktrees: [...records.values()] },
  };
}

/** Resolve one workspace-local group atomically, without moving existing runtime owners. */
export function registerDirectory(
  db: Database,
  workspaceId: string,
  scan: DirectoryScan,
): { itemId: string; rootItemId: string; changed: boolean } {
  return db.transaction(() => {
    if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(workspaceId) === null) {
      throw new ProtocolError("workspace not found");
    }
    if (scan.discoveryError !== undefined) {
      throw new ProtocolError(scan.discoveryError);
    }
    const items = readItems(db);
    validateItemAncestry(items);
    const coding = items
      .filter((item) => item.kind === "directory" || item.kind === "worktree")
      .filter((item) => item.workspaceId === workspaceId);
    const prepared = primaryScan(scan);
    const existing = coding.find(
      (item) =>
        item.kind === "directory" &&
        (prepared.git === null
          ? item.data.path === prepared.path
          : item.data.gitCommonDir === prepared.git.commonDir),
    );
    const requested = coding.find((item) => item.data.path === scan.path);
    if (existing?.archived || requested?.archived) {
      throw new ProtocolError(
        "Directory or worktree is archived. Restore it explicitly before registering.",
      );
    }
    if (
      existing !== undefined &&
      (existing.kind !== "directory" ||
        existing.data.path !== prepared.path ||
        existing.data.gitCommonDir !== (prepared.git?.commonDir ?? null))
    ) {
      throw new ProtocolError("Repository identity conflict requires explicit resolution.");
    }
    if (hasCheckoutPathConflict(coding, workspaceId, prepared, existing?.id)) {
      throw new ProtocolError("Checkout path identity conflict requires explicit resolution.");
    }
    const rootItemId = existing?.id ?? crypto.randomUUID();
    if (existing === undefined) {
      insertItem(db, {
        id: rootItemId,
        workspaceId,
        category: "implementation",
        parentId: null,
        kind: "directory",
        title: titleFor(prepared.path),
        archived: false,
        data: {
          ...targetData(prepared),
          branch: prepared.git?.branch ?? null,
          isGitCheckout: prepared.git !== null,
          gitCommonDir: prepared.git?.commonDir ?? null,
        },
      });
    }
    const reconciled = reconcile(db, rootItemId, prepared);
    const itemId = readItems(db).find(
      (item) =>
        item.workspaceId === workspaceId && item.kind !== "generic" && item.data.path === scan.path,
    )!.id;
    return { itemId, rootItemId, changed: existing === undefined || reconciled };
  })();
}

export function createGenericItem(
  db: Database,
  command: Extract<Command, { type: "item.create" }>,
): { itemId: string; changed: boolean } {
  parseCommand(command);
  return db.transaction(() => {
    if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(command.workspaceId) === null) {
      throw new ProtocolError("workspace not found");
    }
    const items = readItems(db);
    validateItemAncestry(items);
    if (command.parentId !== undefined) {
      const parent = items.find((item) => item.id === command.parentId);
      if (
        parent?.kind !== "generic" ||
        parent.parentId !== null ||
        parent.archived ||
        parent.workspaceId !== command.workspaceId ||
        parent.category !== command.category
      ) {
        throw new ProtocolError("Invalid or archived item parent");
      }
    }
    const itemId = crypto.randomUUID();
    insertItem(db, {
      id: itemId,
      workspaceId: command.workspaceId,
      category: command.category,
      parentId: command.parentId ?? null,
      kind: "generic",
      title: command.title,
      archived: false,
      data: command.data ?? {},
    });
    return { itemId, changed: true };
  })();
}

export function setItemArchived(
  db: Database,
  itemId: string,
  archived: boolean,
): { itemId: string; changed: boolean } {
  return db.transaction(() => {
    const item = readItems(db).find((item) => item.id === itemId);
    if (item === undefined) {
      throw new ProtocolError("item not found");
    }
    if (typeof archived !== "boolean") {
      throw new ProtocolError("archived must be boolean");
    }
    if (item.archived === archived) {
      return { itemId, changed: false };
    }
    db.query("UPDATE items SET archived = ? WHERE id = ?").run(Number(archived), itemId);
    return { itemId, changed: true };
  })();
}

export function itemTargetCwd(db: Database, itemId: string, cwd?: string, creating = true): string {
  const items = readItems(db);
  validateItemAncestry(items);
  const item = items.find((item) => item.id === itemId);
  if (item === undefined) {
    throw new ProtocolError("item not found");
  }
  if (item.kind !== "generic" && cwd !== undefined) {
    throw new ProtocolError("Coding surface cwd cannot be overridden");
  }
  if (
    creating &&
    (item.archived || items.some((parent) => parent.id === item.parentId && parent.archived))
  ) {
    throw new ProtocolError("item or parent is archived");
  }
  if (item.kind !== "generic") {
    if (creating && item.data.availability !== "available") {
      throw new ProtocolError("item directory is unavailable");
    }
    return item.data.path;
  }
  return cwd ?? process.cwd();
}

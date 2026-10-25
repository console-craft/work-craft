import type { Database } from "bun:sqlite";

import { type DirectoryData, ProtocolError } from "../api/protocol.ts";
import { canonicalDirectoryPath, type DirectoryScan, inspectDirectory } from "./directories.ts";
import { isTrustedGroupScan, readItems, reconcileDirectoryScan } from "./items.ts";
import { normalizeSessionNavigations, readNavigationCatalog } from "./navigation-store.ts";

/** Registration and refresh share inspection lifetime; construction never starts discovery. */
export function createDirectoryDiscovery(options: {
  db: Database;
  inspectDirectory?: typeof inspectDirectory;
  onChange(changed: boolean): void;
}): {
  prepareRegistration(path: string): Promise<DirectoryScan>;
  validateRegistration(scan: DirectoryScan): void;
  start(): void;
  refresh(): Promise<void>;
  close(): Promise<void>;
} {
  const directoryAbort = new AbortController();
  const inspections = new Map<string, Promise<DirectoryScan>>();
  let directoryPass: Promise<void> | undefined;
  let directoryTimer: ReturnType<typeof setTimeout> | undefined;
  let directoryRefreshStarted = false;
  let directoryRefreshClosed = false;
  let directoryClose: Promise<void> | undefined;

  async function prepareRegistration(path: string): Promise<DirectoryScan> {
    if (directoryRefreshClosed) {
      throw new ProtocolError("Directory discovery is closed");
    }
    return inspectPath(await canonicalDirectoryPath(path));
  }

  /** Revalidate synchronously after the caller's preparation await, before committing. */
  function validateRegistration(scan: DirectoryScan): void {
    if (directoryRefreshClosed) {
      throw new ProtocolError("Directory discovery is closed");
    }
    if (!scan.available) {
      throw new ProtocolError(scan.reason ?? "Directory became unavailable during registration");
    }
  }

  function inspectPath(path: string): Promise<DirectoryScan> {
    const pending = inspections.get(path);
    if (pending !== undefined) {
      return pending;
    }
    const inspection = Promise.resolve()
      .then(() => {
        if (directoryRefreshClosed) {
          throw new ProtocolError("Directory discovery is closed");
        }
        return (options.inspectDirectory ?? inspectDirectory)(path, directoryAbort.signal);
      })
      .finally(() => {
        inspections.delete(path);
      });
    inspections.set(path, inspection);
    return inspection;
  }

  function currentDirectory(id: string, workspaceId: string, data: DirectoryData): boolean {
    return (
      options.db
        .query(
          `SELECT 1 FROM items WHERE id = ? AND workspace_id = ? AND kind = 'directory' AND archived = 0
        AND json_extract(data_json, '$.path') = ? AND json_extract(data_json, '$.gitCommonDir') IS ?`,
        )
        .get(id, workspaceId, data.path, data.gitCommonDir) !== null
    );
  }

  async function inspectRemembered(
    data: Pick<DirectoryData, "path" | "availability" | "failureReason">,
  ): Promise<DirectoryScan> {
    try {
      return await inspectPath(data.path);
    } catch (error) {
      return {
        path: data.path,
        available: data.availability === "available",
        ...(data.failureReason === undefined ? {} : { reason: data.failureReason }),
        git: null,
        discoveryError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function refreshDirectoryPass(): Promise<void> {
    const roots = readItems(options.db).filter(
      (item) => item.kind === "directory" && !item.archived,
    );
    for (const root of roots) {
      if (directoryRefreshClosed) {
        return;
      }
      if (root.kind !== "directory" || !currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      let scan = await inspectRemembered(root.data);
      if (directoryRefreshClosed) {
        return;
      }
      if (!currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      if (root.data.isGitCheckout && !isTrustedGroupScan(root.data, scan)) {
        const children = readItems(options.db).filter(
          (item) => item.kind === "worktree" && item.parentId === root.id && !item.archived,
        );
        for (const child of children) {
          if (directoryRefreshClosed) {
            return;
          }
          if (!currentDirectory(root.id, root.workspaceId, root.data)) {
            break;
          }
          if (child.kind !== "worktree") {
            continue;
          }
          const currentChild = () =>
            options.db
              .query(
                `SELECT 1 FROM items WHERE id = ? AND parent_id = ? AND workspace_id = ? AND kind = 'worktree'
              AND archived = 0 AND json_extract(data_json, '$.path') = ?`,
              )
              .get(child.id, root.id, root.workspaceId, child.data.path) !== null;
          if (!currentChild()) {
            continue;
          }
          const fallback = await inspectRemembered(child.data);
          if (directoryRefreshClosed) {
            return;
          }
          if (!currentDirectory(root.id, root.workspaceId, root.data)) {
            break;
          }
          if (
            currentChild() &&
            fallback.path === child.data.path &&
            isTrustedGroupScan(root.data, fallback)
          ) {
            scan = fallback;
            break;
          }
        }
      }
      if (!currentDirectory(root.id, root.workspaceId, root.data)) {
        continue;
      }
      const changed = options.db.transaction(() => {
        const before = readNavigationCatalog(options.db);
        const changed = reconcileDirectoryScan(options.db, root.id, scan);
        return normalizeSessionNavigations(options.db, before) || changed;
      })();
      options.onChange(changed);
    }
  }

  function refreshDirectories(): Promise<void> {
    if (directoryRefreshClosed) {
      return Promise.resolve();
    }
    directoryPass ??= refreshDirectoryPass().finally(() => {
      directoryPass = undefined;
    });
    return directoryPass;
  }

  function startDirectoryRefresh(): void {
    if (directoryRefreshStarted || directoryRefreshClosed) {
      return;
    }
    directoryRefreshStarted = true;
    function run(): void {
      void refreshDirectories()
        .catch((error) => {
          console.error("Work Craft directory refresh failed:", error);
        })
        .finally(() => {
          if (!directoryRefreshClosed) {
            directoryTimer = setTimeout(run, 5000);
          }
        });
    }
    run();
  }

  function closeDirectoryRefresh(): Promise<void> {
    if (directoryClose !== undefined) {
      return directoryClose;
    }
    directoryRefreshClosed = true;
    clearTimeout(directoryTimer);
    directoryAbort.abort();
    directoryClose = Promise.allSettled([...inspections.values(), directoryPass]).then(() => {});
    return directoryClose;
  }

  return {
    prepareRegistration,
    validateRegistration,
    start: startDirectoryRefresh,
    refresh: refreshDirectories,
    close: closeDirectoryRefresh,
  };
}

import type { Database } from "bun:sqlite";

import { ProtocolError } from "../api/protocol.ts";
import type { Command, CommandResult, LayoutNode } from "../api/protocol.ts";
import type { DirectoryScan } from "./directories.ts";
import { createGenericItem, itemTargetCwd, registerDirectory, setItemArchived } from "./items.ts";
import { splitLayout } from "./layout.ts";

export type DomainEffect =
  | { type: "spawn-pane"; paneId: string }
  | { type: "stop-daemon" }
  | { type: "destroy-daemon" };

export type CommandOutcome = { result: CommandResult; effects: DomainEffect[]; changed: boolean };

function createShellPane(
  db: Database,
  surfaceId: string,
  cwd: string,
  restorePolicyJson = JSON.stringify({
    type: "shell",
    executable: process.env.SHELL ?? "/bin/sh",
    args: [],
  }),
): string {
  const paneId = crypto.randomUUID();
  db.query(
    "INSERT INTO panes (id, surface_id, kind, title, cwd, restore_policy_json, process_status) VALUES (?, ?, 'terminal', 'Shell', ?, ?, 'interrupted')",
  ).run(paneId, surfaceId, cwd, restorePolicyJson);
  return paneId;
}

function ensureSurface(db: Database, itemId: string, cwd?: string): CommandOutcome {
  if (db.query("SELECT 1 FROM items WHERE id = ?").get(itemId) === null) {
    throw new ProtocolError("item not found");
  }

  const existing = db
    .query<{ surfaceId: string }, [string]>(
      "SELECT id AS surfaceId FROM surfaces WHERE item_id = ?",
    )
    .get(itemId);
  if (existing !== null) {
    itemTargetCwd(db, itemId, cwd, false);
    return {
      changed: false,
      result: { id: existing.surfaceId, itemId, surfaceId: existing.surfaceId },
      effects: [],
    };
  }

  const targetCwd = itemTargetCwd(db, itemId, cwd);

  const surfaceId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  db.query("INSERT INTO surfaces (id, item_id, active_tab_id) VALUES (?, ?, NULL)").run(
    surfaceId,
    itemId,
  );
  const paneId = createShellPane(db, surfaceId, targetCwd);
  db.query(
    "INSERT INTO tabs (id, surface_id, title, position, layout_json) VALUES (?, ?, 'Main', 0, ?)",
  ).run(tabId, surfaceId, JSON.stringify({ type: "pane", paneId }));
  db.query("UPDATE surfaces SET active_tab_id = ? WHERE id = ?").run(tabId, surfaceId);
  return {
    changed: true,
    result: { id: surfaceId, itemId, surfaceId, tabId, paneId },
    effects: [{ type: "spawn-pane", paneId }],
  };
}

function writeSessionOrder(db: Database, ids: string[]): void {
  const update = db.query("UPDATE sessions SET position = ? WHERE id = ?");
  ids.forEach((id, position) => update.run(position, id));
}

/** Apply synchronous mutations; pane.split requires an already resolved and validated cwd. */
export function applyCommand(
  db: Database,
  command: Command,
  registration?: DirectoryScan,
): CommandOutcome {
  switch (command.type) {
    case "session.create":
      return db.transaction(() => {
        const id = crypto.randomUUID();
        db.query(
          "INSERT INTO sessions (id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM sessions))",
        ).run(id, command.name);
        return { result: { id }, effects: [], changed: true };
      })();
    case "session.update":
      return db.transaction(() => {
        const oldName = db
          .query<{ name: string }, [string]>("SELECT name FROM sessions WHERE id = ?")
          .get(command.sessionId)?.name;
        const ids = db
          .query<{ id: string }, []>("SELECT id FROM sessions ORDER BY position, id")
          .all()
          .map(({ id }) => id);
        const currentPosition = ids.indexOf(command.sessionId);
        if (currentPosition === -1) {
          throw new ProtocolError("session not found");
        }
        const targetPosition = command.position ?? currentPosition;
        if (targetPosition >= ids.length) {
          throw new ProtocolError("session position out of range");
        }

        ids.splice(currentPosition, 1);
        ids.splice(targetPosition, 0, command.sessionId);
        if (command.name !== undefined) {
          db.query("UPDATE sessions SET name = ? WHERE id = ?").run(
            command.name,
            command.sessionId,
          );
        }
        writeSessionOrder(db, ids);
        return {
          result: { id: command.sessionId },
          effects: [],
          changed:
            targetPosition !== currentPosition ||
            (command.name !== undefined && command.name !== oldName),
        };
      })();
    case "session.delete":
      return db.transaction(() => {
        const ids = db
          .query<{ id: string }, []>("SELECT id FROM sessions ORDER BY position, id")
          .all()
          .map(({ id }) => id);
        const position = ids.indexOf(command.sessionId);
        if (position === -1) {
          throw new ProtocolError("session not found");
        }

        ids.splice(position, 1);
        db.query("DELETE FROM sessions WHERE id = ?").run(command.sessionId);
        writeSessionOrder(db, ids);
        return { result: { id: command.sessionId }, effects: [], changed: true };
      })();
    case "session.workspace.add":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM sessions WHERE id = ?").get(command.sessionId) === null) {
          throw new ProtocolError("session not found");
        }
        if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(command.workspaceId) === null) {
          throw new ProtocolError("workspace not found");
        }
        const inserted = db
          .query(
            `INSERT OR IGNORE INTO session_workspaces (session_id, workspace_id, position)
           VALUES (?, ?, (
             SELECT COALESCE(MAX(position), -1) + 1
             FROM session_workspaces WHERE session_id = ?
           ))`,
          )
          .run(command.sessionId, command.workspaceId, command.sessionId);
        return {
          changed: inserted.changes > 0,
          result: {
            id: command.workspaceId,
            sessionId: command.sessionId,
            workspaceId: command.workspaceId,
          },
          effects: [],
        };
      })();
    case "session.workspace.remove":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM sessions WHERE id = ?").get(command.sessionId) === null) {
          throw new ProtocolError("session not found");
        }
        if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(command.workspaceId) === null) {
          throw new ProtocolError("workspace not found");
        }
        const removed = db
          .query("DELETE FROM session_workspaces WHERE session_id = ? AND workspace_id = ?")
          .run(command.sessionId, command.workspaceId);
        return {
          changed: removed.changes > 0,
          result: {
            id: command.workspaceId,
            sessionId: command.sessionId,
            workspaceId: command.workspaceId,
          },
          effects: [],
        };
      })();
    case "workspace.create":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM sessions WHERE id = ?").get(command.sessionId) === null) {
          throw new ProtocolError("session not found");
        }
        const id = crypto.randomUUID();
        db.query("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(id, command.name);
        db.query(
          `INSERT INTO session_workspaces (session_id, workspace_id, position)
           VALUES (?, ?, (
             SELECT COALESCE(MAX(position), -1) + 1
             FROM session_workspaces WHERE session_id = ?
           ))`,
        ).run(command.sessionId, id, command.sessionId);
        return { result: { id }, effects: [], changed: true };
      })();
    case "directory.register": {
      if (registration === undefined) {
        throw new ProtocolError("Directory registration requires prepared inspection");
      }
      const { itemId, rootItemId, changed } = registerDirectory(
        db,
        command.workspaceId,
        registration,
      );
      return { result: { id: itemId, itemId, rootItemId }, effects: [], changed };
    }
    case "item.create": {
      const { itemId, changed } = createGenericItem(db, command);
      return { result: { id: itemId, itemId }, effects: [], changed };
    }
    case "item.setArchived": {
      const { itemId, changed } = setItemArchived(db, command.itemId, command.archived);
      return { result: { id: itemId, itemId }, effects: [], changed };
    }
    case "daemon.stop":
      return {
        changed: false,
        result: { id: "daemon", stopping: true },
        effects: [{ type: "stop-daemon" }],
      };
    case "daemon.destroy":
      return {
        changed: false,
        result: { id: "daemon", destroying: true },
        effects: [{ type: "destroy-daemon" }],
      };
    case "surface.ensure":
      return db.transaction(() => ensureSurface(db, command.itemId, command.cwd))();
    case "tab.create":
      return db.transaction(() => {
        const owner = db
          .query<{ itemId: string }, [string]>(
            "SELECT item_id AS itemId FROM surfaces WHERE id = ?",
          )
          .get(command.surfaceId);
        if (owner === null) {
          throw new ProtocolError("surface not found");
        }
        const tabId = crypto.randomUUID();
        const paneId = createShellPane(db, command.surfaceId, itemTargetCwd(db, owner.itemId));
        db.query(
          "INSERT INTO tabs (id, surface_id, title, position, layout_json) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM tabs WHERE surface_id = ?), ?)",
        ).run(
          tabId,
          command.surfaceId,
          command.title,
          command.surfaceId,
          JSON.stringify({ type: "pane", paneId }),
        );
        db.query("UPDATE surfaces SET active_tab_id = ? WHERE id = ?").run(
          tabId,
          command.surfaceId,
        );
        return {
          changed: true,
          result: { id: tabId, surfaceId: command.surfaceId, tabId, paneId },
          effects: [{ type: "spawn-pane" as const, paneId }],
        };
      })();
    case "surface.selectTab":
      return db.transaction(() => {
        if (
          db
            .query("SELECT 1 FROM tabs WHERE id = ? AND surface_id = ?")
            .get(command.tabId, command.surfaceId) === null
        ) {
          throw new ProtocolError("tab not found for surface");
        }
        const previous = db
          .query<{ activeTabId: string | null }, [string]>(
            "SELECT active_tab_id AS activeTabId FROM surfaces WHERE id = ?",
          )
          .get(command.surfaceId);
        db.query("UPDATE surfaces SET active_tab_id = ? WHERE id = ?").run(
          command.tabId,
          command.surfaceId,
        );
        return {
          changed: previous?.activeTabId !== command.tabId,
          result: { id: command.tabId, surfaceId: command.surfaceId, tabId: command.tabId },
          effects: [],
        };
      })();
    case "pane.split":
      return db.transaction(() => {
        if (command.cwd === undefined || command.cwd.length === 0) {
          throw new ProtocolError("Split requires a resolved working directory");
        }
        const pane = db
          .query<
            {
              surfaceId: string;
              restorePolicyJson: string;
              archived: number;
              parentArchived: number | null;
            },
            [string]
          >(
            `SELECT panes.surface_id AS surfaceId, panes.restore_policy_json AS restorePolicyJson,
              items.archived, parent.archived AS parentArchived
             FROM panes
             JOIN surfaces ON surfaces.id = panes.surface_id
             JOIN items ON items.id = surfaces.item_id
             LEFT JOIN items AS parent ON parent.id = items.parent_id
             WHERE panes.id = ?`,
          )
          .get(command.paneId);
        if (pane === null) {
          throw new ProtocolError("pane not found");
        }
        if (pane.archived || pane.parentArchived) {
          throw new ProtocolError("item or parent is archived");
        }
        const tabs = db
          .query<{ id: string; surfaceId: string; layoutJson: string }, [string]>(
            "SELECT id, surface_id AS surfaceId, layout_json AS layoutJson FROM tabs WHERE EXISTS (SELECT 1 FROM json_tree(tabs.layout_json) WHERE key = 'paneId' AND value = ?)",
          )
          .all(command.paneId);
        if (tabs.length !== 1 || tabs[0]!.surfaceId !== pane.surfaceId) {
          throw new ProtocolError("pane not found in exactly one tab");
        }

        const paneId = createShellPane(db, pane.surfaceId, command.cwd, pane.restorePolicyJson);
        const layout = splitLayout(
          JSON.parse(tabs[0]!.layoutJson) as LayoutNode,
          command.paneId,
          paneId,
          command.direction,
        );
        db.query("UPDATE tabs SET layout_json = ? WHERE id = ?").run(
          JSON.stringify(layout),
          tabs[0]!.id,
        );
        return {
          changed: true,
          result: { id: paneId, surfaceId: pane.surfaceId, tabId: tabs[0]!.id, paneId },
          effects: [{ type: "spawn-pane" as const, paneId }],
        };
      })();
    case "process.restart":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM panes WHERE id = ?").get(command.paneId) === null) {
          throw new ProtocolError("pane not found");
        }
        return {
          changed: false,
          result: { id: command.paneId, paneId: command.paneId },
          effects: [{ type: "spawn-pane" as const, paneId: command.paneId }],
        };
      })();
  }
}

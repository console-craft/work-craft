import type { Database } from "bun:sqlite";
import { splitLayout } from "./layout.ts";
import { ProtocolError } from "./protocol.ts";
import type { Command, CommandResult, LayoutNode } from "./protocol.ts";

export type DomainEffect = { type: "spawn-pane"; paneId: string } | { type: "stop-daemon" };

type CommandOutcome = { result: CommandResult; effects: DomainEffect[] };

function createShellPane(db: Database, surfaceId: string, cwd: string): string {
  const paneId = crypto.randomUUID();
  db.query(
    "INSERT INTO panes (id, surface_id, kind, title, cwd, restore_policy_json, process_status) VALUES (?, ?, 'terminal', 'Shell', ?, ?, 'interrupted')",
  ).run(
    paneId,
    surfaceId,
    cwd,
    JSON.stringify({ type: "shell", executable: process.env.SHELL ?? "/bin/sh", args: [] }),
  );
  return paneId;
}

function openSurface(db: Database, itemId: string, cwd?: string): CommandOutcome {
  if (db.query("SELECT 1 FROM items WHERE id = ?").get(itemId) === null) {
    throw new ProtocolError("item not found");
  }

  const existing = db
    .query<{ surfaceId: string }, [string]>(
      "SELECT id AS surfaceId FROM surfaces WHERE item_id = ?",
    )
    .get(itemId);
  if (existing !== null) {
    return {
      result: { id: existing.surfaceId, itemId, surfaceId: existing.surfaceId },
      effects: [],
    };
  }

  const surfaceId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  db.query("INSERT INTO surfaces (id, item_id, active_tab_id) VALUES (?, ?, NULL)").run(
    surfaceId,
    itemId,
  );
  const paneId = createShellPane(db, surfaceId, cwd ?? process.cwd());
  db.query(
    "INSERT INTO tabs (id, surface_id, title, position, layout_json) VALUES (?, ?, 'Main', 0, ?)",
  ).run(tabId, surfaceId, JSON.stringify({ type: "pane", paneId }));
  db.query("UPDATE surfaces SET active_tab_id = ? WHERE id = ?").run(tabId, surfaceId);
  return {
    result: { id: surfaceId, itemId, surfaceId, tabId, paneId },
    effects: [{ type: "spawn-pane", paneId }],
  };
}

export function applyCommand(
  db: Database,
  command: Command,
): { result: CommandResult; effects: DomainEffect[] } {
  switch (command.type) {
    case "session.create":
      return db.transaction(() => {
        const id = crypto.randomUUID();
        db.query(
          "INSERT INTO sessions (id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM sessions))",
        ).run(id, command.name);
        return { result: { id }, effects: [] };
      })();
    case "workspace.create":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM sessions WHERE id = ?").get(command.sessionId) === null) {
          throw new ProtocolError("session not found");
        }
        const id = crypto.randomUUID();
        db.query(
          "INSERT INTO workspaces (id, session_id, name, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces WHERE session_id = ?))",
        ).run(id, command.sessionId, command.name, command.sessionId);
        return { result: { id }, effects: [] };
      })();
    case "project.create":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(command.workspaceId) === null) {
          throw new ProtocolError("workspace not found");
        }
        const id = crypto.randomUUID();
        db.query(
          "INSERT INTO projects (id, workspace_id, category, name, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM projects WHERE workspace_id = ? AND category = ?))",
        ).run(
          id,
          command.workspaceId,
          command.category,
          command.name,
          command.workspaceId,
          command.category,
        );
        return { result: { id }, effects: [] };
      })();
    case "item.create":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM projects WHERE id = ?").get(command.projectId) === null) {
          throw new ProtocolError("project not found");
        }
        const id = crypto.randomUUID();
        db.query(
          "INSERT INTO items (id, project_id, kind, title, position, data_json) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE project_id = ?), ?)",
        ).run(
          id,
          command.projectId,
          command.kind,
          command.title,
          command.projectId,
          JSON.stringify(command.data ?? {}),
        );
        return { result: { id }, effects: [] };
      })();
    case "daemon.stop":
      return {
        result: { id: "daemon", stopping: true },
        effects: [{ type: "stop-daemon" }],
      };
    case "surface.open":
      return db.transaction(() => openSurface(db, command.itemId, command.cwd))();
    case "surface.openHere":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM projects WHERE id = ?").get(command.projectId) === null) {
          throw new ProtocolError("project not found");
        }
        let item = db
          .query<{ id: string }, [string]>(
            "SELECT id FROM items WHERE project_id = ? AND kind = 'surface' AND json_extract(data_json, '$.scope') = 'project-terminal' ORDER BY position, id LIMIT 1",
          )
          .get(command.projectId);
        if (item === null) {
          item = { id: crypto.randomUUID() };
          db.query(
            "INSERT INTO items (id, project_id, kind, title, position, data_json) VALUES (?, ?, 'surface', 'Terminal', (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE project_id = ?), ?)",
          ).run(
            item.id,
            command.projectId,
            command.projectId,
            JSON.stringify({ scope: "project-terminal" }),
          );
        }
        return openSurface(db, item.id, command.cwd);
      })();
    case "tab.create":
      return db.transaction(() => {
        if (db.query("SELECT 1 FROM surfaces WHERE id = ?").get(command.surfaceId) === null) {
          throw new ProtocolError("surface not found");
        }
        const tabId = crypto.randomUUID();
        const paneId = createShellPane(db, command.surfaceId, process.cwd());
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
        db.query("UPDATE surfaces SET active_tab_id = ? WHERE id = ?").run(
          command.tabId,
          command.surfaceId,
        );
        return {
          result: { id: command.tabId, surfaceId: command.surfaceId, tabId: command.tabId },
          effects: [],
        };
      })();
    case "pane.split":
      return db.transaction(() => {
        const pane = db
          .query<{ surfaceId: string; cwd: string }, [string]>(
            "SELECT surface_id AS surfaceId, cwd FROM panes WHERE id = ?",
          )
          .get(command.paneId);
        if (pane === null) {
          throw new ProtocolError("pane not found");
        }
        const tabs = db
          .query<{ id: string; layoutJson: string }, [string, string]>(
            "SELECT id, layout_json AS layoutJson FROM tabs WHERE surface_id = ? AND EXISTS (SELECT 1 FROM json_tree(tabs.layout_json) WHERE key = 'paneId' AND value = ?)",
          )
          .all(pane.surfaceId, command.paneId);
        if (tabs.length !== 1) {
          throw new ProtocolError("pane not found in exactly one tab");
        }

        const paneId = createShellPane(db, pane.surfaceId, command.cwd ?? pane.cwd);
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
          result: { id: command.paneId, paneId: command.paneId },
          effects: [{ type: "spawn-pane" as const, paneId: command.paneId }],
        };
      })();
  }
}

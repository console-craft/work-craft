import type { Database } from "bun:sqlite";
import { ProtocolError } from "./protocol.ts";
import type { Command, CommandResult } from "./protocol.ts";

export type DomainEffect = { type: "spawn-pane"; paneId: string } | { type: "stop-daemon" };

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
    case "surface.openHere":
    case "tab.create":
    case "surface.selectTab":
    case "pane.split":
    case "process.restart":
      throw new ProtocolError("surface commands are not available before the runtime phase");
  }
}

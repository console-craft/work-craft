import type { Database } from "bun:sqlite";

import type { Snapshot } from "../api/protocol.ts";
import { readItems, validateItemAncestry } from "./items.ts";

type CatalogRows = Pick<
  Snapshot,
  "sessions" | "workspaces" | "sessionWorkspaces" | "items" | "surfaces"
> & {
  tabRows: (Omit<Snapshot["tabs"][number], "layout"> & { layoutJson: string | null })[];
};

/** Fresh structural rows with validated items; callers own layout parsing and pane projections. */
export function readCatalogRows(db: Database): CatalogRows {
  const sessions = db
    .query<CatalogRows["sessions"][number], []>(
      "SELECT id, name, position FROM sessions ORDER BY position, id",
    )
    .all();
  const workspaces = db
    .query<CatalogRows["workspaces"][number], []>("SELECT id, name FROM workspaces ORDER BY id")
    .all();
  const sessionWorkspaces = db
    .query<CatalogRows["sessionWorkspaces"][number], []>(
      "SELECT session_id AS sessionId, workspace_id AS workspaceId, position FROM session_workspaces ORDER BY session_id, position, workspace_id",
    )
    .all();
  const items = readItems(db);
  validateItemAncestry(items);
  const surfaces = db
    .query<CatalogRows["surfaces"][number], []>(
      "SELECT id, item_id AS itemId FROM surfaces ORDER BY id",
    )
    .all();
  const tabRows = db
    .query<CatalogRows["tabRows"][number], []>(
      "SELECT id, surface_id AS surfaceId, title, position, layout_json AS layoutJson FROM tabs ORDER BY position, id",
    )
    .all();
  return { sessions, workspaces, sessionWorkspaces, items, surfaces, tabRows };
}

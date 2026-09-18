# Session Profiles Design

## Goal

Make sessions useful now, while the product is early, by defining them as durable named profiles over shared workspaces. A TUI client displays one session at a time, but switching sessions changes only visible scope: hidden workspaces and their terminal runtimes continue running under the daemon.

If sessions remained passive parents of workspaces, they would duplicate the workspace concept without adding behavior. This design replaces that ownership relationship with reusable membership.

## Product Model

A session is a long-lived focus profile such as Personal, Work, or Consulting. A workspace is a canonical organizational context that may appear in multiple sessions.

```text
session ──< session workspace membership >── workspace
                                                └── category
                                                    └── project
                                                        └── item
                                                            └── execution surface
                                                                └── tab
                                                                    └── pane
```

Sessions own only workspace membership and per-session workspace ordering. Workspaces own projects, items, execution surfaces, panes, terminal history, and live runtimes through the existing hierarchy.

The same workspace may appear in multiple sessions without copying any descendants. Changes to its projects and items are immediately visible through every containing session. A pane has one durable identity and at most one live runtime regardless of how many sessions expose its workspace.

## Session Selection

Each TUI client has one active session as transient presentation state. Active-session selection is not daemon-global, so two connected TUI clients may view different sessions without affecting one another.

The TUI behavior is:

- With no sessions, lead into session creation.
- With one session, select it automatically.
- With multiple sessions, show a chooser at startup rather than guessing.
- Always identify the active session in the application header.
- Provide an explicit action to return to the chooser and switch sessions.
- Render only workspaces linked to the active session.
- Return to the chooser if the active session is deleted.

The daemon continues to publish authoritative state for all sessions. The TUI filters the snapshot using its client-local active session. Session-scoped snapshots and persisted last-active-session preferences are unnecessary for this version.

Switching sessions does not start, stop, suspend, duplicate, or restore processes. Runtime ownership remains entirely with the single daemon.

## Persistence

Replace direct session ownership on `workspaces` with a join table:

```sql
CREATE TABLE session_workspaces (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, workspace_id)
);
```

The `workspaces` table retains the canonical workspace ID and name but no longer stores `session_id` or `position`. Position belongs to the membership because a shared workspace may be ordered differently in different sessions.

Deleting a session deletes only that session and its memberships. It does not delete workspaces or any descendant work and does not stop live runtimes. Deleting a workspace removes all of its memberships and follows the existing cascading ownership chain for its descendants.

Empty sessions and workspaces with no session memberships are valid durable states. Normal TUI creation links a new workspace immediately, so an unlinked workspace should arise only through explicit membership removal or non-interactive commands.

## Snapshot

The snapshot exposes canonical sessions and workspaces plus explicit memberships:

```ts
type Snapshot = {
  sessions: { id: string; name: string; position: number }[];
  workspaces: { id: string; name: string }[];
  sessionWorkspaces: {
    sessionId: string;
    workspaceId: string;
    position: number;
  }[];
  // Existing categories, projects, items, surfaces, tabs, panes, and histories.
};
```

Categories remain generated once per workspace. Projects continue to reference a workspace directly. No session ID is added to projects or lower-level entities.

## Commands

The server supports these session and membership operations:

- `session.create`: create an empty named session.
- `session.delete`: delete a session and its memberships without deleting workspaces.
- `workspace.create`: create one canonical workspace and atomically link it to the supplied session. Its existing `sessionId` input remains the convenience context for this operation.
- `session.workspace.add`: link an existing workspace to a session at the next position.
- `session.workspace.remove`: remove a membership without deleting the workspace.

Adding an existing membership and removing a missing membership are idempotent successful operations. Commands reject references to sessions or workspaces that do not exist. Each mutation remains a single SQLite transaction and follows the existing revision and snapshot broadcast flow.

The CLI exposes equivalent non-interactive commands with plain-text and JSON output. The TUI uses the same commands and does not mutate membership locally.

Session cloning, workspace cloning, and project copying are excluded. Linking a workspace automatically exposes all of its current and future projects, which addresses reuse without introducing synchronized copies.

## Migration

Add a SQLite migration that:

1. Creates `session_workspaces`.
2. Inserts one membership for each existing workspace using its current `session_id` and `position`.
3. Rebuilds `workspaces` without `session_id` and `position`.
4. Restores the required foreign keys and schema version.

The migration preserves all existing IDs, names, workspace ordering, descendants, layouts, pane state, restore policies, and terminal history. It performs no runtime operation. A migration failure stops startup without resetting data, following the existing persistence contract.

## Failure Handling

- Deleting the session selected by a TUI causes that client to return to the chooser after applying the server snapshot.
- Removing a workspace from the active session removes it from navigation but leaves its processes and history untouched.
- A duplicate membership does not create another row or alter descendant data.
- A stale membership command referencing a deleted session or workspace fails as a protocol error.
- A failed membership mutation does not update client-visible state or runtime state.

## Verification

Keep verification focused on the changed boundaries:

1. Migrate the existing ownership schema and verify that sessions, workspace order, descendants, and terminal history are unchanged.
2. Link one workspace to two sessions and verify that both expose the same workspace and projects without duplicate project rows.
3. Remove a membership and delete a session, verifying that the workspace, descendants, history, and eligible live runtime remain intact.
4. Verify idempotent add and remove behavior plus missing-resource errors.
5. Verify that TUI navigation renders only the active session's memberships and that independent clients may select different sessions.
6. Exercise session creation, deletion, and membership commands through the real CLI and daemon.
7. Run the complete `bun run check` gate.

## Deliberate Exclusions

- Project-level session filters.
- Copied or forked workspaces and projects.
- Session templates or profile cloning.
- Persisted global or per-client last-active-session preferences.
- Session-specific project, item, surface, tab, or pane state.
- Suspending or stopping runtimes when a session becomes hidden.
- Per-session daemons or databases.
- Session-scoped server snapshots or subscriptions.

These exclusions keep sessions useful as focused workspace compositions without turning them into a second ownership model or runtime boundary.

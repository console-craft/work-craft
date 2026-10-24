# Architecture overview

Work Craft is a local-first work organizer with persistent terminal workspaces.
This is the current implementation overview, not a roadmap or a historical
acceptance record. Start with the [README](../../README.md) for installation and
everyday use.

## Process model

```text
one executable: src/main.ts
   ├── no arguments → React/OpenTUI client
   ├── CLI arguments → non-interactive API client
   └── internal daemon arguments → Bun daemon

TUI clients ──┐
              ├── owner-only Unix socket ── one daemon per state directory
CLI clients ──┘                              ├── SQLite
                                             ├── PTYs and child processes
                                             └── terminal parsers and history
```

The daemon starts on demand and outlives its clients. A client can disconnect,
reconnect or be replaced without terminating its running terminals. Separate
`WORK_CRAFT_HOME` directories create independent installations, not coordinated
servers. The supported operating systems are macOS and Linux.

The implementation is a modular monolith, not a distributed system. The server
owns durable state, terminal processes and recovery; the TUI and CLI are
disposable clients. Neither client reimplements domain rules.

## Product model

- **Sessions** are named attachment profiles. Each has workspace memberships and
  its own durable workspace/category/item/tab/pane selection and tab/pane memories.
- **Workspaces** are reusable organizational contexts shared through session
  membership. Deleting a session does not delete its workspaces or stop terminals.
- Each workspace has six categories: Inbox, Today, Design, Coding (the
  `implementation` API value), Collaboration and Operations.
- **Items** are roots or one-level children in the same workspace/category.
  Non-Coding categories currently use generic items. Coding uses registered
  directories and discovered Git worktrees.
- An item at either level can lazily own one **surface**, containing ordered
  **tabs**. A tab owns a recursive binary split layout whose leaves reference
  stable **pane IDs**. Only terminal panes are implemented.

Directory registration and read-only Git discovery belong to the daemon.
Repository groups are workspace-scoped: the primary checkout is the root and
linked worktrees are children. Registration never creates/deletes a checkout or
changes its branch. CLI/API registration is metadata-only; the TUI explicitly
opens the requested checkout after registration.

## State ownership

| State                                                                                                   | Authority                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Sessions, memberships, items, surfaces, layouts, navigation memories and restore policies               | Daemon, persisted in SQLite |
| Bounded terminal bytes and resize/runtime boundaries                                                    | Daemon, persisted in SQLite |
| PTYs, live parsers, runtime generations, connections and terminal-size election                         | Daemon memory               |
| Attachment, keyboard focus, browse candidates, filters, expansion, overlays, drafts and scroll position | Individual client           |

Clients attached to the same session share authoritative navigation and the same
running terminal programs. They do not share local focus, drafts or browsing
cursors. Different sessions keep independent selections even when they use the
same workspace and terminals. Terminal dimensions are elected across viewers,
not independently applied by every leaf.

## Commands and synchronization

The [HTTP interface](../../packages/server/src/api/http.ts) exposes `/health`,
`/snapshot`, `/control`, `/command`, `/panes/:id/history` and the `/stream`
WebSocket. Both command transports reach the same application command handler.

```text
client semantic command
   → validate protocol and current caller scope
   → resolve asynchronous prerequisites; revalidate before mutation
   → commit domain changes in a SQLite transaction
   → publish the new revision and reconcile terminal geometry
   → perform runtime effects, publishing subsequent process-status changes
```

A failed transaction does not apply its runtime effects. A spawn failure after
commit leaves the pane recorded with a failed status; it does not pretend the
structural operation never happened. A command response identifies its committed
revision, which may precede later status updates.

Each daemon start has a fresh epoch. Clients use revisions and scoped generations
to reject obsolete work and resynchronize after gaps or reconnection. SQLite is
the authoritative current state, not an event store. Backpressure disconnects a
slow stream rather than allowing unbounded output queues.

The production TUI uses history-free control snapshots plus bounded per-pane
output recovery. Terminal output has pane-local subscriptions outside the root
React control subscription. The daemon parses ANSI and answers child queries;
the TUI requests portable cell/cursor material and draws it. Receiving an old
picture or old output never grants permission to type into a child.

## Persistence and recovery

SQLite uses foreign keys and, for file databases, WAL with full synchronous
commits. Structural mutations commit immediately; terminal output is batched.
Client reconnect leaves existing runtimes intact. Daemon restart reconstructs
retained display and starts fresh shells for eligible interrupted panes; stopped
panes stay stopped. No arbitrary process memory is restored.

See [terminal lifecycle and recovery](references/terminal-lifecycle.md) for the
input gates, retention limits, state directory, migration/reset safety and known
runtime/fidelity limitations.

## Boundaries and further reading

- [Ownership and source map](references/ownership.md): where changes belong and
  the import, focus and terminal-identity invariants.
- [Development and verification](references/development.md): setup, commands,
  current test policy, builds and manual diagnostics.
- [Agent guidelines](../../AGENTS.md): contribution rules and workflow locations.

Remote access, distributed coordination, plugins, specialized non-Coding category
screens, built-in data panes, agent automation and Neovim/OpenCode restore metadata
are not implemented. Running those programs in a shell is distinct from restoring
their application state. Avoid adding abstractions for these future capabilities
without an explicit requirement.

# Daemon and durable state

[Overview](../overview.md) / [Foundations](overview.md) / Daemon and durable state

Topic 1 of 4

[Next: Client coordination](client-coordination.md)

One daemon owns the database and shell registry for a state directory. Clients
find or launch it and communicate over a Unix socket. Database transactions define
durable changes; PTY startup, filesystem/Git inspection, and notifications are
coordinated around those transactions rather than pretending to be atomic with
external processes.

## Startup and local ownership

`resolvePaths` uses `WORK_CRAFT_HOME` when present, otherwise
`$XDG_STATE_HOME/work-craft`, falling back to `~/.local/state/work-craft`.
It places `work-craft.sqlite`, `work-craft.sock`, and `daemon.lock` there.
The state directory is mode 0700 and socket/lock mode 0600. The server has no TCP
listener, user login, or credential exchange; access relies on local filesystem
permissions.

`ensureDaemon` first checks health and terminal protocol identity. If it cannot
connect, it launches a detached daemon using the current source runtime or compiled
executable and polls for bounded startup. Several clients may race to do this.
`runDaemon` arbitrates ownership through exclusive lock creation, PID/liveness
checks, and ticketed stale-lock takeover with file identity checks. It refuses to
replace a healthy socket and removes only files it still owns during cleanup.

After locking, the daemon opens the database, constructs the app, recovers eligible
panes, starts directory refresh, and finally serves requests. Health includes a
new epoch UUID, in-memory revision, PID, and terminal protocol ID. A daemon restart
creates a new epoch even if the saved catalog is unchanged.

## Durable ownership and transaction boundaries

SQLite stores sessions, workspaces and ordered memberships; item payloads and
ancestry; surfaces, tabs and JSON split layouts; pane restore policies/status;
session navigation and selection memories; terminal byte chunks and grid/start
metadata. Categories are generated from code rather than stored as rows.

Disk databases use foreign keys, WAL, and `synchronous=FULL`. New empty databases
receive schema version 1. An unknown schema version, or an unversioned nonempty
database, fails to open without changing data. A database labelled version 1 is
accepted without a complete table-shape audit. There is no upgrade chain that
transforms an older populated layout into this one. Destroy mode can deliberately
replace incompatible state; it is a destructive command, not automatic recovery.

`applyCommand` runs synchronously in a SQLite transaction. It couples structural
mutation, session cursor normalization, and requested activation. Async directory
inspection and split cwd sampling happen first; attachment/context checks are
repeated after awaits before committing. The command returns runtime spawn effects
which `createApp.execute` applies after commit. Metadata publication also precedes
spawn completion, so clients must handle a committed pane whose startup later
fails. The [terminal-workspace sequence](../capabilities/terminal-workspaces.md#from-item-to-running-shell)
shows this ordering across the database, runtime, and client.

The daemon revision increments on published metadata changes, including process
status and directory reconciliation. Terminal byte cursors and geometry sequences
advance separately. A large control/full snapshot is announced as available and
retrieved over HTTP rather than filling one WebSocket message with history.
[Client coordination](client-coordination.md) owns these synchronization details.

## Stop, destroy, and restart

Normal stop drains the stop request briefly, closes the server and directory
inspection, flushes history, stops runtime process trees while preserving saved
status, flushes/closes history, closes SQLite, and removes owned socket/lock files.
Signals also request shutdown. Cleanup attempts continue after an error, and
failures are surfaced rather than silently reported as success.

Destroy additionally removes the SQLite database and its WAL/SHM files only after
required runtime/history/database cleanup succeeds. CLI syntax requires an
explicit force flag, then waits for file removal. Ordinary stop retains all saved
work and bounded history. Reopening a TUI after stop may automatically launch a
new daemon and start fresh shells for previously live panes; merely closing the
TUI leaves the existing daemon and processes alive.

No promise of full crash atomicity spans SQLite and processes. A committed pane
can exist without a successful shell spawn; buffered output can precede its disk
flush. Recovery uses saved status and display data to establish a usable new
runtime, not an old process checkpoint.

## Investigate

[paths.ts](../../packages/server/src/daemon/paths.ts),
[lifecycle.ts](../../packages/server/src/daemon/lifecycle.ts), and
[startup.ts](../../packages/server/src/client/startup.ts) own discovery and service
lifetime. [database.ts](../../packages/server/src/persistence/database.ts) is the
schema and compatibility authority. [app.ts](../../packages/server/src/application/app.ts)
is the coordination point for transactions, external effects, and publication.

[Next: Client coordination](client-coordination.md)

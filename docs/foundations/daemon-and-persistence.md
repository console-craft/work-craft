# Local daemon, persistence and safe operation

State reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Client synchronization](client-synchronization.md)

**The state directory is the installation boundary.** It identifies one daemon,
one SQLite database and one Unix socket. Different homes are independent local
installations, not cooperating servers. Clients do not own the database or shell
lifecycle.

## Paths and startup

Path resolution prefers `WORK_CRAFT_HOME`, then `$XDG_STATE_HOME/work-craft`, then
`~/.local/state/work-craft`. It produces:

- **`work-craft.sqlite`:** application rows and terminal history. SQLite can add
  `-wal` and `-shm` sidecars.
- **`work-craft.sock`:** HTTP/WebSocket Unix socket, mode `0600` (owner read/write).
- **`daemon.lock`:** exclusive daemon ownership with a published PID, mode `0600`.

The daemon restricts the state directory to its owner with mode `0700`. Startup
acquires the lock before touching the socket or database. Competing starters
coordinate before taking over a stale lock and check that the file identity has
not changed. Cleanup removes only lock/socket files still owned by that daemon,
so it cannot remove a replacement daemon's files. A healthy existing socket is
not blindly removed.

Client startup first checks health/protocol, then launches a detached daemon if
connection fails. Source mode launches the server entry point with Bun; compiled
mode launches the same executable with an internal argument. Startup has a bounded
health wait and captures failure diagnostics. Ordinary startup opens the database,
recovers eligible terminals and starts discovery before serving clients.

## Durable state and compatibility

SQLite stores sessions, memberships, items, surfaces, tabs/layouts, panes/restore
policies, navigation/memories and terminal byte/geometry tables. Foreign keys are
enabled. File databases use SQLite's write-ahead log (WAL) and full synchronous
commits (`synchronous = FULL`). Domain changes use synchronous transactions.
Terminal bytes/markers are batched separately; see
[persistent terminals](../capabilities/persistent-terminals.md#history-and-restart-semantics).

The current baseline uses `PRAGMA user_version = 1`. An empty unversioned database
initializes atomically; version 1 reopens without a migration. Other versions and
nonempty unversioned databases are rejected before journal-mode changes. There is
no general migration runner or automatic reset during ordinary startup.

Version 1 is not a full schema fingerprint: the open path trusts that version and
does not compare all table definitions. Older development databases with a reused
version number are not thereby compatible. Use a fresh explicit home rather than
assuming an old backup or a mixed executable set can be opened safely.

Live pseudoterminals/parsers, the daemon's instance ID (epoch), client session
attachments and size decisions exist in memory. Restart creates fresh live state
from saved work and history; it does not deserialize an old running process.
[Client synchronization](client-synchronization.md) explains which identifiers
change and how clients reject responses from an old daemon.

## Shutdown and destruction

Normal stop rejects/drains discovery, closes transport, flushes history, stops
managed runtime trees, flushes final history and closes SQLite. Runtime shutdown
uses observed process identities to avoid signalling a reused PID. Saved running
statuses are preserved for fresh-shell recovery on the next daemon start.
Clients closing their own socket do none of this.

`daemon destroy --force` is deliberately destructive: **it stops managed runtimes
and deletes Work Craft's database and sidecars for the selected home.** If the
daemon is absent, the CLI starts a special non-recovering daemon; that path can
remove an incompatible database rather than restoring shells. The running-daemon
destroy path removes the database only after required shutdown/close steps succeed.
The CLI waits for database/lock/socket removal before confirming destruction.

Before an intentional reset:

1. Close reconnecting/watch clients.
2. Confirm the concrete home and the managed programs that will be stopped.
3. Set `WORK_CRAFT_HOME` explicitly; use compatible tooling for any running daemon.
4. Decide to discard those application records before using `daemon destroy --force`.

Destroy does not remove registered source directories or Git metadata. Do not
delete the whole state directory or manually remove a live daemon's lock/socket.
Normal `daemon stop` preserves records/history and is not a reset.

## Operational consequences

- Keep development/testing homes separate from everyday use.
- Stop an old daemon and restart clients coherently when changing versions. A
  passing terminal-protocol handshake is not a comprehensive compatibility guarantee.
- Recovery depends on the stored shell executable and cwd still existing. Missing
  targets produce pane failures; there is no automatic relocation or app-specific
  editor/session restore.
- Terminal output is persisted locally and may contain sensitive command output.
  Owner-only transport is not encryption of the database or its backups.

## Code References

- [paths.ts](../../packages/server/src/daemon/paths.ts) (`resolvePaths`): environment
  precedence and concrete filenames.
- [lifecycle.ts](../../packages/server/src/daemon/lifecycle.ts) (`runDaemon`):
  exclusive ownership, startup, shutdown and explicit database removal.
- [startup.ts](../../packages/server/src/client/startup.ts) (`ensureDaemon`):
  source/compiled launch and health coordination.
- [database.ts](../../packages/server/src/persistence/database.ts) (`openDatabase`):
  baseline schema, initialization and compatibility checks.
- [CLI main.ts](../../packages/cli/src/main.ts) (`waitForDestroyed`): destruction
  completion confirmation.

State reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Client synchronization](client-synchronization.md)

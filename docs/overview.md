# Work Craft architecture

Work Craft combines a local work catalog with persistent terminal workspaces.
**One daemon owns saved work and running terminals; the TUI and CLI are disposable
clients.** Closing an interface leaves its shells running. Restarting the daemon
restores retained display and starts fresh shells, not the memory of running
applications.

For installation and everyday controls, start with the [README](../README.md).

## Key Facts

- One [executable](../src/main.ts) runs in three modes: the React/OpenTUI interface, the
  non-interactive CLI or the background daemon.
- Each state directory has its own daemon, SQLite database and owner-only Unix
  socket. Different state directories are independent installations.
- Workspaces own items and terminal surfaces. Sessions select from workspaces;
  they do not own the programs running in them.
- Clients attached to the same session share its selected work, but keep their
  own focus, browsing, drafts and scroll positions.
- The daemon interprets terminal output and encodes terminal input. The TUI draws
  the resulting styled cells rather than running a second ANSI parser.

## Runtime model

```text
                         src/main.ts
                         one executable
                      /         |          \
               no arguments  CLI arguments  internal arguments
                    |             |                |
             React/OpenTUI       CLI             daemon
                    |             |                |
                    +------ owner-only Unix socket -+
                         HTTP + WebSocket           |
                                            application rules
                                             /           \
                                          SQLite      PTYs + native
                                                      terminal parsers
```

Clients start the daemon when needed. It outlives its clients, saves changes in
SQLite and owns the pseudoterminals (PTYs) that connect shells to terminal input
and output. This makes client reconnection independent of shell lifetime. The
Unix socket limits access to the local owner; there is no hosted service, remote
access setup or distributed coordination.

Both clients use the server's public client API. The CLI sends commands over HTTP.
The TUI also uses a WebSocket for shared state updates and interactive terminal
requests. Both transports reach the same application rules and transaction path.
See [daemon and persistence](foundations/daemon-and-persistence.md) for startup,
shutdown, schema handling and deliberate state destruction.

## Work model

```text
session -- ordered membership --> workspace
                                   |
                         six fixed categories
                                   |
                         root item --> child item (one level)
                              \          /
                           each may own one surface
                                   |
                              ordered tabs
                                   |
                           binary split layout
                                   |
                           stable terminal pane IDs
```

A **workspace** groups work into Inbox, Today, Design, Coding, Collaboration and
Operations. Coding uses the API value `implementation` and contains registered
directories and discovered Git worktrees. Other categories contain generic items;
they do not yet have specialized integration screens. The API rejects generic
items in Coding.

An **item**, whether a root or a child, can own one **surface**. The surface holds
ordered tabs, and each tab's split layout refers to terminal panes. A pane has a
stable saved identity even when its shell is replaced. A **session** stores ordered
workspace memberships and remembers its selected workspace, category, item, tab
and pane.

For example, session A opens a worktree item for the first time. The daemon saves
its surface, tab and pane and selects them for A, then starts the shell. Session B
can later open that same item and use the same shell. If A moves elsewhere, B
stays on the item. Another client attached to A sees A's new selection, while
keeping its own keyboard focus and local drafts.

[Organizing work](capabilities/organizing-work.md) explains selection, resource
creation and navigation repair. [Directory discovery](capabilities/directory-discovery.md)
explains how filesystem and Git inspection update the catalog without deleting or
retargeting running terminals.

## Saved state, live state and display

- **SQLite holds durable state:** work records, memberships, surface/tab/pane
  structure, shell restore policies, session selections and tab/pane memories. It
  also holds bounded terminal bytes and the size/restart boundaries needed to
  reconstruct their display.
- **Daemon memory holds live state:** shell processes, terminal parsers,
  connections, current process identities and shared terminal-size decisions.
- **Each client holds local state:** attachment choice, recovered output buffers,
  focus, browse candidates, filters, expansion, dialogs, drafts and scroll offset.

Structural commands commit before runtime effects. If a transaction fails, it
starts no child. If a shell fails to start after commit, the saved pane remains
with a failed status. A successful command response therefore does not mean that
the intended terminal is already healthy, rendered or ready for input.

Clients can keep useful display during reconnection, but the daemon accepts input
only when it is still valid for the current client, selection, grid and shell.
These checks establish **authority**: permission to perform an operation now.
[Client synchronization](foundations/client-synchronization.md) explains the
identifiers and checks that prevent old responses or pictures from granting new
input permission.

[Persistent terminals](capabilities/persistent-terminals.md) explains process and
history lifetime, shared terminal dimensions and recovery. [Terminal interface](capabilities/terminal-interface.md)
explains how local intent, native focus and a displayed terminal picture become
ready to accept input.

## Where to investigate

- [Organizing work](capabilities/organizing-work.md): domain ownership, shared
  navigation, lazy surface creation and archive behavior.
- [Directory discovery](capabilities/directory-discovery.md): registration, Git
  worktree groups, path identity and unavailable checkouts.
- [Daemon and persistence](foundations/daemon-and-persistence.md): startup,
  shutdown, storage compatibility and reset safeguards.
- [Client synchronization](foundations/client-synchronization.md): commands,
  snapshots, output recovery, connection changes and input checks.
- [Persistent terminals](capabilities/persistent-terminals.md) and
  [terminal interface](capabilities/terminal-interface.md): process/display
  recovery, focus, input, rendering limits and implementation boundaries.
- [Runtime choices](choices/runtime-boundaries.md): the consequences of one local
  daemon, SQLite transactions and the shared native terminal engine.
- [Development](foundations/development.md): source setup, test ownership, builds
  and verification. [AGENTS.md](../AGENTS.md) owns contribution policy.

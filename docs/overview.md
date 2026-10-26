# Work Craft architecture

Work Craft is a local-first work organizer with persistent terminal workspaces.
**One daemon owns saved work and running terminals; the TUI and CLI are disposable
clients.** Closing a client leaves its shells alive. Restarting the daemon restores
retained display and starts fresh shells, not the memory of running applications.

For installation and everyday controls, start with the [README](../README.md).

## Key Facts

- One Bun executable dispatches to a React/OpenTUI interface, a non-interactive CLI
  or an internal daemon entry point.
- Each state directory has its own daemon, SQLite database and owner-only Unix
  socket. There is no remote service, distributed coordination or plugin system.
- Sessions share workspaces and terminals but retain independent durable navigation.
  Clients attached to the same session share selection, not local focus or drafts.
- The daemon parses child ANSI output and encodes semantic input. The TUI draws
  portable styled cells; it is not a second terminal emulator.
- Durable structure commits before runtime effects. A shell spawn failure leaves
  a recorded failed pane rather than rolling back a committed workspace operation.

## Runtime model

```text
                         src/main.ts
                     one compiled executable
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

Clients start the daemon on demand. It outlives those clients and serializes
structural mutations through synchronous SQLite transactions. Asynchronous Git,
cwd and display-reconstruction work is checked against current scope before its
results are used. See [daemon and persistence](foundations/daemon-and-persistence.md)
for startup, shutdown, schema handling and destructive-operation safeguards.

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

Categories are Inbox, Today, Design, Coding (`implementation` in the API),
Collaboration and Operations. Coding exposes directories and discovered Git
worktrees; other categories currently offer generic items and terminal surfaces,
not specialized integration screens. The API also permits generic Coding items.

[Organizing work](capabilities/organizing-work.md) explains ownership, navigation
and lazy surface creation. [Directory discovery](capabilities/directory-discovery.md)
explains read-only Git inspection and why missing paths do not delete terminals.

## State and communication boundaries

| State                                                                                                       | Authority and lifetime             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Sessions, memberships, items, surfaces, tabs, layouts, pane restore policies and session selection/memories | Daemon; SQLite                     |
| Bounded terminal bytes and resize/runtime-start boundaries                                                  | Daemon; batched SQLite persistence |
| Processes, live parsers, runtime generations, connections and size election                                 | Daemon memory                      |
| Attachment choice, native focus, browse candidates, filters, expansion, drafts, overlays and scroll offset  | Individual client                  |

The TUI uses history-free control snapshots and separate pane-local output
subscriptions. Revision gaps trigger snapshot refresh; output gaps trigger bounded
history recovery. Epoch, attachment, navigation, geometry and runtime identities
prevent old work from acquiring new input authority. Readable display is not
permission to type. See [client synchronization](foundations/client-synchronization.md).

[Persistent terminals](capabilities/persistent-terminals.md) owns process/history
lifecycle and shared sizing. [Terminal interface](capabilities/terminal-interface.md)
owns client composition, keyboard/focus policy and native presentation readiness.

## Implementation landmarks

| Entry point                                                                   | Responsibility                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [src/main.ts](../src/main.ts)                                                 | Select TUI, CLI or daemon                                           |
| [server application](../packages/server/src/application/app.ts) (`createApp`) | Coordinate domain transactions, publication, discovery and runtimes |
| [client facade](../packages/server/src/client.ts) (`createClient`)            | Public client-safe transport and shared contracts                   |
| [TUI app](../packages/tui/src/app.tsx) (`App`)                                | Compose the store, shell and theme                                  |
| [CLI main](../packages/cli/src/main.ts)                                       | Parse arguments, resolve caller paths and print results             |

The [development guide](foundations/development.md) covers setup, test ownership,
gates and release mechanics. [Runtime choices](choices/runtime-boundaries.md)
describes the consequential local-daemon and native-terminal commitments.

Superpowers specs and local plans live separately in repository-root
`.superpowers/`; see the
[development guide](foundations/development.md).

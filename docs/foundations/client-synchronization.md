# Client synchronization and input authority

**Snapshots describe authoritative state; scoped identities decide whether work
is still usable.** A saved picture, recovered output or old command response
cannot grant permission to type into a newer selection or runtime.

## Transport and publication

The daemon exposes HTTP and WebSocket over its owner-only Unix socket:

| Route                                 | Purpose                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /health`                         | Daemon epoch, revision, PID and terminal-protocol identity                       |
| `GET /snapshot`                       | Full structural snapshot including retained terminal history                     |
| `GET /control`                        | History-free structure, navigation, geometry and pane runtime identities         |
| `POST /command`                       | Parse and execute a semantic domain command                                      |
| `GET /panes/:id/history?after=CURSOR` | Bounded retained pane bytes and geometry                                         |
| `GET /stream`                         | WebSocket: snapshots, attachment, commands, geometry, output, material and input |

The production TUI connects with `/stream?view=control`; full snapshots remain
available to CLI/API consumers. Both command transports converge on
`createApp.execute`, including domain validation and transactional mutation.
HTTP commands are not tied to an interactive attachment. Attached commands carry
the actual socket's current attachment generation; session-navigation/activation
operations are checked against its session as well.

Structural/status changes publish increasing revisions within one daemon epoch.
Output and geometry have their own ordering, rather than incrementing the root
revision for every byte. Snapshots above 512 KiB become availability notifications;
the client fetches the corresponding HTTP snapshot. A missed revision also triggers
a fresh snapshot, not an attempted event-log replay.

## Independent identity clocks

| Identity                                   | What it invalidates or orders                             |
| ------------------------------------------ | --------------------------------------------------------- |
| Daemon epoch                               | All identities from a previous daemon instance            |
| Snapshot revision                          | Structural/status publication and command completion      |
| Connection/store run                       | Work from an old socket or disposed client-store lifetime |
| Attachment generation                      | Work prepared before changing/detaching the session       |
| Session navigation generation              | Work against an older workspace/item/tab/pane selection   |
| Per-tab geometry generation                | Input/material against obsolete ownership or grid scope   |
| Global geometry sequence                   | Geometry notifications and output's geometry ordering     |
| Pane runtime generation                    | Work for a replaced shell/parser in the same durable pane |
| Pane byte cursor / history marker sequence | Retained output and resize ordering, not user authority   |

`InputStamp.geometrySequence` is named for the **per-tab generation**, not the
global geometry sequence. Treating them as interchangeable would invalidate input
for unrelated tabs or admit stale geometry. Byte/history recovery never supplies
a new input sender.

## Recovery without restarting shells

The TUI store holds control state separately from `TerminalOutputs`. Ordinary
output updates only the affected pane's subscribers. Duplicate/obsolete output is
ignored; missing cursors or resize markers trigger history recovery. Up to four
abortable pane-history requests run concurrently, each obtaining a full retained
baseline rather than a native-renderer consumption frontier.

Recovery is scoped to store run, connection, attachment request, epoch, navigation
and runtime. Completion publishes even if no fresh bytes arrived. Until recovery
and current presentation are ready, retaining a picture does not enable input.

Reconnect clears attachment authority immediately and tries a bounded delay
sequence before ensuring/reconnecting the daemon. Manual reload replaces the
socket, not the daemon. Pending work from prior runs is ignored/canceled. The
transport rejects in-flight RPCs when it closes; commands and keystrokes are not
automatically replayed, because a lost response does not establish non-execution.

## Trust boundary and bounded work

The daemon derives connection identity from the actual socket, validates protocol
payloads, and checks session membership, active layout, ancestry, runtime and grid
scope. Asynchronous material reconstruction is rechecked before responding. Write
eligibility additionally needs a current selected running pane and usable viewer.
Reading a stopped pane is allowed without granting write permission.

Semantic events are encoded using the daemon parser's current modes. Paste uses
bounded begin/chunk/commit assembly with scope checks; other input cannot overtake
a pending paste or semantic write. A PTY drain acknowledgment is not confirmation
that an editor/shell executed the input.

Both peers bound interactive requests at 128. Stream/envelope and queued-work
budgets are 8 MiB; a slow server-side stream is disconnected at backpressure
rather than retaining an unbounded queue. Client overflow triggers reload/recovery.
Material responses validate context, dimensions, cell encoding and finite budgets
before rendering. Scoped failures surface as errors, not invented empty success.

Health and WebSocket handshakes require the exact terminal protocol marker.
This guards incompatible terminal transports, not every possible mixed-version
schema/API change. Run coherent client/daemon versions against a state directory.
Filesystem access is the security boundary: this is a local same-user API, not
multi-tenant authentication or remote authorization.

## Code References

- [http.ts](../../packages/server/src/api/http.ts): routes, socket permissions,
  protocol errors and WebSocket backpressure.
- [protocol.ts](../../packages/server/src/api/protocol.ts),
  [interactive-protocol.ts](../../packages/server/src/api/interactive-protocol.ts)
  and [identity.ts](../../packages/server/src/api/identity.ts): contracts and validation.
- [connections.ts](../../packages/server/src/api/connections.ts)
  (`createConnections`, `projectionScope`): socket-bound attachment and read/write checks.
- [stream.ts](../../packages/server/src/client/stream.ts) (`openStream`): request
  lifecycle, snapshot gap recovery, paste transport and material validation.
- [store.ts](../../packages/tui/src/client/store.ts) (`createWorkCraftStore`):
  live authority, reconnect and bounded history recovery.
- [terminal-output.ts](../../packages/tui/src/client/terminal-output.ts) and
  [terminal-buffer.ts](../../packages/tui/src/client/terminal-buffer.ts): pane-local
  subscriptions and retained byte/geometry merging.

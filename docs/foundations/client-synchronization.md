# Client synchronization and input authority

State reading path — **2 of 2** · Previous:
[Daemon and persistence](daemon-and-persistence.md) · [Overview](../overview.md)

Clients receive replaceable views of daemon-owned state. They can keep a useful
picture while disconnected, but commands and terminal input need current
**authority**: permission to act on the selected work and running shell. An
operation's **scope** is the set of IDs and counters that describe which client,
selection, grid and shell it belongs to. The daemon checks that scope again when
it uses the request, so an old picture or response cannot grant new permission.

## One application, two transport styles

Both clients import the public `@work-craft/server/client` API. They do not open
SQLite or spawn managed shells. HTTP and WebSocket run over the same owner-only
Unix socket:

- **`GET /health`:** daemon instance, revision, PID and terminal protocol marker.
- **`GET /snapshot`:** structure with retained terminal history.
- **`GET /control`:** history-free structure, navigation, geometry and current
  shell identities.
- **`POST /command`:** execute a domain command.
- **`GET /panes/:id/history?after=CURSOR`:** bounded retained bytes and size markers.
- **`GET /stream`:** WebSocket for snapshots, attachment, commands, geometry,
  output, terminal material and input. **Material** means the portable picture of
  styled cells and cursor that the daemon produces for the TUI to draw.

The CLI uses HTTP commands. The production TUI fetches control state, opens
`/stream?view=control` and **attaches** that socket to a session. Attached commands
carry the current attachment counter. Session navigation and activation commands
are also checked against the attached session. Both transports reach
`createApp.execute` and the same application transaction path. HTTP commands have
no interactive attachment.

Filesystem permissions provide the local access boundary. Attachment checks
protect interactive work from session changes; they are not remote user or tenant
authentication. Health and stream handshakes require the exact terminal protocol
marker. This catches incompatible terminal transports, but does not verify every
possible schema/API difference. Use coherent client and daemon versions.

## Command order and failure

```text
client                  daemon application              SQLite / runtime
  | semantic command           |                              |
  |--------------------------->| parse + check attachment      |
  |                            | await directory/cwd work     |
  |                            | recheck attachment           |
  |                            |-- synchronous transaction -->| SQLite
  |                            |   mutate + repair + activate |
  |                            |<---------- committed --------|
  |<-- revisioned snapshot -----| reconcile clients/geometry   |
  |                            |---------- start pane ------->| PTY/parser
  |<-- later status/snapshot ---|<--------- starting/running --|
  |<-- result(commit revision) -|                              |
```

The transaction includes structural mutation, navigation repair and optional
selection of the exact resulting pane. It checks the expected navigation counter
inside the transaction. Attachment checks run again after asynchronous directory
inspection or cwd resolution, immediately before mutation.

A rejected transaction starts no child. A failed start after commit leaves the
pane recorded with a `failed` status and error text. The command result still
identifies the committed structural revision. Later process-status updates may
already have advanced the daemon further. The CLI checks returned panes in
control state for failed startup; the TUI also observes independent status updates.
A command response does not promise that a terminal is healthy or displayed.

Requests have transient increasing IDs, but there is no persistent command-result
log or idempotency key. A lost response does not establish whether the command
committed. Reconnect does not automatically replay commands or keystrokes; inspect
current state before deciding to repeat a creation command.

## Identifiers have different lifetimes

An **epoch** is a unique identifier created on each daemon start. A **generation**
is a counter that changes when a particular selection, attachment or runtime is
replaced. The protocol uses several counters because these changes are independent:

- **Daemon epoch:** separates every old daemon instance from the current one.
- **Snapshot revision:** orders published structural/status changes within an
  epoch. It is held in memory and does not advance for every output byte.
- **Connection/store run:** separates a new socket or client-store lifetime from
  work that was started by an old one.
- **Attachment generation:** changes when a socket changes or drops its session.
- **Navigation generation:** changes with a session's saved selection. It is
  persisted independently for each session.
- **Per-tab geometry generation:** changes with that tab's elected viewer or grid;
  it identifies the dimensions used to interpret terminal input and material.
- **Global geometry sequence:** orders geometry notifications and the size state
  associated with output. It is separate from the per-tab counter.
- **Pane runtime generation:** changes when the same saved pane starts a new
  shell/parser, after the previous PTY has drained. It is meaningful within an epoch.
- **Byte cursor / history marker sequence:** locates retained bytes and their
  resize order. These values do not permit input to a shell.
- **Material sequence:** identifies the parsed-output/resize version associated
  with a runtime picture. Scrolling does not advance this counter, and it is
  independent of the snapshot revision.

`InputStamp.geometrySequence` carries the **per-tab generation**, despite its
name. Using the global sequence here could reject input because an unrelated tab
changed, or accept input against obsolete geometry. Recovered output never
creates a new input sender.

## Control state and terminal output take separate paths

Control snapshots contain the catalog, layouts, shared navigation, process
metadata, geometry and current shell identities. Changed revisions publish
complete replacement snapshots. A revision gap triggers an HTTP refresh rather
than event-log replay. Snapshots above 512 KiB become availability notifications,
which tell the client to fetch the corresponding HTTP snapshot.

Output notifications carry pane ID, epoch, runtime generation, byte cursor, bytes
and global geometry sequence. The TUI store rejects stale/duplicate output and
requests history after a byte or resize-marker gap. `TerminalOutputs` publishes
to the affected pane's subscribers without updating the root React control
subscription for each chunk. Those bytes establish output and recovery order;
the production display comes from daemon material requests, not local ANSI replay.

Up to four abortable history reads run concurrently. Each reads a full retained
baseline, merges later output and marks recovery complete even if no new bytes
arrived. Reads belong to a particular store run, connection, attachment request,
epoch, navigation destination and runtime. Changing those values cancels or
ignores old recovery. Input also waits for current terminal material to be
presented; completing a byte read alone does not make the leaf ready.

## Example: a socket disconnects while a shell runs

The store clears attachment authority as soon as it loses the socket. It can keep
buffers and a coherent same-session picture while it retries the connection. The
new socket handshakes, receives control state and reattaches the desired session
if it still exists. The store marks buffers as recovering and requests retained
baselines even if the structural revision has not changed. The viewport then
requests and presents material for the new scope.

An old callback cannot type through its captured sender: the socket or attachment
is obsolete, and client and daemon checks use live state. If reconnect attempts
fail, the client tries to ensure a daemon is running and connects again. Manual
reload replaces the socket without stopping the daemon. If a new daemon had to
start, its new epoch instead leads to
[cold recovery](../capabilities/persistent-terminals.md#history-and-restart-semantics)
and eligible fresh shells. Reconnecting to an existing daemon neither respawns
its shells nor adds a shell-restored separator.

## Validate requests and bound pending work

The daemon derives connection identity from the actual socket. It checks protocol
payloads, membership, active layout, item ancestry, shell generation and grid.
Material reconstruction can await work, so it checks the scope again before
responding. Writes also require the selected running pane and a usable viewer.
Stopped material can remain readable without permission to write.

Semantic key/mouse/paste/focus events are encoded with the daemon parser's current
modes. Paste uses bounded begin/chunk/commit assembly, with scope checks; other
input cannot overtake a pending paste or semantic write. A PTY drain acknowledgment
means the write buffer drained, not that a shell/editor executed the input.

Both peers limit interactive requests to 128. Stream/envelope and queued-work
budgets are 8 MiB. Slow server-side streams disconnect at the backpressure limit;
client overflow triggers reload and recovery. Material validation checks context,
dimensions, cell encoding and budgets before rendering. A request that exceeds
its budget reports an error rather than returning an empty success picture.

## Code References

- [app.ts](../../packages/server/src/application/app.ts) (`execute`, `publishChange`,
  `controlSnapshot`, `onOutput`): command ordering and distinct control/output flows.
- [http.ts](../../packages/server/src/api/http.ts): routes, socket permissions,
  protocol errors and WebSocket backpressure.
- [protocol.ts](../../packages/server/src/api/protocol.ts),
  [interactive-protocol.ts](../../packages/server/src/api/interactive-protocol.ts)
  and [identity.ts](../../packages/server/src/api/identity.ts): message validation.
- [connections.ts](../../packages/server/src/api/connections.ts)
  (`createConnections`, `projectionScope`): attachment and read/write checks.
- [client.ts](../../packages/server/src/client.ts) (`createClient`) and
  [stream.ts](../../packages/server/src/client/stream.ts) (`openStream`): public
  client API, requests, snapshot gaps, paste transport and material validation.
- [store.ts](../../packages/tui/src/client/store.ts) (`createWorkCraftStore`):
  live checks, reconnect and bounded history recovery.
- [terminal-output.ts](../../packages/tui/src/client/terminal-output.ts) and
  [terminal-buffer.ts](../../packages/tui/src/client/terminal-buffer.ts): pane-local
  subscriptions and retained byte/geometry merging.

State reading path — **2 of 2** · Previous:
[Daemon and persistence](daemon-and-persistence.md) · [Overview](../overview.md)

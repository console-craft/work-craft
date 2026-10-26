# Runtime boundaries and consequential choices

**Work Craft keeps processes and terminal interpretation in one local daemon,
while its clients can be replaced.** These are current implementation choices.
The explanation below describes their consequences without assuming why earlier
authors made them.

## One daemon owns local state and processes

The Unix-socket daemon owns SQLite mutations, discovery, shell processes, parser
state and shared terminal-size decisions. Clients submit commands that name an
operation instead of reimplementing domain rules. The same executable contains
all three entry points; workspace packages are code boundaries, not independently
deployed services.

A client can therefore reconnect or be replaced without changing process
lifetime, and clients in the same session have one saved selection. The daemon
also determines availability: if it fails, live shell continuity ends. Recovery
can only start fresh shells and reconstruct retained display. Filesystem permissions provide
the local security boundary; there is no remote identity/authentication layer.

**Changeability — Major migration:** remote access or distributed/multi-owner
operation would require new authentication, transport, storage/process ownership,
failure and conflict contracts, not simply exposing the socket over TCP.

## Save current state before running process effects

SQLite holds the current domain model, not an event log. Synchronous transactions
combine structural changes, navigation repair and optional selection of the
exact resulting pane. Process effects happen afterward; failures become further
status updates.
Terminal output uses a separate bounded batched retention path.

A pane can therefore be saved even if its shell fails to start. The client must
show that failure on the pane rather than assume the whole operation rolled
back. Clients also wait for the correct commit and current display readiness; a
command response alone does not mean a terminal is ready to receive input. The
[synchronization sequence](../foundations/client-synchronization.md#command-order-and-failure)
shows this order and its failure behavior.

**Changeability — Coordinated change:** command/effect semantics involve domain
transactions, publication, clients and lifecycle tests. Replacing SQLite would be
a major migration because schema/transaction/durability assumptions cross those
boundaries. The current schema has no general upgrade pipeline.

## Native parsing in the daemon, explicit cells in the client

Both server and TUI pin `@opentui/core` at `0.6.6`; the TUI also uses its React
binding and React `19.3.1`. The server uses public native context/embedded-terminal
APIs to parse output, answer queries, encode input and extract **material**, a
portable picture of styled cells and cursor. The TUI draws those cells without
sharing native buffer references or glyph IDs, and without its own ANSI parser.

Keeping terminal modes in one parser avoids duplicate query replies and
conflicting input encoding from different clients. It requires a versioned
protocol for pictures and input events. Each request carries its current client,
selection, grid and shell identities, which the daemon validates before use.
Native resources need explicit cleanup, and reconstruction uses finite budgets.
This does not remove limitations in the native terminal display. The current
mode-2048 workaround and
[known display limits](../capabilities/persistent-terminals.md#known-limitations-and-unresolved-risks)
are part of that commitment.

**Changeability — Coordinated change:** a native-engine upgrade touches server
projection/capture, client material rendering, protocol codecs and behavioral
contracts. Compatibility probes supplement product gates; they do not replace
end-to-end acceptance. Reverting to client-side ANSI replay would additionally
redesign query/input authority and recovery.

## Code References

- [src/main.ts](../../src/main.ts) and
  [server package exports](../../packages/server/package.json): executable and client boundaries.
- [app.ts](../../packages/server/src/application/app.ts) and
  [commands.ts](../../packages/server/src/application/commands.ts): state/effect ordering.
- [projection.ts](../../packages/server/src/terminal/projection.ts),
  [terminal-material-codec.ts](../../packages/server/src/api/terminal-material-codec.ts)
  and [terminal-material.ts](../../packages/tui/src/workbench/terminal-material.ts):
  native-to-portable rendering boundary.
- [probe-opentui-compatibility.ts](../../scripts/probe-opentui-compatibility.ts):
  opt-in isolated upstream compatibility investigation.

# Runtime boundaries and consequential choices

**Work Craft couples persistent local process ownership with disposable clients
and a daemon-owned native terminal engine.** These are implemented boundaries,
not a reconstruction of why earlier authors chose them.

## One local authority

The Unix-socket daemon owns SQLite mutations, discovery, shell processes, parser
state and size arbitration. Clients submit semantic operations instead of
reimplementing domain rules. The same executable contains all three entry points;
workspace packages are code boundaries, not independently deployed services.

This makes client replacement/reconnection independent of process lifetime and
gives shared sessions one authoritative selection. It also means the daemon is
the availability boundary: its failure ends live shell continuity, and recovery
can start only fresh shells plus retained display. Filesystem permissions provide
the local security boundary; there is no remote identity/authentication layer.

**Changeability — Major migration:** remote access or distributed/multi-owner
operation would require new authentication, transport, storage/process ownership,
failure and conflict contracts, not simply exposing the socket over TCP.

## SQLite current state, effects after commit

SQLite holds the current domain model, not an event log. Synchronous transactions
combine structural changes, navigation repair and optional activation. Runtime
effects happen afterward; process-status failures become further state updates.
Terminal output uses a separate bounded batched retention path.

The consequence is explicit partial success: a durable pane may exist with failed
runtime startup. Pretending spawn is part of a rollback would misrepresent both
saved state and external effects. Clients must wait for the correct commit and
current readiness rather than treating a response as a rendered live terminal.

**Changeability — Coordinated change:** command/effect semantics involve domain
transactions, publication, clients and lifecycle tests. Replacing SQLite would be
a major migration because schema/transaction/durability assumptions cross those
boundaries. The current schema has no general upgrade pipeline.

## Native parsing in the daemon, explicit cells in the client

Both server and TUI pin `@opentui/core` at `0.6.6`; the TUI also uses its React
binding and React `19.3.1`. The server uses public native context/embedded-terminal
APIs to parse output, answer queries, encode input and extract portable material.
The TUI draws material without sharing borrowed native planes, glyph IDs or an
independent ANSI parser.

One parser/mode authority avoids per-client query replies and conflicting input
encoding. It requires a versioned material/semantic transport, scope validation,
native-resource cleanup and explicit reconstruction budgets. It does not make
native fidelity limitations disappear. The current mode-2048 workaround and
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

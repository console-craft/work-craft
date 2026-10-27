# Terminal authority

[Overview](../overview.md) / [Choices](overview.md) / Terminal authority

Topic 2 of 3

[Previous: Local service and storage](local-service.md) | [Next: Durable work model](durable-work-model.md)

The live daemon parser is the common truth for both display and input encoding.
Clients render copied material instead of interpreting PTY bytes into independent
terminal states. This preserves child query handling without viewers and avoids
competing input modes across clients, while increasing dependence on daemon
native resources and a custom material/presentation protocol.

## Ownership of parsing and modes

Each runtime owns one embedded terminal. It writes output through that parser,
drains replies to the child, and uses its mode-aware semantic encoders. The
client-side material renderable has no ANSI parser; its local state concerns
selection, scrolling, clipping, and readiness. The protocol still carries raw
output/history for notification and repair, but that does not make visible
terminal interpretation client-owned.

**Changeability — Major migration:** Moving parsing to clients requires deciding
who answers child queries with no viewer, whose modes encode input, how parser
state is reconstructed at attach/resize, and how simultaneous clients agree.
It would replace assumptions in runtime, terminal material protocol, input
acknowledgment, history restoration, and viewport readiness. A second client-side
parser should not be introduced as an incidental rendering optimization.

## OpenTUI native adapter and React interface

Both the daemon projection and TUI renderer depend on OpenTUI core; React composes
the interface. `projection.ts` hides native resource management behind write,
resize, frame, encode, reply, transcript, and destroy methods. Portable text/color
frames keep native buffer handles and glyph IDs inside their owning context.
The codec and material renderer are a meaningful boundary, not a complete generic
terminal-backend abstraction.

**Changeability — Coordinated change:** Replacing the native terminal engine can
start at the projection adapter, but must preserve semantic input encoding,
portable cell widths/styles, terminal replies, scrollback extraction, resource
limits, and safe cold transcripts. Runtime consumers and compatibility tests need
joint validation. A native library upgrade also affects the TUI renderer using
the same core dependency. The existing mode 2048 workaround and regional-indicator
width mismatch make semantic compatibility more significant than matching types.

**Changeability — Local change:** Many ordinary UI/theme changes are isolated in
reusable UI and shell callers. They stay local when they preserve focus,
presentation readiness, status-row reservation, and measured canvas contracts.
Replacing React/OpenTUI rendering as a whole is a **Coordinated change** across
focus, events, custom material rendering, measurements, and post-presentation
acknowledgments; it cannot be confined to JSX syntax.

## Display-only history

History persists bytes plus grid and start markers. Cold replay converts them to
generated display commands in isolated parsers rather than restoring native
process/mode state. This sacrifices program continuation across daemon restart
while retaining useful output with a clean new child input environment.

**Changeability — Coordinated change:** Replacing byte history with a different
snapshot/transcript format requires preserving retention semantics, geometry,
runtime boundaries, stopped reads, and HTTP history contracts. Persisting native
parser snapshots would also create version compatibility and migration obligations.
There is no implemented guarantee that such a snapshot could restore an old
process or safely initialize a different engine.

## Source basis

[projection.ts](../../packages/server/src/terminal/projection.ts),
[runtime.ts](../../packages/server/src/terminal/runtime.ts),
[cold-history.ts](../../packages/server/src/terminal/cold-history.ts), and
[terminal viewport](../../packages/tui/src/workbench/terminal-viewport.tsx) establish
the ownership and ordering. See
[terminal display](../foundations/terminal-display.md) for fidelity limits and
[history](../foundations/terminal-history.md) for recovery invariants.

[Previous: Local service and storage](local-service.md) | [Next: Durable work model](durable-work-model.md)


# Ownership and source map

This is the current source-location and dependency reference. Read the
[architecture overview](../overview.md) first; terminal behavior is detailed in
[terminal lifecycle](terminal-lifecycle.md).

## Executable and packages

Paths in this table are relative to the repository root.

| Owner                                                                           | Responsibility                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src/main.ts`](../../../src/main.ts)                                           | Dispatch to TUI, CLI or internal daemon.                                                                                                   |
| [`packages/server/src/client.ts`](../../../packages/server/src/client.ts)       | Client-safe API, transport, protocol/material exports and daemon connection/startup. Public import: `@work-craft/server/client`.           |
| [`packages/server/src/api/`](../../../packages/server/src/api/)                 | HTTP/WebSocket transport, protocol validation, attachments, request/paste authority and material encoding.                                 |
| [`packages/server/src/application/`](../../../packages/server/src/application/) | Command orchestration and transactions, items/discovery, shared navigation, snapshots, recovery and terminal-size election.                |
| [`packages/server/src/persistence/`](../../../packages/server/src/persistence/) | SQLite baseline schema, initialization and compatibility checks.                                                                           |
| [`packages/server/src/daemon/`](../../../packages/server/src/daemon/)           | State paths, lock/socket ownership, startup, shutdown and explicit destruction.                                                            |
| [`packages/server/src/terminal/`](../../../packages/server/src/terminal/)       | PTY/process registry, native projection, bounded history, inert reconstruction, stopped-display cache, shell spawn and live cwd discovery. |
| [`packages/cli/src/`](../../../packages/cli/src/)                               | Argument validation, API calls and plain-text/JSON output; no interactive UI or duplicate domain logic.                                    |
| [`scripts/`](../../../scripts/)                                                 | Install/build support, compiled smoke, probes and cross-package process fixtures.                                                          |

## TUI capabilities

Paths below are relative to [`packages/tui/src/`](../../../packages/tui/src/).

| Owner                                              | Responsibility and entry points                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`, `app.tsx`                              | Renderer/terminal registration, demo selection and application/provider composition.                                                                                                                                                                                                                                                                                                  |
| `client/`                                          | `store.ts`: control synchronization, reconnect, attachment and live authorization. `terminal-output.ts`: pane-local publication. `terminal-buffer.ts`/`terminal-replay.ts`: bounded output and retained geometry/origin ordering. `use-work-craft.ts`: React subscription and production store lifetime.                                                                              |
| `input/`                                           | `command-router.ts`: keyboard interpretation and command metadata. `focus.ts`: pure spatial focus rules. No RPC execution.                                                                                                                                                                                                                                                            |
| `shell/`                                           | `shell.tsx`: application composition and keyboard/paste policy. `state.ts`: disposable UI state. `model.ts`/`context.ts`: projections and identities. `layout.ts`: responsive geometry.                                                                                                                                                                                               |
| Shell lifecycles                                   | `use-terminal-entry.ts`/`terminal-entry.ts`: exact-destination entry, cancellation and readiness. `use-shell-focus.ts`: native/logical focus and restoration. `use-shell-commands.ts`: RPC/submission protection. `errors.ts`/`use-shell-errors.ts`: scoped operational failures and expiry. `presentation.ts`: coherent same-session reconnect display, never live authority.        |
| `navigation/`                                      | Category/workspace item projections, root/child rows, filtering, expansion and path labels. Discovery stays server-owned.                                                                                                                                                                                                                                                             |
| `workbench/`                                       | `model.ts`/`layout.ts`: selected surface/tab, split geometry and viewport dimensions. `surface-view.tsx`: stable keyed leaves. `terminal-pane.tsx`: scope, gates and stopped actions. `terminal-viewport.tsx`: material requests/readiness/crop/scroll. `terminal-material.ts`: explicit cells/cursor/selection, not ANSI parsing. `terminal-input.ts`: bounded captured input queue. |
| `ui/`                                              | Reusable application-independent UI. `notifications.ts`: notification delivery/store. `renderer.ts`: explicitly invoked listener setup.                                                                                                                                                                                                                                               |
| `ui/interaction/`                                  | Focus scopes/eligibility, modal ownership, hints, pointer observation and rendered collection ordering/paging. Not application command routing or status-row policy.                                                                                                                                                                                                                  |
| `ui/theming/`                                      | Theme contracts, token resolution, React provider and bundled themes. Application composition selects the theme.                                                                                                                                                                                                                                                                      |
| `ui/primitives/`, `ui/controls/`, `ui/components/` | Local reusable views and concrete internal mechanisms. Prefer existing components, then native OpenTUI primitives; do not create generic engines for hypothetical reuse.                                                                                                                                                                                                              |
| `demos/`                                           | Standalone controls showcase and `components.tsx`, composed from `component-demos/` sections.                                                                                                                                                                                                                                                                                         |

`client/terminal-consumer.ts` supports the retained-output registry; it is not the
live material rendering path. The daemon's `terminal/projection.ts` is the parser
and child-query owner, not a native terminal renderer mounted by the TUI.

## Enforced imports

The [TUI lint configuration](../../../packages/tui/.oxlintrc.json) enforces these
rules for value/type imports, re-exports and dynamic imports:

- Import server APIs only through `@work-craft/server/client`.
- Use direct `@/` imports within the TUI, not relative internal imports or barrels.
- Shell composes capabilities; `client`, `input`, `navigation` and `workbench`
  must not import shell.
- Reusable `ui` must not import application capabilities or demos.
- Production code must not import tests or support. Test-specific allowances are
  limited to `tests/`; a real-config regression lives in
  [`tests/boundaries.test.ts`](../../../packages/tui/src/tests/boundaries.test.ts).

Do not move durable state, process ownership or domain validation into clients to
make a UI change easier.

## Identity, focus and timing invariants

- Preserve pane keys, keyed ancestry and stable terminal leaves across selection
  and geometry changes. Generic tab panels must not remount terminals on selection.
- Browsing a candidate, native keyboard focus, authoritative session selection and
  remembered pane are separate concepts. Do not substitute one for another.
- Entry waits for the exact command revision in the same epoch, its active
  destination, usable geometry and a presented current-scope picture. Split,
  restart and tab creation must never enter a convenient running sibling.
- New input/focus/navigation cancels obsolete entry. Closing a form or drawer may
  transfer only its own entry origin. Cancellation does not release restart
  submission protection before its authoritative response revision arrives.
- Read live store state in captured callbacks: native events can happen before a
  React commit. Keep synchronous intent memory distinct from rendered projections.
  Layout effects, measurement bridges and frame listeners are intentional here.
- Retaining a coherent body during reconnect is presentation only. Commands,
  viewport reporting and input forwarding still read live authorization.
- Overlays reserve the final one-row status bar; component-library full-screen
  defaults remain available. Operational failures use source-labelled status
  messages, field validation stays by its field, and child stderr stays terminal
  output. Reporting must not steal focus or unmount unrelated panes.

## Tests and fixtures

Script tests live in `scripts/tests/`; shared process fixtures remain in
`scripts/test-support/`.

TUI capability tests live in their owner's `tests/` directory. Keep UI tests with
their existing owners (`ui/tests`, `ui/interaction/tests`, `ui/theming/tests`,
`ui/components/tests`, `ui/controls/tests`, `ui/primitives/tests`); do not add a
wrapper directory for every source/test pair.

`packages/tui/src/tests/` is for package-wide acceptance and genuinely shared
support. Its retained shared-session and graceful-restart tests exercise real
processes. Place narrower fixtures with their consumer, such as
`shell/tests/fixtures.tsx`.

Server capability tests live in `api/tests/`, `application/tests/`, `daemon/tests/`,
`persistence/tests/` and `terminal/tests/`. Public client and package-wide acceptance
tests live in `packages/server/src/tests/`. Keep persistence fixture support with
its owning tests, even when other capability tests also consume it. CLI tests live
in `packages/cli/src/tests/`; the package does not need further test subdirectories.

Shell tests independently control command responses, snapshots, React commits,
native frames and buffered input. `publish(snapshot, false)` advances the real
store without rendering. Shared rendering uses real frames; shell fixtures add
their own readiness commit after measurement. Do not collapse those controls into
one generic flush or remove the measured-render bridge to make tests faster.

Connected shell/surface fixtures use
[`tests/support/material-stream.ts`](../../../packages/tui/src/tests/support/material-stream.ts),
which creates a real daemon parser per request and destroys it afterward.
These are integration fixtures, not proof that all capability tests are isolated.
Gate membership is defined by `scripts/test-gates.ts`, independently of capability
ownership. Keep new tests with their owner and in core by default; explicitly
classify real application/PTY acceptance and research/tooling without moving the
files. Missing/overlapping explicit entries fail selection. Before RED, identify
the protected failure and primary test owner; extend existing coverage before
adding a new permutation of the same contract. See
[development and verification](development.md#checks-and-test-execution) for the
commands, external deadlines and execution policy.

# TUI Source Map

The TUI is a disposable React/OpenTUI client. The local daemon owns durable
records, layouts, PTYs, discovery and history. Import its client-safe API only
through `@work-craft/server/client`; do not duplicate server business logic here.

All paths below are relative to `packages/tui/src/`.

## Where Changes Belong

| Owner                 | Responsibilities and entry points                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`, `app.tsx` | Native renderer/terminal registration and application composition.                                                                                                                                                                                                                                                                                                                                                   |
| `client/`             | `store.ts`: synchronization, reconnect, lifecycle invalidation and live authorization. `terminal-output.ts`: pane-local output publication outside the root control subscription. `terminal-buffer.ts`: retained history/chunks. `use-work-craft.ts`: React control subscription and production singleton lifetime only.                                                                                             |
| `input/`              | Global command interpretation, metadata and pure spatial focus rules; no RPC execution.                                                                                                                                                                                                                                                                                                                              |
| `shell/`              | `shell.tsx`: composition, live reducer wiring, one application keyboard/paste policy and presentation gates. `state.ts`: disposable selection/dialog reconciliation. `model.ts` and `context.ts`: projections and context identities. `layout.ts`: responsive shell geometry.                                                                                                                                        |
| Shell lifecycles      | `use-terminal-entry.ts`: request/origin ownership, cancellation, exact destination and native readiness. `terminal-entry.ts`: pure request rules. `use-shell-focus.ts`: native/logical focus, drawer/guard restoration and control memory. `use-shell-commands.ts`: RPC identity, submission and restart protection. `errors.ts` and `use-shell-errors.ts`: source retention, observation, deduplication and expiry. |
| `navigation/`         | Root/child rows, filtering, expansion presentation, path labels and ordered navigation projections. Discovery remains daemon-owned.                                                                                                                                                                                                                                                                                  |
| `workbench/`          | `model.ts`: exact surface/tab projections. `layout.ts`: split rectangles, viewport/recovery dimensions. `surface-view.tsx`: stable keyed sibling leaves. `terminal-pane.tsx`: native terminal replay/input/resize and unavailable-pane action.                                                                                                                                                                       |
| `ui/`                 | Reusable UI only, with no application imports. `notifications.ts`: notification store/delivery. `renderer.ts`: explicitly invoked listener configuration. `utils.ts`: small rendering helpers.                                                                                                                                                                                                                       |
| `ui/interaction/`     | Native focus scopes/eligibility, modal ownership, control hints, renderer-scoped pointer observation and rendered collection ordering/paging. Application keyboard routing, terminal-entry gates and status-row policy stay with their application owners.                                                                                                                                                           |
| `ui/theming/`         | `theme.ts`: contracts and token resolution. `theme-provider.tsx`: React context. `themes/`: bundled presets. Application composition chooses the theme.                                                                                                                                                                                                                                                              |
| `ui/components/`      | Public compound views remain in their named files. `list-cursor.ts`/`list-reveal.ts`, `command-state.ts`, `tabs-state.ts`/`tab-measurement.ts` own concrete internal mechanisms, not a generic collection engine.                                                                                                                                                                                                    |
| `demos/`              | `components.tsx` composes named `component-demos/*-demo.tsx` sections. `controls.tsx`, `demo-page.tsx` and theme shortcuts retain standalone demo behavior.                                                                                                                                                                                                                                                          |

Shell composes capabilities; client, input, navigation and workbench never import
shell. Reusable UI never imports application capabilities. Use direct `@/`
imports, not barrels or relative internal imports. The TUI oxlint configuration
enforces these restrictions for value/type imports, re-exports and dynamic imports,
and forbids production imports of tests or support. Test-specific allowances apply
only inside `tests/`; the real-config regression is `tests/boundaries.test.ts`.

## Shared Session Ownership

The daemon owns the durable workspace/category/item/tab/pane cursor and tab/pane
memories per session. `shell/state.ts` owns only local focus, candidate cursors,
scope filters/expansion, overlays and captured draft scope; `shell/model.ts`
projects the attached session's authoritative cursor. Remote projection must not
publish another navigation command or claim sizing through native focus callbacks.

`client/store.ts` owns the client-local attachment and live authorization stamps
(epoch, attachment generation, navigation generation and per-tab geometry generation).
The global geometry sequence orders stream updates; it is not an input generation.
`client/terminal-buffer.ts` retains bounded bytes/resize markers and their live/history
origin and original reply stamps; `client/terminal-replay.ts` orders grid changes
between byte ranges without granting new response authority to delayed queries.

`workbench/terminal-viewport.tsx` owns the concrete native emulator, canonical-grid
replay, readiness and cursor-follow clipping into the locally measured parent.
It subscribes directly to its pane output channel; byte arrival schedules a
coalesced I/O-turn drain without republishing shell/control state. Unmount removes
that subscription, releases unread consumer work and cancels its pending drain.
`client/terminal-consumer.ts` advances acknowledged byte/marker offsets separately
from retained history; empty drains do not plan that history again.
`workbench/terminal-drain.ts` round-robins mounted panes on their renderer with
8-KiB writes and a 2-ms aggregate I/O-turn budget. Readiness captures a finite
entry/geometry frontier; ordinary output does not move it. Screen-change cursor
inspection coalesces at 33 ms. Structural/geometry updates
still use the root control subscription; output does not grant input authority.
`terminal-pane.tsx` gates forwarding and displays recovery state. Leaves do not
directly resize daemon PTYs: the shell reports its available canvas/eligibility
and physical activity, then the daemon elects the latest-active eligible viewer.
Attachment is activity; idle resize and emulator replies are not. Owner resize
updates the grid; non-owner resize affects only its candidate and local crop.

## Three Independent Input Gates

1. **Client store:** current attachment/epoch/navigation/geometry generations,
   process state, valid item/parent ancestry, archival state and active layout. Captured callbacks read
   current authoritative state even before React commits.
2. **Shell:** current dialog, drawer/resize presentation, usable projected geometry
   and operation protection. Cancelling focus intent does not release restart
   submission protection before its authoritative response revision arrives.
3. **Native terminal leaf:** actual dimensions, input/resize readiness and stream
   forwarding. A running terminal requires a 20-column by five-row viewport.
   Reactivate requires a 20-column by four-row pane, and is always explicit.

Shared dimensions do not replace these gates. Transport orders snapshots and
recovers gaps within its connection; the store separately rejects obsolete runs,
epochs/revisions and recovers output, including same-revision reconnect history.

## Identity And Timing Invariants

- Preserve terminal keys, keyed ancestry, mount conditions, registration order,
  history/replay cursors and resize behavior. Never move terminals into generic
  TabsContent just to reuse panel selection.
- An entry needs its exact command response revision in the same epoch, active
  destination, running/native readiness and usable geometry. Split, restart and
  tab creation must not enter a convenient running sibling.
- Native callbacks may run several times before a React commit. Keep synchronous
  cursor/intent memory and rendered projections distinct from live readings.
  Layout-effect positions and frame listeners are intentional scheduling bridges.
- New input/focus/navigation permanently cancels stale entry. Form/drawer closure
  may transfer only its own origin. Native focus, browsing cursor, authoritative
  selection and remembered pane are different things.
- Application overlays reserve the final one-row status bar. Full messages live
  there; field validation stays beside fields and child stderr stays in terminals.

## Tests And Verification

Each capability has one local `tests/` directory. UI tests follow the existing
owners (`ui/tests/`, `ui/interaction/tests/`, `ui/theming/tests/`,
`ui/components/tests/`, `ui/controls/tests/`, `ui/primitives/tests/`). Demo sections
live in `demos/component-demos/`, while showcase integration stays in
`demos/tests/`. Do not make a wrapper directory for each source/test pair.
Fixtures live with their narrowest consumer, such as `shell/tests/fixtures.tsx`.
Package-wide acceptance is `tests/entrypoint.test.ts` and `tests/shared-session.test.ts`;
genuinely shared rendering and snapshot support live in `tests/support/`. The latter
acceptance launches two normal TUIs plus a deterministic terminal program and,
when installed, one Neovim editor session; its process/program fixtures are test-only.

The shell suites separate item entry, tab entry, pane operations, dialogs,
presentation and composition. Keep their response, snapshot, React commit, native
frame and buffered-input controls independent. `publish(snapshot, false)` advances
the real client store without rendering. Shared native viewports add a readiness
commit after parent measurement: shell fixtures settle that extra frame locally;
the default render helper and independent publish/response/frame controls are unchanged.

Run from the repository root:

```sh
bun test packages/tui/src/shell/tests
bun test packages/tui/src/client/tests
bun test packages/tui/src/ui/components/tests
bun test packages/tui/src/ui/interaction/tests packages/tui/src/ui/theming/tests
bun test packages/tui/src/demos/tests
bun test packages/tui/src/tests/entrypoint.test.ts
bun test packages/tui/src/tests/shared-session.test.ts
bun run check
```

The full gate includes lint, formatting, types, all tests, compiled build and
compiled smoke/PTY coverage. Automated macOS checks do not certify physical
terminal contrast/focus, Linux live-cwd behavior or long-running listener stability.
During this refactor an OpenTUI `LayoutLimit` diagnostic and a server real-process
shutdown assertion each occurred once and did not reproduce in unchanged reruns;
neither is claimed fixed. One existing server `no-unsafe-finally` lint warning
remains; intentional TUI control-byte sanitizers have expression-local explanations.

## Design References

- [Architecture](superpowers/specs/2026-09-16-work-craft-architecture-design.md)
- [Original source organization](superpowers/specs/2026-09-21-tui-source-organization-design.md)
- [Current maintainability/test-placement amendment](superpowers/specs/2026-10-20-tui-maintainability-design.md)
- [Output/lifecycle handover and performance evidence](superpowers/handovers/2026-10-21-output-lifecycle.md)
- [Interaction/theming and demo grouping follow-up](superpowers/specs/2026-10-20-tui-library-organization-design.md)
- [Component adoption and intentional native boundaries](superpowers/specs/2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries)

Older dated checkpoints and sibling-test trees are historical, not the current
source map. Stage 2's current schema/protocol/acceptance record is in the
[shared-session companion](superpowers/specs/2026-10-21-shared-session-navigation-design.md).
No runtime theme UI, Stage 3 completion or mixed/built-in panes are implied.

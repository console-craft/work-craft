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
The production TUI fetches `/control` and selects the history-free control stream;
full CLI snapshots/streams retain their original history payloads. Scoped pane
history recovery uses at most four concurrent abortable requests, starts at native
acknowledgement, and cannot hold unrelated output or command acknowledgements.
Recovery results are bound to connection, attachment, navigation, epoch and runtime
identities. Runtime/reset generations are distinct from history byte cursors;
runtime generation is also captured in TUI-originated raw input.
Every connection catches up retained panes even if the child emits no later bytes.
Recovering panes retain their picture but cannot accept input until successful
scoped completion and finite native consumption. Completion publishes even when
no bytes changed; store-ingress pending messages independently enforce the 8-MiB
ceiling before downstream retention/drain limits apply.
`shell/presentation.ts` retains only a coherent same-session display through
disconnect/pending reattachment. Requested destination, confirmed detach, deletion
and real metadata invalidate that fallback. Commands, viewport reporting, entry
cancellation and byte forwarding continue reading live state, never the cache.
`client/terminal-buffer.ts` retains bounded bytes/resize markers and their live/history
origin and original reply stamps; `client/terminal-replay.ts` orders grid changes
between byte ranges without granting new response authority to delayed queries.

### Stock-renderer preview amendment (2026-10-22)

This branch uses the approved [runnable preview](superpowers/specs/2026-10-22-no-fork-runnable-preview-design.md)
and its [visual waiver](superpowers/specs/2026-10-22-no-fork-preview-visual-waiver.md).
These ownership descriptions supersede the native-terminal references in the table above.
Registry OpenTUI core/React 0.6.6 are the only application path; vendor artifacts
and dated fork checkpoints are history, not a fallback.

The daemon's `packages/server/src/terminal/projection.ts` owns parsing, native
semantic encoding and single child-query reply ownership. `runtime.ts` owns its
lifetime, canonical resize order, frozen exit picture and PTY drain accounting.
Portable material/validation and actual socket-scoped request/paste authority live
in the server's `api/`; the TUI imports only `@work-craft/server/client`.

`workbench/terminal-viewport.tsx` requests current material on mount/reconnect and
coalesces pane-output notifications at 33 ms with one abortable request per pane.
`terminal-material.ts` draws explicit cells, cursor, selection and local crop; it
does not parse ANSI. Readiness follows an actually presented current-scope picture.
`terminal-input.ts` retains each input's finite received-output picture frontier,
original authority/activity/sender and payload plus 128-byte descriptor charge.
Queued and in-flight input share the 8-MiB limit; FIFO acknowledgement means real
PTY drain, not child-program processing. New output cannot extend admitted work's
frontier. Scope replacement/unmount cancels retained work. An authorized focused
leaf keeps physical focus during synchronization without forwarding early.

`terminal-pane.tsx` retains pane/epoch/runtime/reset keys, live eligibility and
stopped-pane actions. Recovery/output publication remains client-owned and bounded.
`terminal-consumer.ts` remains in the output registry, outside the live material
path; the unused renderer drain has been removed. Structural updates use the root
control subscription; ordinary material refreshes do not. Only the daemon sends
emulator replies, including the retained unsupported-mode-2048 response workaround.
Transient pictures grant no authority.

Cold recovery is daemon-owned: `terminal/cold-history.ts` replays retained bytes
across persisted runtime boundaries in disposable parsers; `projection-transcript.ts`
captures inert styled display before a distinct fresh live parser and child start.
Schema 6 adds internal starts to the bounded resize timeline without changing public
history/material DTOs. Unsupported/over-budget capture fails only that pane and
preserves durable bytes. The ordinary viewport supplies client-local wheel scrolling;
reconnect neither reconstructs the parser nor duplicates restart separators.
Exited panes retain an immediate final picture and lazily reconstruct older scrollback
through `terminal/stopped-display.ts`: one daemon-wide display-only cache and a finite
serialization lane shared with start preparation. `history.ts` supplies cheap recorded
grid identity without copying bytes on cache hits. Explicit Reactivate appends the
manual-restart divider under RuntimeRegistry's owned reservation and starts a fresh
parser below inert history; it waits for old PTY drain before advancing generation.
`api/connections.ts` awaits material and revalidates socket/read scope before sending.
`client/store.ts` and shell/leaf presentation retain separate read-browsing and live
child-input gates. Stopped wheel events stay local and never claim child activity;
historical grids are cropped, not rewritten by viewer resizing. Regional indicators
retain the waived narrow glyph defect. Hyperlink destinations/invisible-wide fidelity
remain research-only.
Leaves do not directly resize daemon PTYs: the shell reports its available canvas/eligibility
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
Package-wide acceptance is `tests/entrypoint.test.ts`, `tests/shared-session.test.ts`
and `tests/cold-history.test.ts`, `tests/stopped-history.test.ts`;
genuinely shared rendering and snapshot support live in `tests/support/`. The latter
acceptance launches two normal TUIs plus a deterministic terminal program and,
when installed, one Neovim editor session; its process/program fixtures are test-only.

Connected shell/surface fixtures use `tests/support/material-stream.ts`, which
constructs and destroys a real daemon parser per fixture request. Old `.screen()`
checks observe renderer text/cursor instead; captured `.onData` injections become
captured semantic key/paste calls. Client-query tests now assert no client replies;
`server/src/terminal/tests/projection-runtime.test.ts` checks exact single daemon
replies. Queue/viewport tests cover finite picture readiness and cancellation.
The Buffer-paste snapshot regression moved from fork admission to material admission.
The ten native continuation characterizations run in the ordinary suite without
profiling flags. Original hidden-wide/link reproducers live in capability-local
`tests/*.diagnostic.ts(x)` files, outside automatic test discovery. Run all three
with `bun run diagnose:hyperlinks`; they have no skip gates and currently exit
nonzero against stock OpenTUI. The TUI projection checks share the test-only
`workbench/tests/material-projection.ts` drawing fixture. Output benchmarks live
in `tests/output-profile.benchmark.ts`; run `bun run benchmark:output` with a fresh
`WORK_CRAFT_OUTPUT_PROFILE_DIR`. These manual commands preserve assertions and
cleanup, not an accepted fidelity repair or a certified performance baseline.
The original native-admission implementation is preserved in Git at `583a70e`.
Explicit-position regional-indicator fidelity probes also remain red opt-in evidence.

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

# TUI Component Adoption Design

## Current Checkpoint: Component Adoption Complete And Accepted (2026-10-19)

The approved [Phase 5 companion](./2026-10-18-tui-component-adoption-phase-5-design.md)
is implemented: actual two-row immediate-selection Tabs with Enter/Space and
primary-release guarded content entry, shared overflow/reveal, EmptyState and
bordered three-row bottom Alerts and exited-pane Reactivate. The accepted Oct 19
restyle supersedes the original dimming proposal: terminal output is transparent
and undimmed, with warning exited/disconnected Alerts and warning/background
enabled-unfocused Reactivate colors (normal focused/disabled Button colors apply).
Native OpenTUI terminal leaves remain outside generic TabsContent and keep stable
sibling ancestry during splits. The daemon implements both pulled-forward Stage 3
behaviors: live shell-cwd inheritance and transactional direction-aware full-tab
equalization, including undersized creation. Text/JSON CLI split shapes and explicit
cwd override precedence remain unchanged. Independent whole-session and follow-up
review are complete; accepted split, Hyper+n and explicit-restart repairs enter
only the exact ready destination and preserve newer-intent cancellation. The user
accepted Phase 5 for progression and approved Phase 6. The Oct 19 restyle/status
repair baseline passed **1,398 tests, zero failures, build and compiled smoke** on
macOS. Phase 6 implementation and connected review are complete, with no findings
or production changes. Its fresh macOS `bun run check` passed **1,399 tests, zero
failures**, lint/format/types, build and compiled smoke (exit `0`, 315.40 seconds).
The user accepted all component-adoption work as complete and authorized commit,
push and PR on 2026-10-19. No physical/Linux execution is implied. Linux live-cwd and
long-running listener stability remain unverified; existing native/input/React
warnings and five lint warnings are debt, not cleanup scope. Earlier checkpoints
and delivery-phase proposals below are historical where superseded here.

## Coding Implementation Checkpoint (2026-10-16)

Navigator adopts the existing Input/List/ListItem composition, including the approved separate cursor-ref and live hint override. No new compound navigation framework, footer, library Drawer, or further adoption phase was introduced. Application drawer/resize/error behavior remains shell-owned. Current acceptance/review evidence is in the Coding Navigator spec; accepted earlier adoption/demo work is preserved, and later phases/human acceptance remain pending.

## Accepted Coding Design Amendment

The accepted [Coding Navigator design](./2026-10-15-coding-navigator-design.md)
replaces preservation-first Phase 4 with a bounded Coding vertical slice and a
unified item model. Its docked/drawer/guard, activation, and error-presentation
contracts override the older navigator-specific assumptions below. Acceptance is
design-level: no implementation plan, code, or database reset is yet approved.
Completed Phases 1–3b remain accepted; their delivery history is not rewritten.

## Goal And Architectural Stage Boundary

Rewrite the existing TUI presentation to compose primarily from Work Craft's
local primitives, controls, and components rather than hand-building equivalent
layout, styling, and interactions with low-level OpenTUI APIs.

This is supporting work after Stage 1 and before Stage 2 of the
[TUI overhaul](./2026-09-18-tui-overhaul-design.md), not a new architectural stage.
Stage 1's persistent shell and
[focus/input contract](./2026-10-02-tui-focus-input-contract-design.md) remain the
behavioral foundation. Stage 2's daemon-owned shared navigation still requires
its own companion design and is not implemented here.

Deliver the migration in independently verified phases, including Phase 3b.
Keep the normal application entrypoint runnable throughout; do not introduce a
second interface or a temporary `v2` entrypoint.

## Constraints And Ownership

- Preserve the local-first, single-daemon architecture. Durable state and
  runtimes remain server-owned; the TUI remains a disposable client.
- Keep React/OpenTUI, Bun, existing dependencies, and the current capability
  structure from the [source organization design](./2026-09-21-tui-source-organization-design.md).
- Keep reusable UI and theme contracts in `packages/tui/src/ui`. Application
  regions remain in `shell`, `navigation`, and `workbench`.
- Keep application data, semantic callbacks, command execution, and activation
  intent in callers. Reusable components must not import application code or
  install competing global keyboard handlers.
- Preserve command IDs, key meanings, region IDs, browsing versus activation,
  focus restoration, contextual hints, responsive layout, and regional failures.
  User-approved header exceptions are local Button activation and Tab traversal,
  plus removal of manual header sizing, ellipses, and workspace overflow paging.
  Phase 3's approved navigation and drill-down changes are described below;
  Phase 3b separately introduces horizontal scrolling.
- Preserve terminal keys, keyed ancestry, mounting policy, registration order,
  history/replay, input forwarding, and resize behavior. Unrelated presentation
  updates must not remount terminals or restart daemon-owned processes.
- Retain the last coherent view during disconnects and disable durable mutations
  until reconnection. Keep failure ownership associated with its source, but
  report full Work Craft operational messages in the status bar; field validation
  stays inline and persistent source indicators remain beside items/panes.
- Prefer an existing local component when its contract fits. Native OpenTUI is
  still appropriate for the terminal renderer and other necessary low-level
  boundaries; there is no component-usage quota.
- Add library capabilities only for concrete migrated callers. Do not expand
  the library speculatively or force every shell region into Card, Button, or Tabs.
- Visual changes may follow existing component styling, but must not change
  interaction semantics without user approval or consume required layout space.
  Record intentional appearance changes in each phase's plan and verification report.

## Original Inspection And Compatibility Gaps (Historical)

The application already uses local Box, Text, Icon, and other primitives.
The remaining work includes replacing custom compositions and duplicated
interaction behavior, not merely renaming native JSX elements.

The available library includes layout/scrolling primitives, controls, and
composites such as Card, Badge, Alert, Tabs, Dialog, Field, List, and EmptyState.
The overhaul's original component inventory predates recent additions; inspect
the implementation and tests before selecting a replacement.

Two known mismatches must be resolved deliberately at their owning phases:

- **List:** currently wraps browsing and exposes activation without a keyboard
  versus mouse source. Shell navigation is bounded and distinguishes keyboard
  drill-down from mouse preview. List is not a drop-in replacement.
  This was an inspection finding, not a current product constraint: the accepted
  Coding redesign adopts List keys and uniform mouse/keyboard terminal entry.
- **Tabs:** library browsing switches the displayed panel, and Enter/Space enters
  its content. The workbench strip separates browsing from activation and retains
  source-region focus. Do not replace it with library Tabs without preserving
  that contract.
  This original preservation requirement is superseded by the approved
  [Phase 5 companion](./2026-10-18-tui-component-adoption-phase-5-design.md): adopt
  immediate switching and Enter/Space content entry, and extend library mouse
  selection to activate content. The implementation checkpoint above records delivery
  separately from the original review/human gates, now superseded by the current checkpoint.

Phase-specific planning decides whether a small caller composition or a minimal
library refinement is appropriate. Do not change established behavior merely to
fit an existing component API.

## Delivery Phases

### Phase 1: Shell Chrome And Status Presentation

**Owners:** `shell/header.tsx`, `session-switcher.tsx`, `status-bar.tsx`, and
top-level composition in `shell/shell.tsx`.

Use local layout primitives and compact status presentation. Preserve region
geometry, focus endpoints, session activation, hints, and connection treatment.
The original one-row header requirement is historical: the accepted header is
three rows and status remains one row. Account for component defaults.

The approved Phase 1 plan uses Stack/HStack composition and a themed status-mode
Badge. Its initial implementation retained the session switcher's activation
handling. The user subsequently approved adopting Button, including local
Enter/Space activation and mouse-release activation, while retaining global
Hyper+s. Changes remain unstaged for verification.

**Human checkpoint:** header/status readability, session activation, spatial
focus, and narrow/wide layouts.

### Phase 2: Dialogs And Creation Forms

**Companion design:** [Phase 2 dialogs and forms](./2026-10-13-tui-component-adoption-phase-2-design.md).

**Owners:** `shell/dialog-overlay.tsx`, `session-chooser.tsx`, and `create-prompt.tsx`.

Adopt compound Dialog framing, a searchable Command chooser, and Field-based
form/error composition. Reuse existing Input and Button controls. Integrate library
modal behavior with the shell router so a single coordinated owner handles
trapping and restoration.

Preserve startup cancellation rules, creation input and validation, dialog
replacement, disabled background interaction, and valid focus after failures.

**Human checkpoint:** empty-installation startup, choosing/creating sessions,
other creation forms, Tab traversal, cancellation, errors, and focus restoration.

### Phase 3: Workspace Bar And Category Rail

**Owners:** `shell/workspace-bar.tsx` and `navigation/category-rail.tsx`.

Use single-selection ToggleGroup/Toggle composition with the library's pressed
appearance: workspace labels horizontally and the six category icons vertically.
Preserve one native focus endpoint per region and browsing without activation.
Do not turn individual entries into separate focus stops.

The user accepts wrapping navigation, resetting the browsing cursor to selection
on refocus, the group's existing navigation keys, Enter/Space activation, and
primary-button mouse-release activation. Keep an eligible entry selected;
reactivating it must not deselect it. Buffered browsing followed by activation
must operate on the latest cursor, not stale rendered state.

Both mouse and local keyboard activation drill down through the same route:
session attachment focuses the workspace bar, workspace activation focuses the
category rail, and category activation focuses the navigator, including an empty
navigator. Category activation reveals a manually hidden navigator and clears
the hidden preference. Browsing alone does not reveal it. When terminal size
prevents displaying the navigator, activate the category but keep focus in the
rail. Activation intent and focus handoff remain application-owned.

ToggleGroup's controlled selected value is distinct from its internal browsing
cursor. This phase does not implement daemon-owned shared navigation; future
remote selection updates must not trigger local drill-down or reveal navigation.
Agree on any necessary library changes before the implementation plan; exact API
choices remain open. Preserve header Tab traversal and terminal identity/input.

**Human checkpoint:** browsing without activation, wrapping/refocus behavior,
Enter/Space and mouse drill-down, repeated activation, hidden/empty/undersized
navigators, and session-to-workspace focus. Keep the simple header without
manual label sizing, truncation, or overflow paging. Scrolling belongs to Phase 3b.

### Phase 3b: Horizontal Scroller

Add a reusable horizontal scroller to the component library and adopt it at least
for the workspace bar and status-bar hints. Keep labels unabridged rather than
manually truncating them. Details to be determined when implementing the 3b phase,
including arrow presentation, pointer/keyboard behavior, and cursor reveal.

This is separate from Phase 3 and requires its own approved design,
implementation plan, tests, and human-verification checkpoint. Preserve the
accepted three-row header and one-row status bar, header focus traversal, and the requirement that
application overlays leave the status bar uncovered and undimmed.

### Phase 4: Project/Item Navigator

This original phase description is superseded by the accepted Coding design.
Do not preserve bounded movement, compact initials, mouse preview, or separate
Project entities merely because they appear in this historical roadmap.

**Owner:** `navigation/navigator.tsx` and its colocated behavioral tests.

Use List/ListItem and local scrolling composition where compatible. Preserve
hierarchy projection, expansion, compact initials, cursor/active styling,
regional errors, and the distinction between keyboard opening and mouse preview.

Keep project/item actions and asynchronous pane-focus handoff in application
code. Handle the List contract mismatches before removing existing handlers.

**Human checkpoint:** expanded/compact modes, long-list scrolling, project
collapse/expand, empty categories, item opening, failed commands, and cancelled
focus handoffs.

### Phase 5: Workbench Presentation

**Companion design:** [Phase 5 workbench presentation](./2026-10-18-tui-component-adoption-phase-5-design.md),
approved 2026-10-18. Its native Tabs selection/entry and bottom Alert/Reactivate
contracts override the older preservation-first wording below. Its separate
implementation is accepted for progression, with independent whole-session and
follow-up review complete and evidence recorded in the companion.

**Owners:** `workbench/tab-bar.tsx`, `workbench.tsx`, and presentation within
`surface-view.tsx` and `terminal-pane.tsx`.

Compose the tab strip with compatible library pieces and use EmptyState and
compact error/process-status presentation where space permits. Preserve tab
browsing versus activation and terminal lifecycle contracts. Preserve split
geometry except for the explicitly approved equalization change below.

**Approved scope expansion (2026-10-17, manual findings #5 and #8):** implement
these two workbench behaviors in Phase 5 rather than waiting for architectural
Stage 3:

- **Current-directory inheritance on split (#5):** a new horizontal or vertical
  terminal split starts in the source terminal's current working directory,
  including changes made with `cd`, rather than merely its stored startup cwd
  or the Navigator item's directory. The Phase 5 design must define reliable
  live-cwd discovery and behavior when it cannot be determined.
- **Automatic pane equalization after splitting (#8):** automatically equalize
  panes after a successful split. The Phase 5 design must specify the affected
  layout scope, mixed horizontal/vertical split rules, and minimum-size handling;
  this is not just an optional, manually invoked balance command.

These approved Phase 5 requirements are implemented and accepted for progression
at the checkpoint above; Linux acceptance remains unverified. Preserve native `<terminal>` rendering, terminal
identity, running processes, and history/replay; allow only the narrowly scoped
server/runtime support needed for these behaviors. Do not inject `cd` into
existing shells or introduce library tab-panel mounting that remounts terminals.
Other Stage 3 workbench operations and Stage 4 mixed panes remain out of scope.
The [architectural Stage 3 roadmap](./2026-09-18-tui-overhaul-design.md#stage-3-workbench-operations)
must treat these two behaviors as already implemented when that stage begins.

**Human checkpoint:** tab browsing/activation, splits, empty/undersized states,
terminal input, recovery status, and terminal preservation during unrelated UI
changes. Also verify `cd` followed by both split directions starts the new shell
in the source terminal's current directory, and repeated splits automatically
equalize panes according to the approved rules without restarting existing
terminals or losing their output.

### Phase 6: Consolidation And Stage 2 Readiness

Remove presentation code displaced by the preceding phases. Check theme,
overflow, focus, and hints across the complete application. Document intentional
native exceptions, update the overhaul's progress section, and run integrated
entrypoint/PTY acceptance coverage.

**Implemented, verified and accepted (2026-10-19):** bounded
consolidation only, not a new
feature/refactor cycle. The removal audit found none of `projectPaneFocusNodes`,
`ProjectedLayout`, `projectLayout`, `pendingWorkbenchFocus` or `failureRow` in
shell/navigation/workbench. No deletions are needed; raw-key compatibility,
future styling branches and library/demo components are retained. Full-shell
injected default → Dracula → default regression coverage checks native terminal
and modal-search identity/focus, hints, palette and the bottom status row;
the existing pointer-scrolling test also checks native ScrollBox identity/offsets
and exact x/Tab bytes after a theme update. This adds no application theme UI/API.
Connected review passed with no findings. The fresh macOS full check passed
**1,399 tests, zero failures**, lint/format/types, build and compiled smoke,
exit `0`. The user accepted component adoption as complete; the 1,398-test checkpoint above is
the prior Phase 5 baseline. No production source changed.

Stage 2 readiness means a component-composed shell with preserved behavior, not
that shared navigation has been designed or implemented.

**Human checkpoint:** a complete keyboard-first workflow, resizing,
disconnect/reconnect, and continued daemon-owned terminal execution.

### Adopted Components And Intentional Native Boundaries

Paths below are relative to `packages/tui/src`. This is the canonical adoption
inventory; owning specs link here rather than maintain competing lists.

| Region / owner                                                                               | Adopted local UI                                                      | Intentional native/application boundary                                                                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell/header.tsx`, `workspace-bar.tsx`, `session-switcher.tsx`                              | HStack, ToggleGroup/Toggle, HorizontalScroller, Button, Icon/Text     | One native endpoint per group; shell owns attachment/drill-down and bounds-based spatial focus.                                                            |
| `shell/status-bar.tsx`                                                                       | HStack, Badge, HorizontalScroller, Text                               | Native spans resolve palette; shell owns source errors and contextual hints.                                                                               |
| `shell/dialog-overlay.tsx`, `session-chooser.tsx`, `create-prompt.tsx`, `archive-prompt.tsx` | Dialog, Command, Field, Input, Button, Stack                          | Dialog owns native trap/restoration; shell router owns modal eligibility/cancellation and reserves the status row.                                         |
| `navigation/category-rail.tsx`, `navigator.tsx`                                              | ToggleGroup/Toggle, Input, List/ListItem, layout/text/icon primitives | Native refs/focus-event bridges and cursor handle support buffered filter/results transfer; callers own expansion, item activation and drawer entry.       |
| `workbench/tab-bar.tsx`, `workbench.tsx`                                                     | Tabs/TabsList/TabsTrigger, EmptyState, Box/Text                       | Native group focus/event gate; shell owns authoritative selection and guarded entry, not generic TabsContent mounting.                                     |
| `workbench/surface-view.tsx`, `terminal-pane.tsx`, `layout.ts`, `pane-state.ts`              | Box, Divider, EmptyState, Alert, Button                               | Measured host projects stable keyed siblings; native `<terminal>` supplies the emulator, with leaf-owned replay/input/resize bridges, not daemon runtimes. |
| `shell/shell.tsx`, `focus.ts`, `layout.ts`; `input/`; `client/use-work-craft.ts`             | Local focus/modal/hint helpers and layout primitives                  | Native renderer refs, frame/resize/focus/key/paste events and rendered-bound measurement are necessary policy/runtime bridges, not missing adoption.       |

Accepted geometry is header/workspaces `3`, Tabs `2`, pane top border `1`,
unavailable Alert `3`, status `1` at the bottom, `WORKBENCH_PADDING_X=1` and no
outer workbench border. Actual terminal input needs `20×5`; a recovery action
needs a `20×4` pane. Overlays never cover/dim status. Native JSX audit finds only
`<terminal>` in application regions; native widget wrappers in `ui/` remain
library-owned. Server durable state/runtimes, disposable clients and client-local
focus, filters, cursors, dialogs, expansion and viewport state remain unchanged.

## Verification And Phase Gates

For every phase:

1. Inspect affected callers, tests, fixtures, focus/input contracts, and component
   defaults before replacing presentation.
2. Preserve existing behavioral coverage and add focused tests for integration
   contracts not already covered. Do not introduce broad visual snapshot suites.
3. Run affected behavioral/render tests and relevant input/terminal acceptance
   coverage, then a fresh `bun run check`.
4. Report changed regions, intentional visual differences, verification results,
   and remaining risks with a short manual verification checklist.
5. Stop and wait for human acceptance before planning or implementing the next
   phase. Acceptance of this roadmap is not acceptance of all future phase plans.

Write each implementation plan just in time. Avoid freezing later component
API decisions before earlier phases reveal their actual integration needs.
Leave changes unstaged and uncommitted unless explicitly authorized or required
by the applicable workflow.

## Progress And Resumption

The following is the historical delivery log. The Oct 19 checkpoint and Phase 6
section above govern current acceptance/scope; older pending/unstaged notes are
not instructions to repeat accepted work or alter the preserved index.

- Worktree: `/Users/ovi/.worktrees/_Users_ovi_Projects_console-craft_work-craft/use-component-lib-in-tui`.
- Branch: `use-component-lib-in-tui`.
- Baseline: `bun run check` passed with 561 tests and zero failures before
  application edits. Existing listener-limit and React act warnings were observed;
  diagnosing them is outside this migration's current scope.
- Phase 1 plan: [2026-10-13-tui-component-adoption-phase-1.md](../plans/2026-10-13-tui-component-adoption-phase-1.md).
  The repository ignores `docs/superpowers/plans/`; this plan is local to the
  worktree unless separately preserved.
- Phase 1 is implemented using inline execution and accepted for progression by
  the user, who staged its changes.
  The latest `bun run check`, including simplified-header and Tab follow-ups,
  passed with 574 tests and zero failures, including build/smoke verification.
  Independent review of the initial Phase 1 implementation found no issues.
  Simplified-header review found one buffered leader-priority issue; it was
  reproduced and fixed with a same-buffer regression test before the latest check.
- Phase 1 uses Stack/HStack for shell/header/session layout, a semantic connection
  color map, and Badge for all four status modes. Follow-up user styling removes
  the status divider and `Session:` prefix, uses fixed nine-cell centered badges,
  and adjusts status/session colors.
- The user removed manual workspace/session widths and label truncation. Header
  layout now uses native flex sizing with all workspaces and unabridged labels;
  narrow terminals may clip content rather than page or add ellipses. Header
  spatial focus reads rendered bounds, not duplicated label-width calculations.
- The switcher is a ghost Button with no extra layout wrapper. It opens on local
  Enter/Space, primary-button mouse release, or global Hyper+s. Dialog cancellation
  restores the initiating focus.
- Plain Tab/Shift+Tab cycles only within the focused header's workspace/session
  controls. Dialog trapping, modified Tab, leader precedence, and terminal Tab
  passthrough remain unchanged. The placeholder is `Select session...`.
- Router state advances synchronously between buffered native keys; a leader
  prefix followed by Tab in one input buffer reports an invalid leader key rather
  than moving header focus. React state still drives rendered hints/errors.
- Keep the staged Phase 1 baseline intact. Subsequent phases remain unstaged until
  the user chooses otherwise and retain their own human-verification checkpoints.
- Phase 2 component choices are agreed: standard controlled Dialog, Command-based
  searchable session chooser with native highlight behavior, and Field-based forms.
  Chooser creation uses Ctrl+Space then n; plain n remains search text. Library
  root focus is accepted and modal focus ownership must be singular. Input
  behavior remains Ctrl+C to clear and Escape to request dialog cancellation,
  including with a pending chooser prefix; startup safeguards remain in place.
  Phase 2 is implemented and unstaged: DialogContent owns modal focus; Command
  owns search/highlight; Field forms share live-name validation for Enter/Create.
  Affected router, render, and real-entrypoint tests pass.
  The latest `bun run check` passed with 610 tests and zero failures, including build/smoke.
  Independent review found one modal Tab/leader ordering issue; buffered Tab and
  Shift+Tab regression tests reproduced it before the fix. No findings remain
  deferred. Existing test warnings remain; manual UI verification is still required.
- Phase 2 human-verification follow-ups show `Name is required.` for empty or
  whitespace-only submissions, clear that local error on editing, and use
  `Command direction="up"` with the search input below its results and the native
  bottom-most initial highlight. No new component API or naming rules were added.
- Application overlays reserve the status bar's bottom row using optional
  DialogContent overlay margins, while library defaults stay full-screen.
  All current application overlays share this policy. Resize/clipping and
  zero-area handling passed tests and independent review; manual acceptance remains.
- Phase 2 plan: [2026-10-13-tui-component-adoption-phase-2.md](../plans/2026-10-13-tui-component-adoption-phase-2.md).
  Phases 1 and 2 are now accepted and staged by the user; earlier unstaged/manual
  verification notes describe the previous checkpoint. Preserve the entire index
  and leave all new work unstaged and uncommitted.
- Phase 3 plan: [2026-10-13-tui-component-adoption-phase-3.md](../plans/2026-10-13-tui-component-adoption-phase-3.md).
  The user approved native execution. Phase 3 is implemented and unstaged using
  single-selection ToggleGroups for workspaces and category icons, with no public
  library API additions. The library owns internal browsing; obsolete shell
  workspace/category cursors and handlers are removed. Required selection and
  repeated activation remain caller-owned.
- Phase 3 adopts the library's pressed/focus colors and Enter/Space Toggle hint;
  the old cursor/active marker characters are removed. All six category glyphs
  remain, now rendered as Toggle labels rather than separately colored Icon leaves.
  Header labels remain unabridged and header Tab traversal is preserved.
- Attachment/reselection focuses workspaces; local workspace activation focuses
  categories; local category activation reveals and focuses navigation for both
  mouse and keyboard. Empty navigation is reachable; size-hidden navigation leaves
  focus in the rail. Hyper selection retains focus and does not reveal navigation.
  Its independent browsing cursor is reset by refocus, not by selection changes.
- Phase 3 TDD covers buffered cursor handling, delayed registration, repeat and
  mouse-release activation, drill-down/reveal, refresh/cancellation, and terminal
  preservation. Independent read-only review found two input-ordering issues:
  keyed workspace reordering retained stale registration order, and buffered
  activations could toggle a revealed navigator closed. Both were reproduced and
  fixed with regression tests; browsing now follows rendered order and the shell
  uses an idempotent local navigator.reveal action. Follow-up review found no
  remaining issues or deferred findings.
- The final Phase 3 `bun run check` passed with 649 tests and zero failures,
  including lint, formatting, types, build, and smoke. Existing listener-limit and
  React act warnings remain. The staged baseline is unchanged; no commits were
  made. Human UI verification is pending before any next-phase work.
- The user's Phase 3b handoff confirms acceptance of Phase 3 and all styling
  follow-ups; they are staged. Its latest verified baseline was 652 passing tests
  plus build/smoke. Earlier pending-acceptance notes above are historical.
- Phase 3b design: [2026-10-14-tui-horizontal-scroller-design.md](./2026-10-14-tui-horizontal-scroller-design.md).
  Plan: [2026-10-14-tui-horizontal-scroller.md](../plans/2026-10-14-tui-horizontal-scroller.md).
  Both were approved before native implementation. HorizontalScroller composes
  the existing ScrollArea and local primitives; its only special prop is revealId.
  Existing Button, ToggleGroup, ScrollArea, shell routing, and terminal APIs remain
  unchanged. Workspace scrolling stays inside the single group focus endpoint;
  the fixed status-mode badge stays outside scrolling content.
- Phase 3b adds one-cell arrows only during overflow, muted at unavailable edges,
  half-viewport primary-release movement, and contained horizontal/ordinary wheel
  scrolling without changing focus or selection. Workspace browsing/refocus
  reveals complete labels; status content resets only on displayed-value changes.
  All existing colors, outlined workspace numbers, key formatting, activation
  drill-down, header Tab traversal, and status-safe overlays are preserved.
- The final Phase 3b bun run check passed with 678 tests and zero failures,
  including lint, formatting, types, build, and smoke. Independent read-only review
  and targeted follow-ups found four buffered pointer/focus lifecycle issues;
  all were reproduced with failing tests and fixed. No findings remain deferred.
  Existing listener-limit and React act warnings remain. The staged baseline hash
  is unchanged; all Phase 3b work is unstaged/uncommitted.
- The user accepted the core Phase 3b implementation and requested components-demo
  examples. The approved demo-only follow-up adds fitting, Unicode overflow, and
  browsable ToggleGroup/revealId examples at the end of the components demo.
  Plan: [2026-10-14-horizontal-scroller-demo.md](../plans/2026-10-14-horizontal-scroller-demo.md).
  No runtime or library API changes were made. Its final bun run check passed
  680 tests with zero failures and build/smoke. Read-only review identified one
  narrow-resize test gap; it was reproduced, corrected, and reverified.
- Demo human verification is pending. All previous staged and unstaged runtime
  work is preserved; demo changes remain unstaged/uncommitted. Pause before any
  further phase. Phases 4–6 and architectural shared navigation remain outside
  this work and have no approved implementation plans.
- The later handoff explicitly accepts Phases 1–3b, all styling follow-ups, and the
  HorizontalScroller demos. Earlier pending-verification notes are historical.
  Its supplied complete baseline is 680 tests plus build/smoke.
- During Phase 4 brainstorming the user replaced preservation-first adoption with
  a Coding navigator vertical slice: path-backed Projects/worktrees, automatic
  discovery, unavailable-entry retention and Archive, two-line filtered List rows,
  uniform mouse/keyboard terminal entry, and a unified parent/child item model.
  Existing saved development state is discardable; existing source/index work is not.
  The compact/no-overlay model is replaced by the accepted docked/drawer presentation
  with confirmed 80-column minimum and 120-column docking threshold.
  The [earlier Phase 4 draft](./2026-10-14-tui-component-adoption-phase-4-design.md)
  is superseded. The replacement
  [Coding Navigator design](./2026-10-15-coding-navigator-design.md) is accepted and
  awaits a separately approved implementation plan. No product
  code, library API, schema reset, or architectural Stage 2 implementation has begun.
- The subsequent error clarification is accepted across the TUI: Work Craft
  failure messages use the status bar with source attribution; field-specific
  validation stays inline; persistent unavailable/failed indicators stay local.
  Affected target specs are aligned before planning. Later implementation must
  update actual API/file details, verification evidence, and human acceptance;
  approved documentation does not imply delivered behavior.
- The user approved the complete amended Phase 5 companion on 2026-10-18:
  actual two-row Tabs with immediate switching, library-wide mouse content entry,
  shared tab scrolling, dimmed unavailable output with a bordered bottom Alert
  and exited-pane Reactivate, live shell-cwd inheritance and direction-aware
  full-tab equalization even for undersized splits. No Archive action is added.
  The [Phase 5 plan](../plans/2026-10-18-tui-component-adoption-phase-5-implementation-plan.md)
  is approved/self-reviewed and parallel execution is starting. No application
  code has changed at this checkpoint.
  The fresh macOS baseline passes 1,020 tests, zero failures, build and compiled
  smoke; existing warnings remain. All new documentation is unstaged and the
  user's staged baseline is preserved. Parallel subagents are the requested
  implementation method; planning approval does not authorize Phase 6/Stage 2.

After compaction, read this spec, the focus/input contract, and the current phase
plan; inspect the actual branch diff and verification evidence before resuming.
Update this progress section at each accepted checkpoint so the next session
does not infer completion from the existence of a plan.

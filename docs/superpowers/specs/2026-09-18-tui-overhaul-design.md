# TUI Overhaul Design

## Component Adoption Complete And Accepted (2026-10-19)

The approved [workbench companion](./2026-10-18-tui-component-adoption-phase-5-design.md)
implements actual two-row library Tabs, shared tab overflow, bottom bordered
three-row unavailable Alerts and exited-pane Reactivate. The accepted Oct 19
restyle replaces the original dimming with transparent, undimmed output.
Native terminal leaves intentionally remain outside generic tab-panel mounting.
Both pulled-forward Stage 3 behaviors are implemented with real macOS daemon,
normal-entrypoint and CLI acceptance: live shell-cwd inheritance on both split
directions and full-tab direction-aware equalization, preserving shell PIDs/output
and allowing undersized creation. Phase 5 is accepted for progression after
independent whole-session/follow-up review and split, Hyper+n and explicit-restart
focus repairs. Its Oct 19 restyle/status-repair baseline passed 1,398 tests, zero
failures, build and compiled smoke on macOS. Phase 6 implementation and connected
review are complete with no findings or production changes. Its fresh macOS full
check passed 1,399 tests, zero failures, lint/format/types, build and compiled smoke,
exit `0`. The user accepted all component-adoption work as complete on 2026-10-19;
this does not certify unexecuted physical/Linux checks.
The canonical [adoption inventory](./2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries)
records current component owners, geometry/colors and intentional native boundaries.
Linux live-cwd, physical contrast and long-running listener stability remain
unverified; existing native/input/React and lint warnings are retained debt.
Earlier checkpoints below are historical. Stage 2/shared navigation and other
Stage 3 operations remain separate, unimplemented work.

## Coding Implementation Checkpoint (2026-10-16)

The approved Coding slice replaces compact/preview navigation with filtered unified items, docked/drawer presentation, and a below-80-column input guard. Operational errors are source-labelled status messages; validation remains inline. Automated checkpoints and final review are recorded in the Coding Navigator spec. Stage 2 shared navigation, other category experiences, and human acceptance remain pending; historical accepted stages below are unchanged.

## Accepted Target Amendment

The [Coding Navigator design](./2026-10-15-coding-navigator-design.md), accepted
between Stages 1 and 2, governs the unified item model, docked/drawer navigation,
minimum-width guard, activation, and error presentation. Target sections below
include future architectural work; the Coding slice itself is delivered. This
focused Coding slice does not complete the other category experiences or Stage 2.

## Goal

Replace the current screen-swapping TUI with a persistent, keyboard-first
application shell that keeps organization and execution visible together.
Users navigate sessions, workspaces, categories, and root/child work items while
working in durable tabs containing mixed terminal and built-in panes.

The redesign must preserve the local-first, single-daemon architecture. The
daemon remains authoritative for durable state and runtimes; React/OpenTUI
clients render that state, send semantic commands, and may disconnect without
stopping processes.

The migration is incremental. The normal application entry point remains
runnable after every stage, and old presentation code is deleted only after
its behavior has moved into the new shell.

## Product Shape

Work Craft becomes one persistent shell rather than alternating between a
navigator and an execution surface:

```text
┌ workspace bar ───────────────────────── session switcher ┐
├ category rail ┬ project/item navigator ┬ tab strip ──────┤
│ fixed icons   │ stable hierarchy       ├─────────────────┤
│               │                        │ split work area │
└───────────────┴────────────────────────┴─────────────────┘
```

The shell has four durable regions:

- **Workspace bar:** shows the workspaces available in the attached session
  and highlights the shared active workspace.
- **Session switcher:** attaches the current client to another durable session
  and shows daemon connection state.
- **Navigation sidebar:** combines an always-visible category icon rail with a
  work-item navigator for the active workspace and category. The below-minimum
  resize presentation is an explicit exception to normal category-rail visibility.
- **Workbench:** shows the active item's tabs and renders the active tab's
  split pane tree.

The navigator and workbench remain visible together in normal wide-terminal use.
Narrow terminals may cover the workbench with an explicitly opened navigation
drawer; successful activation closes it and enters the item's terminal. This is
one persistent shell, not a second surface screen or parallel entry point.

### Reference Sketches

The approved sketches are directional references for the shell's information
architecture and region relationships, not pixel-perfect rendering contracts:

- [Implementation category](../../sketches/sketch-implementation-category.png)
- [Operations category](../../sketches/sketch-operations-category.png)

## Product Hierarchy

The accepted target uses unified work items:

```text
server
└── session
    └── workspace
        └── category
            └── work items (roots and optional one-level children)
                └── execution surface (optional, at either level)
                    └── tab
                        └── split tree
                            └── pane
```

### Sessions

A session is a named, durable attachment and mirroring boundary. Choosing a
session attaches one client to it; it does not move other clients between
sessions. Clients attached to the same session share navigation and workbench
selection, enabling tmux-like mirrored pair work.

### Workspaces

A workspace is a reusable organizational context within one or more sessions.
The workspace bar displays the attached session's workspace memberships.
Switching workspaces changes the active category, navigator, and workbench
context without stopping hidden runtimes.

### Categories

Every workspace retains the six fixed categories: Inbox, Today, Design,
Implementation, Collaboration, and Operations. The category rail normally shows
all six as icons; only the explicit below-80-column resize presentation may cover it.

Categories share navigation interaction primitives and an optional parent/child
item envelope, not one mandatory Project-to-Item meaning. Concrete categories
define their own item data, row labels, actions, and workbench views as designed.

### Work Items And Coding Projects

Work items are selectable units at either level and may own an optional execution
surface. A Coding Project is a root directory item; its worktrees are child items.
Opening either enters its persistent terminal environment, distinct from browsing
or expansion. The Coding companion defines lazy creation, unavailable entries,
archival, and focus-success safeguards.

Categories do not own terminals directly. Root and child surfaces are both
item-owned, without a synthetic project-terminal item. Generic work-item surfaces
remain the escape hatch for workflows without a specialized built-in view.

## Workbench Model

An execution surface contains ordered tabs. Each tab contains a recursive
split tree whose leaves are panes. A single tab may mix both pane kinds:

- **Terminal panes:** daemon-backed PTYs running shells, Neovim, OpenCode, or
  other CLI/TUI applications.
- **Built-in panes:** first-party React/OpenTUI views over structured daemon
  data, such as monitoring dashboards, logs, alerts, or collaboration data.

Pane IDs remain stable and durable. Rearranging a terminal pane must not
restart its process. Terminal output, recovery metadata, and replay behavior
remain keyed by pane ID.

Built-in panes are added as concrete first-party capabilities. This design does
not introduce a plugin API, third-party pane contract, widget composition
system, or independently versioned extension boundary.

## Shared Navigation

The daemon stores one durable navigation cursor for each session:

```text
active workspace
  → active category
    → active work item (root or child)
      → active tab
        → active pane
```

Navigation commands follow the same mutation path as other durable commands:

```text
client command
  → daemon validation
  → SQLite transaction
  → revision increment
  → broadcast snapshot/update
  → every attached client rerenders
```

Clients attached to the same session therefore mirror workspace, category,
work item, tab, and pane selection. Structural actions such as creating
tabs, splitting panes, moving panes, and resizing splits are also shared.

If a mutation invalidates part of the cursor, the daemon atomically chooses the
nearest valid fallback and broadcasts the corrected state. Clients do not
independently repair shared selection because they could choose conflicting
fallbacks.

Viewport-dependent presentation remains client-local:

- terminal and viewport dimensions;
- navigator visibility, drawer state, filtering, browsing, and expansion;
- command palette and leader-sequence state;
- prompt input, hover state, and other ephemeral interaction details.

Shared pane selection combined with differently sized clients requires a
deterministic PTY sizing policy. The Shared Session Navigation stage must
approve that policy in its companion design before implementation; the current
last-resize-wins behavior is not an acceptable accidental policy.

## Input Model

Power-user keyboard navigation is a primary feature. Nothing may be reachable
only with a mouse.

Work Craft commands use three complementary layers:

- **Direct spatial chords:** frequent navigation uses shortcuts such as
  `Ctrl+h/j/k/l`. Terminal applications may cooperate through focused adapters,
  such as a Neovim integration that delegates only at editor edges.
- **Leader commands:** `Ctrl+Space` starts discoverable multi-key sequences for
  common Work Craft actions.
- **Global chords:** a small set of actions may use Hyper-style combinations
  when they must be available from any focus context.

Ordinary input in terminal-backed panes must reach the child application.
Work Craft intercepts only complete, recognized commands and must not steal
unrelated printable keys as the current TUI does.

Mouse support is supplemental. It may select regions and panes, activate tabs,
and manipulate layouts, but every mouse action has a keyboard path.

The exact key map, leader grammar, command discoverability, focus transitions,
and terminal-application cooperation are deliberately owned by the Persistent
Shell And Input Foundation companion design.

## Responsive Layout

The category rail normally remains visible and narrow. Navigation no longer has
a compact initials/dots rail:

- At 120+ columns, open navigation is a docked sidebar beside the workbench.
- At 80–119 columns, navigation is hidden until explicitly opened as a drawer
  covering the main body, leaving header/category/status visible.
- Below 80 columns, a blocking resize presentation covers the working UI while
  reserving the one-row status bar. Runtimes and terminal renderers stay mounted;
  covered content receives no input. Quit/reconnect remain available.

Crossing wide to narrow hides navigation; an already hidden navigator stays hidden
on resizing, including widening. An explicitly opened drawer becomes docked when
widened. Small resizes inside the narrow band do not repeatedly dismiss it.

The drawer does not consume workbench layout space or change its keyed ancestry.
Successful terminal entry closes the drawer; failures report in the status bar
and leave it open. The resize guard does not reopen navigation on recovery.

See the Coding companion for full transition/focus rules. These accepted target
thresholds still require rendered/PTY verification; retain per-layout and height
undersizing protections without adding an unrelated global height threshold.

## Client And Server Ownership

### Daemon

The daemon remains authoritative for:

- sessions, workspace membership, categories, and unified work items;
- shared per-session navigation;
- surfaces, tabs, pane kinds, and split layouts;
- PTYs, child processes, output buffers, and process status;
- built-in pane data and integration execution;
- persistence, recovery, revisions, and ordered broadcasts.

### TUI

The React/OpenTUI client owns:

- rendering the persistent shell and active content;
- local responsive and transient interaction state;
- keyboard and mouse command recognition;
- terminal rendering and forwarding encoded terminal input;
- reconnecting and applying ordered daemon state.

The TUI sends semantic commands rather than mutating durable state locally. It
does not duplicate category business logic or integration execution.

### CLI

The CLI remains non-interactive and Unix-like. New durable operations added for
the TUI receive equivalent plain-text or JSON CLI access when they are useful
outside presentation. Transient client presentation commands do not require
CLI equivalents.

## Failure Handling

The persistent shell remains mounted through loading, reconnecting, and
recoverable failures.

- A daemon disconnect keeps the last coherent snapshot visible, clearly marks
  it stale, and disables mutations until reconnection succeeds.
- A Work Craft operational failure appears in the source-labelled status bar
  instead of replacing the application. Field-specific validation stays inline,
  whether detected by client or server.
- A failed terminal pane preserves its layout, history, and recovery metadata
  and exposes an actionable retry.
- Persistent unavailable/failed state stays marked on the affected item/pane;
  detailed failure text is not duplicated in regional banners. A retry/configuration
  action may remain associated with that source.
- A deleted or concurrently invalidated navigation target is normalized by the
  daemon to the nearest valid fallback in the same transaction.
- A terminal below 80 columns uses the blocking resize presentation; other
  undersized layouts retain their own protections. Narrow navigation uses the
  explicitly approved drawer rather than the historical compact/no-overlay rule.

Failures in one pane must not unmount unrelated panes or discard their local
terminal-emulator state.

Child-program stderr/output stays in its terminal, and CLI/pre-TUI fatal errors
stay on stderr. Repeated background failures are deduplicated. Error history is
not v1; status lifetime/priority/clearing must be explicit in the approved plan.

## Incremental Delivery

The overhaul uses shell-first incremental replacement. There is no teardown
phase and no parallel `v2` entry point. Existing behavior and tests remain until
the corresponding new path has equal or stronger coverage.

Each architectural stage starts with a focused companion design when marked
below. The companion design must be approved before that stage receives an
implementation plan. These designs are written just in time rather than in
advance, so they can use lessons from the preceding runnable stage.

### Current Progress

Stage 1's persistent shell and input foundation is implemented, including the
subsequent [focus and input contract refinements](./2026-10-02-tui-focus-input-contract-design.md).
Stage 2, Shared Session Navigation, is next and still requires its companion
design before implementation.

Before that stage, the Coding Navigator/unified-item slice, repository-group
follow-up and component-adoption Phases 1–5 (including styling/demos) are delivered
and accepted for progression. Phase 5's independent whole-session/follow-up reviews,
split/tab/restart focus repairs and the Oct 19 restyle/status-repair baseline are
complete (1,398 tests, zero failures, build and compiled smoke on macOS).

Phase 6's bounded consolidation is implemented and verified: no displaced code
remains to delete in its named audit, intentional native boundaries are inventoried,
and composed-shell injected-theme/scroll coverage is added without production
features. Connected review passed with no findings; the fresh macOS full check
passed 1,399 tests, zero failures, lint/format/types, build and compiled smoke,
exit `0`. The user accepted component adoption as complete on 2026-10-19; the next
step is a separately authorized architectural design. No Stage 2 design,
shared-selection implementation or multi-client PTY-sizing policy is supplied by
this phase. Client-local focus, filters/cursors, dialogs, expansion and viewport
state remain distinct from daemon-owned durable state/runtimes. Linux live-cwd and
physical-terminal checks are not claimed from the macOS automation.

The `ui-components` branch delivers component-library groundwork between those
stages:

- Themed Card, Badge, Alert, Spinner, Progress, Collapsible, Accordion, and Tabs
  components, plus Container and ScrollArea primitives.
- Refinements to existing controls and primitives: composite button content,
  text transforms and heading colors, explicit native key consumption, and
  opt-in page-background focus.
- Keyboard-first compound interactions, tab-content focus activation, nested
  wheel isolation, and activity-aware scrollbar colors.
- Standalone controls and component demos with theme/width cycling and focused
  behavioral coverage for layout, input, focus, scrolling, and lifecycle.

This is supporting TUI work, not a new architectural stage or an implementation
of shared navigation. Durable state and runtime ownership remain unchanged.
The remaining reusable components will be added on a separate future branch;
the current component inventory does not imply a complete UI library.

### Stage 1: Persistent Shell And Input Foundation

Introduce the workspace bar, invariant category rail, responsive project/item
navigator, workbench region, focus zones, and command-routing foundation around
the current working behavior.

**Required companion design:** define the exact keyboard grammar, focus
transitions, command discovery, terminal-app cooperation, responsive states,
overflow behavior, and minimum terminal dimensions.

### Stage 2: Shared Session Navigation

Move active workspace, category, work item, tab, and pane selection into
daemon-owned session state and mirror it across attached clients.

**Required companion design:** define persistence, initial selection,
concurrent navigation commands, invalid-target fallback, detach and reattach
behavior, and multi-client PTY sizing.

### Stage 3: Workbench Operations

Complete keyboard-first tab and pane management, including creation, closing,
movement, reordering, split resizing, process status, and recovery actions.

**Pulled forward to component-adoption Phase 5 (2026-10-17):** current-directory
inheritance on split (manual finding #5) and automatic pane equalization after
splitting (#8) must already be implemented when Stage 3 begins. A new split
inherits the source terminal's live cwd, including `cd` changes, rather than
only its startup/item directory; panes are automatically equalized after a split.
These two behaviors are now implemented and accepted for progression under the
approved Phase 5 companion, with automated macOS acceptance; Linux live-cwd remains unverified.
Their detailed design, implementation, and initial acceptance belong to
[component-adoption Phase 5](./2026-10-13-tui-component-adoption-design.md#phase-5-workbench-presentation).
Stage 3 preserves and regression-tests those behaviors while adding its remaining
operations; do not defer or reimplement them as new Stage 3 work.

**Required companion design:** define exact command semantics, destructive
action safeguards, focus after mutations, and split-tree transformations.

### Stage 4: Mixed Pane Architecture

Extend protocol, persistence, and rendering so one split tree can contain
terminal and first-party built-in panes. Deliver one minimal built-in pane to
prove the boundary before adding product-specific dashboards.

**Required companion design:** define pane discriminants, durable pane data,
renderer dispatch, lifecycle, loading and error states, and the boundary
between server-provided structured data and client rendering.

### Stage 5: Category Experiences

Add category-specific item data, actions, and first-party views while
preserving the common work-item navigation contract. Each category or coherent
integration receives a focused design when selected for implementation.

### Stage 6: Consolidation And Polish

Remove displaced components, align theme and status treatment, complete
resize, empty, loading, and error states, and verify the full migration. This
stage needs no companion architecture design unless it uncovers a new boundary.

## Verification Strategy

Every stage leaves the normal entry point runnable and ends with
`bun run check`.

Existing tests for reconnects, terminal replay, session selection, navigation
projection, split layouts, and recovery remain until superseded. New coverage
focuses on behavioral boundaries:

1. Keyboard-routing tests prove recognized Work Craft commands are intercepted
   while unrelated terminal input passes through unchanged.
2. Shell tests cover docked, drawer, hidden, and resize-guard navigation, focus
   transitions, source-labelled status errors, and representative terminal sizes.
3. Multi-client tests attach two real TUI clients to one session and verify
   mirrored navigation, concurrent changes, disconnects, and reattachment.
4. Workbench tests cover tab and pane mutations without restarting unaffected
   terminal runtimes.
5. Persistence tests restore shared navigation and mixed-pane layouts across a
   daemon restart.
6. One end-to-end path exercises session, workspace, category, item, tab, and a
   tab containing both terminal and built-in panes.

Broad visual snapshot suites remain excluded. Small behavioral render tests,
pure layout tests, and real PTY acceptance tests provide more durable coverage.

## Success Criteria

The overhaul is complete when:

- organization and active work remain visible together in the persistent
  shell;
- the category rail remains visible outside the explicit resize guard, and the
  work-item navigator follows the docked/drawer/hidden rules without remounting terminals;
- all functionality is keyboard-accessible and terminal applications retain
  unrelated input;
- clients attached to one session mirror navigation and workbench selection;
- tabs can contain mixed terminal and first-party built-in panes;
- disconnecting the TUI never stops daemon-owned runtimes;
- durable user data, terminal history, and recovery survive normal operation;
  the expressly permitted Coding development-state reset is a bounded exception,
  not a production silent-reset policy;
- displaced old presentation paths are removed rather than retained as a
  second interface.

## Deliberate Exclusions

- A teardown or blank-slate rewrite.
- A parallel permanent or temporary `v2` TUI entry point.
- Remote, distributed, or multi-daemon architecture.
- Custom or user-defined top-level categories.
- Third-party plugins or a general pane extension API.
- User-composed dashboard/widget systems.
- Mouse-only interactions.
- Broad visual snapshot testing.
- Detailed category integrations before their focused designs are approved.

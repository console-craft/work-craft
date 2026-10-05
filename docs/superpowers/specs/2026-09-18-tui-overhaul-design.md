# TUI Overhaul Design

## Goal

Replace the current screen-swapping TUI with a persistent, keyboard-first
application shell that keeps organization and execution visible together.
Users navigate sessions, workspaces, categories, projects, and items while
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
  project and item navigator for the active workspace and category.
- **Workbench:** shows the active item's tabs and renders the active tab's
  split pane tree.

The navigator and workbench remain visible together during normal use. Opening
an item no longer replaces navigation with a separate surface screen.

### Reference Sketches

The approved sketches are directional references for the shell's information
architecture and region relationships, not pixel-perfect rendering contracts:

- [Implementation category](../../sketches/sketch-implementation-category.png)
- [Operations category](../../sketches/sketch-operations-category.png)

## Product Hierarchy

The existing product hierarchy remains the foundation:

```text
server
└── session
    └── workspace
        └── category
            └── project
                └── item
                    └── execution surface
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
Implementation, Collaboration, and Operations. The category rail always shows
all six as icons and never disappears because of terminal width.

All categories preserve the same project-to-item navigator shape. Categories
may specialize item data, row labels, actions, and workbench views, but do not
replace the navigation hierarchy.

### Projects And Items

Projects organize items within a workspace and category. Items remain the
smallest selectable work unit and the owner of an optional execution surface.
Selecting an item activates its surface or an appropriate empty state if the
item does not yet have one.

Projects and categories do not own terminals directly. `Open terminal here`
continues to create or reuse an item-owned surface as the permanent escape
hatch for workflows without a specialized built-in view.

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
    → active project/item
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
project or item, tab, and pane selection. Structural actions such as creating
tabs, splitting panes, moving panes, and resizing splits are also shared.

If a mutation invalidates part of the cursor, the daemon atomically chooses the
nearest valid fallback and broadcasts the corrected state. Clients do not
independently repair shared selection because they could choose conflicting
fallbacks.

Viewport-dependent presentation remains client-local:

- terminal and viewport dimensions;
- expanded or compact project navigator state;
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

The category rail is always visible and remains narrow because it contains
icons rather than full labels.

The project and item navigator has two responsive forms:

- **Expanded:** names and hierarchy are visible.
- **Compact:** it becomes a secondary narrow rail rather than disappearing.

Expanding the navigator in a narrow terminal participates in normal layout and
shrinks the workbench. It never overlays the workbench. The workbench absorbs
the remaining width and is the shell's primary flexible region.

Exact widths, breakpoints, overflow behavior, and minimum viable pane sizes
belong to the Persistent Shell And Input Foundation companion design because
they require rendered prototypes and terminal-size testing.

## Client And Server Ownership

### Daemon

The daemon remains authoritative for:

- sessions, workspace membership, categories, projects, and items;
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
- A command failure appears in the region that initiated it instead of
  replacing the whole application.
- A failed terminal pane preserves its layout, history, and recovery metadata
  and exposes an actionable retry.
- A failed built-in integration renders its error inside the pane with an
  actionable retry or configuration message.
- A deleted or concurrently invalidated navigation target is normalized by the
  daemon to the nearest valid fallback in the same transaction.
- A terminal that is too small for useful rendering reports the constraint
  without hiding the category rail or overlaying navigation on the workbench.

Failures in one pane must not unmount unrelated panes or discard their local
terminal-emulator state.

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

Move active workspace, category, project or item, tab, and pane selection into
daemon-owned session state and mirror it across attached clients.

**Required companion design:** define persistence, initial selection,
concurrent navigation commands, invalid-target fallback, detach and reattach
behavior, and multi-client PTY sizing.

### Stage 3: Workbench Operations

Complete keyboard-first tab and pane management, including creation, closing,
movement, reordering, split resizing, process status, and recovery actions.

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
preserving the common project/item navigator. Each category or coherent
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
2. Shell tests cover expanded and compact navigation, focus transitions, and
   representative narrow and wide terminal sizes.
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
- the category rail never disappears, and the project navigator responds as
  specified without overlaying the workbench;
- all functionality is keyboard-accessible and terminal applications retain
  unrelated input;
- clients attached to one session mirror navigation and workbench selection;
- tabs can contain mixed terminal and first-party built-in panes;
- disconnecting the TUI never stops daemon-owned runtimes;
- existing user data, terminal history, and recovery behavior survive the
  migration;
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

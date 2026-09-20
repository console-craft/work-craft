# TUI Stage 1 Shell And Input Design

## Goal

Deliver the persistent Work Craft shell and its keyboard-first input foundation
without changing durable domain schemas or introducing later-stage pane kinds
and lifecycle operations.

Stage 1 replaces the current screen-swapping composition with one mounted shell
containing workspace, session, category, project/item, tab, workbench, and
status regions. It also replaces distributed printable-key shortcuts with a
root command router that protects terminal input, supports spatial focus,
provides contextual hints, and establishes the provisional cross-stage keymap.

This design is a focused companion to
[`2026-09-18-tui-overhaul-design.md`](./2026-09-18-tui-overhaul-design.md).
The overhaul's approved sketches remain directional references:

- [Implementation category](../../sketches/sketch-implementation-category.png)
- [Operations category](../../sketches/sketch-operations-category.png)

## Stage Boundary

Stage 1 changes presentation, focus, and command routing while preserving:

- the daemon protocol and SQLite schema;
- the snapshot store and reconnect behavior;
- item-owned execution surfaces;
- terminal replay and stable pane identity;
- the existing terminal-only pane kind;
- existing session, workspace, project, item, tab, split, and restart commands.

Stage 1 does not implement:

- daemon-owned shared navigation from Stage 2;
- closing, reordering, moving, zooming, or resizing workbench panes and tabs
  from Stage 3;
- built-in panes from Stage 4;
- item archival or category-specific lifecycle behavior;
- user-configurable keymaps or a terminal-application plugin framework.

The normal TUI entry point remains runnable throughout the migration. There is
no teardown phase and no parallel `v2` interface.

## Persistent Shell

The root always renders the same regional composition:

```text
┌ workspace strip ───────────────── session switcher + ● ┐
├ category rail ┬ project/item navigator ┬ tab strip ────┤
│ fixed         │ expanded or compact    ├───────────────┤
│               │                        │ terminal tree │
├───────────────┴────────────────────────┴───────────────┤
│ MODE │ contextual status content                       │
└────────────────────────────────────────────────────────┘
```

The shell remains mounted during session selection, creation prompts, empty
states, loading, reconnects, and open execution surfaces. Transient states
render inside their owning region or in a focused dialog rather than replacing
the application.

### Regions

- **Workspace strip:** displays a viewport over the active session's
  workspaces.
- **Session switcher:** displays the attached session and opens session
  selection.
- **Connection indicator:** shows daemon health beside the session switcher.
- **Category rail:** always-visible fixed-width category icons.
- **Navigator:** project/item hierarchy in expanded, compact, or hidden form.
- **Tab strip:** ordered tabs for the active execution surface.
- **Workbench:** the active tab's current terminal split tree.
- **Status bar:** one-line mode and contextual feedback surface.

The status bar and connection indicator are informational and never become
focus targets.

## Client State

Stage 1 keeps current navigation selection client-local. The root owns a small
presentation state containing:

- the focused region and last focused child of composite regions;
- local browsing cursors for workspace, category, navigator, and tab regions;
- navigator visibility override and preferred expanded width;
- vertical navigator scroll position;
- workspace-strip viewport;
- leader prefix and the first-leader timestamp;
- active dialog and prompt input;
- the latest command error associated with a region.

The snapshot store remains the source for server data. Stage 2 will move active
navigation into daemon-owned session state; Stage 1 must not shape its local
state in a way that prevents that migration.

## Focus Model

The root maintains a deterministic spatial focus graph built from visible shell
regions and the active split tree. Focusable nodes are:

- workspace strip;
- session switcher;
- category rail;
- project/item navigator when visible;
- tab strip;
- terminal pane leaves.

`Ctrl+h/j/k/l` moves to the nearest valid node in the requested direction and
does not wrap. Entering a composite region restores its last focused child. For
example, returning from the navigator to the workbench restores the previously
focused pane.

The graph crosses region boundaries:

- left and right connect category rail, navigator, and workbench panes;
- up and down connect workbench panes, tab strip, and header regions;
- pane-to-pane movement follows the rendered split geometry;
- movement at an outer edge stops rather than wrapping.

Every focus target has a visible focus treatment distinct from active server
selection and the local browsing cursor.

### Region Navigation

Shell navigation regions use a common interaction grammar:

- `j/k` and Up/Down move a vertical cursor;
- `h/l` and Left/Right move a horizontal cursor or collapse/expand hierarchy
  where meaningful;
- `Enter` confirms or activates the cursor target;
- moving a cursor does not activate a target or change the workbench;
- cycling stops at list edges and never wraps.

A mouse click focuses and activates its target. The equivalent keyboard path is
cursor movement followed by `Enter`; no action is mouse-only.

Global Hyper navigation is intentionally different: it activates immediately,
aligns the relevant local cursor, preserves the currently focused region, and
does not wrap.

### Hidden Navigator Focus

If the navigator is focused when it is hidden, focus moves to the last focused
workbench pane or, when no workbench is available, the category rail. Showing
the navigator does not steal focus.

## Root Command Router

One root command table defines each command's:

- stable ID;
- key sequence;
- valid focus scope;
- status-bar label;
- availability predicate;
- semantic callback.

The table drives both execution and contextual hints so displayed bindings
cannot drift from behavior. Components expose semantic callbacks and local
cursor operations; they do not install competing global keyboard handlers.

This is a fixed application command table, not a public keybinding system,
event bus, or plugin API.

### Routing Priority

Key handling follows this order:

1. A focused dialog handles its scoped commands.
2. Active leader input resolves or cancels the current sequence.
3. Registered Hyper and other global chords run when available.
4. Spatial `Ctrl+h/j/k/l` changes focus.
5. The focused shell region handles local navigation.
6. Unhandled terminal input passes to the embedded terminal unchanged.

Handlers stop propagation only when they recognize and consume a command.

`Ctrl+C` is no longer a renderer-level exit shortcut and reaches a focused
terminal. `Escape` also reaches a focused terminal unless it is cancelling
leader mode or a focused dialog. Quitting Work Craft uses `Hyper+q`.

## Leader Behavior

`Ctrl+Space` enters `LEADER` mode. Leader mode has no general timeout and
remains active until:

- a complete valid command executes;
- `Escape` cancels it;
- an invalid sequence is consumed and reported;
- a qualifying double-prefix passes through to a terminal.

An invalid sequence enters `ERROR` mode and reports the invalid key for one
second before returning to the status mode derived from focus and navigator
state. It is never forwarded to the child terminal.

### Terminal Double Prefix

When a terminal pane is focused, pressing `Ctrl+Space` a second time within one
second exits leader mode and sends one literal `Ctrl+Space` to the child. This
supports nested terminal applications that use the same leader.

A second `Ctrl+Space` after that window follows normal invalid-sequence
behavior. The leader itself still has no timeout.

## Hyper Input

For this design, Hyper means the physical `Ctrl+Alt+Super` combination. Work
Craft prioritizes correct behavior in Ovi's WezTerm environment over speculative
terminal-emulator portability.

Stage 1 enables OpenTUI's Kitty keyboard protocol with disambiguation and
accepts either:

- a native OpenTUI `hyper` key event; or
- an event carrying the `ctrl`, Alt/Meta, and `super` modifiers together.

`Hyper+Space` remains unbound because WezTerm reserves it.

Every Stage 1 Hyper binding must be manually verified in the real WezTerm
setup. Only a binding that fails that verification may receive a targeted
WezTerm mapping that emits an unambiguous Kitty sequence. Work Craft does not
require external configuration preemptively.

## Provisional Cross-Stage Keymap

This keymap records current product direction and may be revised as later
stages expose real interaction constraints. Stage 1 displays hints only for
implemented commands; reserved bindings remain invisible until their owning
behavior exists end to end.

### Stage 1 Global Commands

| Binding                 | Action                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `Ctrl+Space`            | Enter leader mode                                             |
| `Ctrl+Space Ctrl+Space` | Send one literal `Ctrl+Space` to a focused terminal           |
| `Ctrl+h/j/k/l`          | Move spatial focus without wrapping                           |
| `Hyper+h`               | Activate previous category without moving focus               |
| `Hyper+l`               | Activate next category without moving focus                   |
| `Hyper+j`               | Activate next visible navigator node without moving focus     |
| `Hyper+k`               | Activate previous visible navigator node without moving focus |
| `Hyper+[`               | Activate previous tab without wrapping                        |
| `Hyper+]`               | Activate next tab without wrapping                            |
| `Hyper+n`               | Create a new tab                                              |
| `Hyper+s`               | Open or focus the session switcher                            |
| `Hyper+r`               | Force reconnect and snapshot reload                           |
| `Hyper+q`               | Quit the TUI without stopping daemon runtimes                 |
| `leader+n`              | Create an item under the focused project                      |
| `leader+b`              | Hide or show the responsive navigator                         |
| `leader+s`              | Split the active pane horizontally and focus the new pane     |
| `leader+v`              | Split the active pane vertically and focus the new pane       |
| `leader+r`              | Restart an eligible active pane                               |

Hyper category, navigator, and tab cycling activates immediately, aligns the
corresponding client cursor, preserves focus, and stops at the first or last
entry.

`leader+n` creates under the navigator cursor's project when the navigator is
focused. From another region, it creates under the active item's project. It is
unavailable when neither context identifies a project.

### Stage 1 Contextual Commands

| Focus            | Binding           | Action                                          |
| ---------------- | ----------------- | ----------------------------------------------- |
| Session switcher | `n`               | Create session                                  |
| Workspace strip  | `h/l`, Left/Right | Move cursor without wrapping                    |
| Workspace strip  | `Enter`           | Activate cursor workspace                       |
| Workspace strip  | `n`               | Create workspace in the active session          |
| Category rail    | `j/k`, Up/Down    | Move cursor without wrapping                    |
| Category rail    | `Enter`           | Activate cursor category                        |
| Navigator        | `j/k`, Up/Down    | Move through visible project/item nodes         |
| Navigator        | `h/l`, Left/Right | Collapse/expand the cursor project              |
| Navigator        | `Enter`           | Activate cursor project or item                 |
| Navigator        | `n`               | Create project in the current category          |
| Navigator        | `o` on project    | Create/reuse and open its project terminal item |
| Navigator        | `Ctrl+Left/Right` | Resize expanded width by one column             |
| Tab strip        | `h/l`, Left/Right | Move cursor without wrapping                    |
| Tab strip        | `Enter`           | Activate cursor tab                             |

`o` remains distinct from `Enter`: `o` on a project invokes the existing
`surface.ensureHere` behavior, while `Enter` on an item opens that item's own
surface.

### Reserved Later-Stage Commands

| Binding                | Intended action                        | Owning design                  |
| ---------------------- | -------------------------------------- | ------------------------------ |
| `Ctrl+arrows` on pane  | Resize active pane                     | Stage 3 workbench operations   |
| `Hyper+Shift+[`        | Move active tab left                   | Stage 3 workbench operations   |
| `Hyper+Shift+]`        | Move active tab right                  | Stage 3 workbench operations   |
| `Hyper+c`              | Close active tab                       | Stage 3 workbench operations   |
| `leader+q`             | Close active pane                      | Stage 3 workbench operations   |
| `leader+Shift+h/j/k/l` | Swap pane in a direction               | Stage 3 workbench operations   |
| `Hyper+Enter`          | Zoom or restore active pane            | Stage 3 workbench operations   |
| `leader+d`             | Archive active item or focused project | Category/item lifecycle design |

Unassigned familiar keys such as `Ctrl+n`, `Ctrl+p`, `/`, and contextual
brackets remain free until a concrete behavior needs them.

## Terminal-App Cooperation

Stage 1 implements the stable behavioral contract but not an application
adapter:

- unintegrated terminal panes give `Ctrl+h/j/k/l` to Work Craft;
- the double prefix passes one literal leader to the child;
- a future integrated app may own spatial chords and invoke the same semantic
  `focus(direction)` command only at an application edge;
- app-originated focus must enter the normal command path rather than mutate
  React focus directly.

Stage 1 adds no foreground-process heuristics, custom OSC parser, plugin
framework, passthrough toggle, or unused adapter interface. The first concrete
adapter, likely Neovim, receives a focused transport design after Stage 2 owns
session focus.

## Navigator States

The navigator has three client-local states.

### Expanded

- Default width is 32 columns.
- `Ctrl+Left/Right` changes the width in one-column steps.
- The adjusted width remains fixed until changed or the client exits.
- Project and item labels use trailing ellipses when they exceed available
  width.
- The status bar uses `HINTS` while this region is focused.

### Compact

- Compact mode is an automatic narrow-width fallback, not a different
  navigator.
- It renders project initials and nested dots for items.
- It preserves hierarchy, ordering, cursor, project expansion, and scrolling.
- It performs no regrouping, filtering, active-project expansion, or other
  context-sensitive redraw.
- `j/k`, `h/l`, and `Enter` keep exactly the expanded-mode behavior.
- The status bar uses `INFO` while this region is focused and shows the full
  cursor project/item label.
- Manual expanded-width changes are retained but do not disable automatic
  transitions between compact and expanded modes.

### Hidden

- The navigator never hides automatically.
- `leader+b` hides either visible form.
- Invoking `leader+b` while hidden restores responsive auto mode.
- Hiding preserves the adjusted expanded width. Showing and later automatic
  expansion restore that width.
- The category rail remains visible.

Both visible forms scroll vertically and keep the local cursor in view. The
compact representation is a stable projection of the same visible node list,
not a separately navigable data structure.

## Responsive Geometry

Initial cell dimensions are:

- category rail: 5 columns;
- expanded navigator: 32 columns by default;
- compact navigator: 7 columns;
- automatic navigator compaction below 120 shell columns;
- minimum renderable workbench interior: 60 columns by 5 rows.

In auto mode, the navigator is expanded at shell widths of 120 columns or more
and compact below 120. Manual navigator resizing changes the preferred expanded
width without disabling this responsive behavior.

Below the minimum workbench size, the workbench shows a message instructing the
user to resize or use `leader+b`. It does not send invalid tiny PTY dimensions.
The last valid terminal dimensions remain in effect. Header, category rail, and
status bar stay mounted.

The constants may be calibrated during implementation only if OpenTUI's
rendered border accounting differs from logical cell measurements. The
behavioral thresholds and region priorities remain unchanged.

## Workspace Overflow

The workspace strip is a one-line viewport and never wraps. It shows a
contiguous subset of workspace tabs with left/right overflow markers when
needed.

- The local cursor and active workspace are always scrolled into view.
- `h/l` and Left/Right browse without wrapping.
- `Enter` activates the cursor workspace.
- Overlong individual names use trailing ellipses.
- The session switcher and connection dot stay pinned on the right.
- An overlong session name truncates before displacing its control or status
  indicator.

## Status Bar

The always-visible status bar is the shell's primary contextual feedback
surface. Its left segment displays an explicit mode; the remainder displays
mode content.

Stage 1 defines four modes:

- **`HINTS`:** commands relevant to the focused region.
- **`LEADER`:** valid continuations for the current leader prefix.
- **`INFO`:** the full cursor project/item label while the compact navigator is
  focused.
- **`ERROR`:** transient invalid leader input and its rejected key.

`LEADER` temporarily supersedes `INFO`. Invalid input replaces it with `ERROR`
for one second. Completing or cancelling the sequence restores the status mode
derived from focus and navigator state.

The mode representation is deliberately easy to extend when a concrete new
feedback state appears, but Stage 1 does not add empty placeholder modes.
Connection information does not appear in the status bar.

## Dialogs And Empty States

Session selection and creation forms are focused dialogs over the mounted
shell. A dialog:

- traps focus;
- provides contextual status-bar hints;
- closes with `Escape` when cancellation is valid;
- restores the previously focused region when it closes.

When no sessions exist, the session switcher opens automatically. Empty
workspace, category, item, and surface states render in their owning region and
offer only commands valid for that state.

## Connection And Failure States

The connection dot beside the session switcher is:

- green when connected and current;
- yellow while connecting or reconnecting with the last coherent snapshot
  still visible;
- red when disconnected.

Durable mutations are disabled while disconnected. Command failures render in
the region that initiated them and do not replace the shell or unrelated pane
content.

Changing focus, scrolling, resizing, compacting, hiding, opening dialogs, or
updating status content must not remount unaffected terminal renderers. Pane
identity and terminal replay keys remain unchanged.

## Verification Strategy

Stage 1 adds focused behavioral coverage rather than broad visual snapshots.

### Command Router

- routing priority and focus scope;
- direct versus leader commands;
- no-timeout leader behavior;
- one-second terminal double prefix;
- invalid sequence cancellation;
- no-wrap global cycling;
- `Ctrl+C` and terminal `Escape` passthrough;
- native and modifier-combination Hyper recognition;
- hints derived only from available commands.

### Focus And Layout

- spatial focus across shell regions and recursive pane layouts;
- edge stopping and last-focused-child restoration;
- browse-versus-activate behavior;
- expanded, compact, hidden, and manually restored navigator states;
- one-cell navigator resizing and ellipsis;
- stable compact initial/dot projection;
- vertical scroll and cursor visibility;
- workspace viewport and overflow markers;
- undersized workbench behavior.

### Integration

- existing reconnect, terminal replay, session, and split tests remain green;
- successful splits focus the newly created pane returned by the server;
- real TUI/PTTY tests prove ordinary terminal input is not stolen;
- shell changes do not remount unaffected terminal panes;
- dialogs and empty states preserve shell composition;
- all Stage 1 Hyper commands receive manual acceptance in WezTerm;
- any required WezTerm fallback receives a regression test for its Kitty
  sequence.

Every completed implementation slice runs its focused tests. Stage completion
requires a fresh `bun run check`.

## Success Criteria

Stage 1 is complete when:

- the persistent shell replaces screen-swapping composition;
- the workspace strip, session switcher, category rail, navigator, tab strip,
  workbench, and status bar coexist as designed;
- focus moves spatially across all visible regions without wrapping;
- keyboard browsing and activation remain separate;
- ordinary terminal input, `Ctrl+C`, and `Escape` are no longer stolen;
- `HINTS`, `LEADER`, compact-navigator `INFO`, and transient `ERROR` behave as
  specified;
- expanded, compact, hidden, resized, scrolled, overflow, and undersized states
  are usable;
- every implemented Hyper command works in the real WezTerm environment;
- current daemon, replay, reconnect, and recovery behavior remains intact;
- no Stage 2-4 architecture is introduced prematurely.

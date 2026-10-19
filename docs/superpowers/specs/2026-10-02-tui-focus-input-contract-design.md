# TUI Focus And Input Contract

## Phase 5 Accepted Amendment / Phase 6 Checkpoint (2026-10-19)

The approved [Phase 5 companion](./2026-10-18-tui-component-adoption-phase-5-design.md)
supersedes preservation-first workbench tab behavior below: native Tabs browsing
selects immediately, Enter/Space enters content, and mouse selection both selects
and activates content as a library default. The workbench uses shell-owned guarded
entry rather than generic TabsContent focus. Exited panes gain a keyboard/mouse
Reactivate control inside their bottom Alert; action focus is distinct from PTY
input eligibility. Existing terminal-source Hyper behavior, readiness cancellation,
status-safe overlays and raw terminal input remain protected. This amendment is
implemented: two-row native Tabs and shared overflow replace the old strip markers;
selection/entry ordering and Reactivate use the shell's existing cancellable
response-revision/native-readiness handoff, including response-first protection.
Terminal leaves remain outside TabsContent. Native tests cover keyboard/action
eligibility and ordering; normal-entrypoint PTYs complement them with delayed
keyboard/mouse selection, source-aware Hyper, exact-pane Reactivate and raw input.
Phase 5 is accepted for progression; independent whole-session and follow-up
reviews are complete. Accepted split, Hyper+n and explicit-restart repairs enter
only their exact running/native-ready destination; newer input/focus/context
intent still cancels handoffs. The Oct 19 restyle/status repair passed 1,398 tests,
zero failures, build and compiled smoke on macOS. Output is transparent/undimmed;
the canonical [adoption inventory](./2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries)
records geometry/colors and intentional native refs, focus/measurement/event
bridges and modal/router boundaries. Actual input still requires `20×5` terminal
geometry; recovery requires a `20×4` pane. Phase 6 implementation and connected
review are complete with no findings or production changes. Its fresh macOS full
check passed 1,399 tests, zero failures, lint/format/types, build and compiled smoke,
exit `0`. The user accepted all component-adoption work as complete on 2026-10-19. Injected theme
tests preserve focus/hints/scroll without adding runtime theme UI/API. Linux
live-cwd, physical contrast and long-running listener stability remain unverified;
native/input/React and lint warnings remain debt. Stage 2 is not implemented.
Earlier dated checkpoints retain their historical acceptance notes.

## Navigation Follow-up Checkpoint (2026-10-17)

The approved [navigation follow-up](./2026-10-17-coding-navigation-followup-design.md)
supersedes the no-terminal-entry rule for **local terminal-source** Hyper tab
switches below: enter that destination tab's remembered valid running pane, else
its first usable running pane. Tab-strip/other-control actions and background
snapshots still preserve scope. New/duplicate registration and generic creation
use the same response-revision/native-readiness handoff, cancelled by newer intent.
Stopped panes move native focus to tabs without losing the selected restart
target; live authoritative gates block all PTY-bound input before React commits.
Output/replay and raw running-terminal keys remain unchanged. Explicit restart
may enter only its own ready pane. Exact reported visual flicker was not reproduced;
independent implementation review and regression-tested fixes are complete, while
human/physical-terminal acceptance remains pending. The older verification records
below do not certify this follow-up.

## Coding Implementation Checkpoint (2026-10-16)

Navigator now has `navigator:filter` and `region:navigator` native endpoints, not per-row stops. A pending filter transfer carries query/version/origin rather than replayable keys. Shell entry waits for response revision plus a running, mounted, usable active-tab terminal, with per-tab pane memory. Covered workbench leaves retain identity but reject input; resize guard leaves only reconnect/quit. Coding acceptance/review evidence and human verification remain tracked in its primary spec; existing raw-key contracts below remain binding.

## Accepted Target Amendment

The [Coding Navigator design](./2026-10-15-coding-navigator-design.md) now governs
the updated activation, filter/results focus, drawer/resize guard, and centralized
error presentation described below. The 2026-10-16 Coding implementation and its
verification are recorded in that design; the separately approved follow-up above
amends local tab and terminal-entry behavior. Earlier focus/component verification
remains historical, not evidence for the follow-up's acceptance.

## Goal And Stage Boundary

Establish a coherent focus and keyboard-ownership contract for the existing
React/OpenTUI shell and component library before Stage 2 moves active navigation
into daemon-owned session state.

This is an addendum to
[`2026-09-18-tui-stage-1-shell-input-design.md`](./2026-09-18-tui-stage-1-shell-input-design.md).
It refines that design's focus, routing, dialogs, and hint behavior. The original
addendum left responsive layout and the domain protocol/schema unchanged; the
later Coding companion explicitly amends those contracts. Terminal identity,
replay, reconnect, and capability ownership remain protected.

The implementation covers current shell regions, dialogs, controls, and the
standalone controls and component demos. Neovim cooperation is a required
behavioral contract; its plugin and transport implementation receive a separate
design. Shared navigation remains Stage 2 work.

## Decision

Centralize focus policy; keep control behavior local.

OpenTUI owns the actual focused renderable. One application-level keyboard
policy coordinates the active scope, application commands, and spatial focus
movement. The focused control or composite shell region handles its local
input and exposes semantic callbacks for application behavior.

The alternatives are a chooser-only routing patch, which leaves the ownership
mismatch in place, and routing every widget key in the shell, which makes the
shell depend on each control's implementation. Native focus coordination with
local handlers establishes the contract using the existing renderer and
components.

```text
key event
  -> application policy: active scope, leader/global commands, spatial focus
  -> focused control or composite region: local interaction
  -> semantic callback or terminal input

native focus event
  -> synchronized shell context
  -> focus styling and eligible action hints
```

## Focus, Cursor, And Selection

Three concepts stay distinct:

- **Keyboard focus:** the control or pane receiving local input.
- **Browsing cursor:** a control's locally highlighted candidate.
- **Active selection:** the application context activated by confirmation or an
  explicit global command; Stage 2 will make navigation selection shared.

Moving focus to New session preserves the session list's cursor. Browsing the
focused list does not attach a session. Enter on the list activates its cursor;
Enter or Space on the button starts session creation.

Local interaction must never operate on an unfocused sibling. An unhandled key
on a button does not become a list-navigation command because both controls
belong to the same dialog.

### Local Activation Versus Selection Updates

Local keyboard and mouse activation express the same intent to enter a destination:

- Session attachment/reselection enters workspace navigation; workspace activation
  enters categories; category activation explicitly reveals/enters navigation,
  including empty results. It does not bypass the below-minimum resize guard.
- Enter or matching primary-button row release opens either root or child work
  item and enters its active tab's remembered valid terminal, otherwise its first
  eligible terminal. A Coding Project is a root item, not a container requiring o.
- Browsing, filtering, and expansion do not activate an item or move the workbench.
  Space toggles project expansion; it is not row activation.
- Workbench strip browsing switches selection without entry; explicit Enter/Space
  and primary release request guarded content entry, as amended by Phase 5 above.

There is no separate mouse-preview mode. Local terminal-source Hyper tab switches
request guarded destination entry; tab-strip/other-control Hyper tab switches and future
remote shared-selection updates preserve local focus rather than independently
requesting entry.

An asynchronous open moves focus only after command success and a rendered
snapshot reaches the response revision in the same epoch. Until then, the
navigator remains focused. Failures, empty tabs, and undersized workbenches do not
enter a pane; a successful surface response without a usable terminal is not a
completed entry. Pending starting panes may finish under the same cancellable
intent. Further keyboard input, native focus movement (even leave-and-return
without a React commit), further navigator browsing or activation, opening a
dialog, or changing the epoch or active item cancels the handoff. A cancelled
handoff is not revived by a later snapshot.

Successful drawer activation closes the drawer and enters the destination; failure
keeps it open and reports in the status bar. Ordinary dismissal restoration must
not subsequently steal focus back. Per-tab remembered panes remain client-local
until the Stage 2 selection design.

### Filter And Results Focus

Navigation has two native stops: a filter Input and a results List. Tab/Shift+Tab
cycles them locally, not each result row. Ctrl+n in the filter selects/focuses the
first actual match, skipping a contextual parent; no match leaves filter focus.
Enter in the filter does not implicitly activate. Filter text/editing keys cannot
execute a sibling List command or navigator-region n/o/a shortcut. Buffered handoff
must use the latest query and rendered eligible candidate, never stale selection.

## Ownership

### Application Policy

`input/` owns application key recognition, routing eligibility, command metadata,
and the existing pure spatial-focus algorithm. `shell/` coordinates that policy
with native focus, the active dialog, command execution, and rendering.

The application has one global keyboard-policy listener. App no longer mounts
an independent Tab listener alongside the shell router. The existing traversal
helpers remain reusable by the application and standalone demos; each demo
has its own root input policy.

The shell retains semantic region context and last-focused-child information.
Native focus changes from keyboard, mouse, or lifecycle repair synchronize that
context. Local keyboard eligibility is determined by the actual focused
renderable, not its class or the mere existence of a dialog.

Main-shell regions have native focus endpoints. Application-requested spatial
movement focuses the destination endpoint; native focus events update the shell
context. Routing reads current native focus synchronously rather than waiting
for React to commit, including during buffered key input.

### Controls And Composite Regions

Controls own local navigation, editing, value changes, and activation through
native renderable handlers. They report actual focus for styling and may request
focus on mouse interaction. They do not install global keyboard listeners or
choose another scope's targets.

Shell navigation regions are composite controls: their component owns its
browsing keys and invokes callbacks to update local cursors or activate a
resource. Application actions such as contextual creation remain coordinated
through semantic commands.

`ui/` owns reusable focus traversal and control-level hint contracts without
importing shell or application command types. Application-specific labels,
callbacks, and scope policy remain in callers. Accepted navigation changes are
defined in the Coding companion; no configurable keybinding system is introduced.

### Component-Library Follow-Up

Reusable Accordion, Collapsible, and Tabs components keep their state and
interaction local. Hidden content stays mounted, while focus traversal skips
hidden descendants. Tabs use one list focus endpoint: browsing immediately
switches the displayed panel, and Enter/Space separately enters its first
eligible control or the focusable panel itself. Primary release also enters content,
including a reclick. TabsList owns two-row overflow/reveal. The workbench uses the
narrow activation callback instead of generic panel focus; terminal mounting and
readiness remain application-owned. This does not introduce shared tab selection.

Text-only labels, including interpolated strings and numbers, stay inside a
Text node; composed renderables retain their explicit colors. Uncontrolled
Accordion and Collapsible transitions use the latest local state during buffered
native input, while controlled values remain parent-owned and wait for updated
props. Header clicks tolerate crossing child hit targets but require release
inside the same header.

ScrollArea's opt-in keyboard fallback runs after native control dispatch and
only for the focused descendant's nearest scrolling ancestor. Input, Select,
and Textarea wrappers report native key consumption so editing and local
navigation win over page scrolling. Wheel events stop at the receiving
ScrollArea, including at its boundaries. Automatic scrollbar styling follows
keyboard and pointer eligibility independently; explicit color overrides win.

## Scopes And Lifecycle

A focus scope is a renderable boundary and eligibility policy, not an independent
store of keyboard focus. Dialogs use sequential Tab traversal only.

Eligible targets are mounted, not destroyed, focusable, enabled, and visible
through their ancestor chain within the active scope. Traversal follows rendered
child order. A composite control such as a radio group occupies one stop;
navigation among its internal candidates remains local.

| Event                                               | Required behavior                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Open a dialog                                       | Retain its shell return target and focus the designated initial control.                        |
| Open the session chooser                            | Focus the Command search input when sessions exist; otherwise focus New session.                |
| Replace the chooser with a creation form            | Focus its name input and preserve existing cancellation rules.                                  |
| Tab / Shift+Tab                                     | Move forward/backward among eligible controls, wrapping inside the scope.                       |
| Focused target becomes disabled, hidden, or removed | Choose the next eligible target in the previous traversal order, wrapping as needed.            |
| No eligible controls remain                         | Keep focus at the active scope boundary so dialog commands remain available.                    |
| Close a dialog                                      | Restore its saved target if valid; otherwise use the existing valid shell-region/pane fallback. |
| Ordinary render or data refresh                     | Preserve the focused target while it remains eligible.                                          |

The scope boundary is an emergency focus endpoint, not an extra Tab stop when
eligible controls exist. If controls become available while the boundary is
focused, focus the designated initial control or the first eligible target.
If a removed target has no surviving successor in the prior traversal order,
use the designated initial control or the first currently eligible target before
falling back to the boundary.

Standalone demo pages may explicitly opt into `allowRootFocus` so background
clicks can keep page scrolling focused while controls remain Tab targets. This
is not the default dialog policy and does not add the page boundary to normal
control traversal.

New session remains visible and keyboard-accessible when the session list is
empty. Focus initialization runs on scope entry/replacement, not on every render
or cursor update. During a transition, a missing or empty modal subtree must not
fall back to root-level shell traversal.

Existing cancellation rules remain explicit: the startup chooser cannot close
until a session is attached; cancelling startup session creation returns to the
chooser. Cancelling a creation form with an attached session closes the dialog
and restores shell focus.

Background mouse interaction cannot focus or activate shell content while a
dialog is active. Entering or replacing a dialog clears a pending shell leader
sequence. It does not resume after closing the dialog.

Outside dialogs, Ctrl+h/j/k/l retains no-wrap spatial movement across shell
regions and eligible terminal panes, including last-focused-pane restoration.
Covered workbench targets are ineligible while a navigation drawer is open; its
header/category controls remain usable. The below-80-column guard blocks covered
input except quit/reconnect and clears pending leader/handoff intent. Terminal and
dialog state stay mounted. Tab does not cycle shell regions: it traverses the
header or navigator's local controls, and reaches a focused terminal unchanged.

## Routing Rules

### With An Active Dialog

1. Apply the modal eligibility gate. Hyper+r reconnect and Hyper+q quit remain
   available; background navigation, session opening, tab/workbench actions,
   leader commands, and spatial shell movement are unavailable.
2. Recognize explicit dialog shortcuts: Ctrl+Space then n starts session creation
   in the chooser; plain n remains search text. Escape cancels where valid,
   including with a pending chooser prefix. The creation form keeps printable n local.
3. Plain Tab / Shift+Tab traverses the dialog's eligible controls. Other modified
   Tab events remain local control input unless explicitly bound by policy.
4. Remaining input reaches only the focused control in that scope.

Recognized but blocked application chords are consumed so they cannot invoke
background actions or accidentally activate a control. Ctrl+h/j/k/l is the
exception: in dialogs it is not a shell movement command and remains available
to the focused control's native editing behavior. Ctrl+Space cannot enter shell
leader mode inside a dialog; the focused control may handle it locally.

### Without A Dialog

Preserve the existing leader sequence, global-command, and spatial-command
precedence. After application policy, remaining input reaches the focused
control, composite region, or terminal. Recognized local navigation at a control
edge stays local even when its cursor cannot move.

Only recognized application commands or active-scope policy consume input at
the root. Root routing does not interpret ordinary control keys and then rely on
renderable-class exceptions to let the native handler run.

## Terminal And Neovim Cooperation

Unintegrated terminal panes retain Work Craft ownership of Ctrl+h/j/k/l. Ordinary
terminal input, including Tab, Shift+Tab, Ctrl+C, and Escape, reaches the child
unless it is explicitly part of a recognized application sequence. The existing
double-prefix leader passthrough remains unchanged.

A cooperating Neovim plugin must own spatial movement among Neovim windows and
delegate to the same Work Craft semantic focus operation only at an application
edge. Host-side blanket interception must not prevent that cooperation once the
adapter is implemented.

For a plain terminal pane beside Neovim with two vertical windows, the required
navigation is:

```text
plain terminal --Ctrl+l--> Neovim window 1 --Ctrl+l--> Neovim window 2
plain terminal <--Ctrl+h-- Neovim window 1 <--Ctrl+h-- Neovim window 2
```

The future transport design will establish how cooperation is enabled and how
edge requests arrive. This addendum adds no process-name detection, plugin,
transport, or unused adapter abstraction. Existing spatial commands remain the
normal path for pane movement.

## Contextual Hints

Hints use the same actual focus and eligibility context as routing, combining
application-command metadata, active-scope actions, and concise hints exposed
by the focused control. Native focus events update the status bar after keyboard,
mouse, and lifecycle changes.

Hint visibility is a presentation policy, separate from key recognition and
command availability. Supported movement keys remain functional without being
advertised. Common movement/traversal shortcuts are omitted from HINTS:

- Ctrl+h/j/k/l spatial movement;
- local h/j/k/l, arrow keys, and Ctrl+n/Ctrl+p;
- Tab/Shift+Tab traversal;
- local Home/End, g/G, paging, and scrolling bindings.

Activation/acceptance shortcuts such as Enter and Space, dismissal such as
Escape, application-level global chords, leader commands, and single-letter
contextual actions such as n or o may be shown when eligible. Application-level
global navigation chords remain discoverable even when they change selection;
they are distinct from the omitted routine local movement keys.

Under a modal, only reconnect/quit, eligible dialog actions, and focused-control
actions contribute hints. A focused New session button does not advertise list
browsing or selection. An input advertises submission when it has a submit action,
not button activation or a sibling control's behavior. Ineligible or disabled
actions are omitted. Duplicate actions are not repeated across sources.

Binding definitions and any hint-visibility metadata stay beside their owning
behavior. The shell composes hints; it does not maintain a second manual copy of
widget keymaps. HINTS and LEADER retain their roles. ERROR also reports Work Craft
operational failures with source attribution; compact-navigator INFO is no longer
required. Status lifetime/priority/clearing must be explicit in the implementation
plan rather than applying invalid-leader timing to all errors.

## Errors And Stage 2 Handoff

Command failures retain their originating operation/item/pane and stale-result
protections, but full Work Craft operational messages display in the status bar.
Field-specific client/server validation stays inline; persistent unavailable/failed
state remains marked on the relevant item/pane. Do not duplicate full messages in
regional banners or forms, steal focus, or create an error-history feature in v1.
Repeated identical discovery failures are deduplicated. Child-program output is
not parsed into notifications; CLI/pre-TUI fatal failures remain stderr.

Disconnection retains the last coherent view and keeps durable mutations disabled;
local focus, filtering, and browsing remain usable.

Stage 2 must distinguish shared active navigation, including selected pane,
from client-local region/control focus, scopes, browsing cursors, and form input.
Its companion design will define how remote selection changes affect the local
workbench input target. Valid modal/control focus must not be displaced by shared
selection updates. Invalid local targets receive a local presentation fallback,
not a client-originated repair of daemon-owned selection.

Local activation drill-down is intent from the initiating client, not a side effect
of shared selection. Stage 2 must preserve its local handoff while ensuring another
client's navigation command cannot independently trigger it here.

## Verification

Use focused behavioral checks at the ownership boundaries:

1. List navigation, endpoint, and paging keys cannot mutate the session cursor
   while New session is focused. Enter/Space on the button initiates creation
   once; Enter on the list activates its cursor once.
2. Tab/Shift+Tab wraps within the modal, skips ineligible targets and hidden
   ancestors, and repairs focus after a focused control disappears. Empty scope
   handling never focuses background content.
3. Empty-session creation is reachable by keyboard and mouse. Text input keeps
   printable n/j/k and native editing keys; dialog replacement and cancellation
   restore the correct scope/target without resuming leader mode.
4. Modal background commands and mouse interaction cannot change shell context.
   Reconnect and quit remain available and are represented by eligible hints.
5. Terminal input reaches the stream with Tab/Shift+Tab, Ctrl+C, and Escape
   preserved. Existing spatial pane movement and double-prefix passthrough
   remain green; focus/dialog changes do not remount unaffected terminals.
6. Styling and action hints follow actual focus after keyboard, mouse, and
   buffered input. Common movement hints are absent while acceptance, dismissal,
   global/leader, and contextual-action hints remain eligible and concise.
7. Header/category drill-down and workbench tab behavior retain their accepted
   contracts; navigation uses filter/results focus, List browsing, and caller-owned
   expansion. Filter typing and buffered focus transfer never activate stale results.
8. Root/child Enter and mouse activation enter a valid terminal after successful
   opening regardless of response/snapshot ordering. Failure/cancellation preserves
   source focus and an open drawer; terminal-source Hyper tab switching requests
   entry, while control-source tab switching/remote selection preserves scope.
9. Drawer/resize-guard transitions preserve terminal identity and input ownership.
   Status errors remain visible through dialogs/drawers; field validation and
   persistent source indicators retain their distinct roles.

Use representative native and composite controls instead of exhaustive
per-control suites or broad visual snapshots. Real PTY acceptance proves terminal
input passthrough. Raw shell input checks wait for rendered terminal cursor/focus
readiness after activation and restoration instead of fixed sleeps; a delayed
daemon response exercises the pre-handoff window. The future Neovim implementation
must additionally verify the cross-application example above in the real editor.

Run focused checks during implementation and a fresh bun run check before
completion, including lint, formatting, type checking, tests, build, and smoke
verification.

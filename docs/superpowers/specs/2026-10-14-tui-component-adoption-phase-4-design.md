# Phase 4: Project/Item Navigator Component Adoption

## Status And Intent

Superseded, unapproved historical draft. Do not implement this composition or its
proposed library APIs. The user reopened navigation product design and approved a
different direction: unified work items, Coding directories/worktrees, standard
List browsing, uniform open-and-enter activation, and docked/drawer navigation.
See [Coding Navigator And Unified Work Items](./2026-10-15-coding-navigator-design.md),
whose separate implementation plan was subsequently approved and is now in final
automated verification/review. Human acceptance remains pending. The obsolete
compact/preview proposal below was not implemented.

The remainder records the earlier preservation-first proposal. At that point,
the user had agreed to these now-revisited decisions:

- Mouse preview requires a matching primary-button release rather than the
  existing any-button mouse-down activation; preview stays in navigation.
- Preserve the navigator's bounded keyboard behavior through an explicit opt-out
  from List's built-in keyboard handling.
- Adopt List's row highlighting (visual comparison B), removing the marker column
  rather than adding a row-styling API.

The user's latest handoff accepts Phases 1–3b, styling follow-ups, and the
HorizontalScroller demo. Older pending-verification notes are historical. The
latest supplied full baseline is 680 passing tests plus build/smoke. Compatibility
inspection ran 43 navigator/model/List/ScrollArea tests with zero failures.

Work only in the existing `use-component-lib-in-tui` worktree. Preserve staged and
unstaged work; leave new documentation and implementation unstaged and uncommitted.
No additional worktree, completed-phase redo, or progression into Phases 5/6.

## Compatibility Findings

The current List already separates controlled selection (`value`) from controlled
browsing (`activeValue`), keeps one native endpoint, follows rendered row order,
supports rich content and primary-release activation, and reveals its cursor using
an internal ScrollArea. Its controlled state deliberately waits for acknowledged
props; do not change that library-wide contract to support buffered navigator input.

Remaining mismatches are concrete:

- List wraps and recognizes additional endpoint/paging keys. Navigator is bounded
  and handles only unmodified j/k, Up/Down, h/l, Left/Right, and Enter aliases locally.
- List's activation callback has no source. With built-in keyboard handling off,
  caller-owned Enter can report keyboard intent and List activation can report
  mouse intent without adding a source argument to the library API.
- All List children are inside its ScrollArea. The navigator's regional error must
  remain outside scrolling content but inside the same bordered endpoint.
- List registers its own hints, including `Enter: Open`; Navigator needs its
  existing `Enter: Activate` hint, since project Enter does not open a terminal.
  Two hook registrations on one endpoint would compete across rerenders.
- List's existing row backgrounds override caller bg when selected/cursored.
  Choosing the library appearance avoids extending that styling contract.
- Navigator already holds a synchronous cursor ref. Shell-owned commands such as
  project o currently obtain cursor context from the rendered model; buffered
  browse-then-command sequences need explicit regression coverage and, if needed,
  a narrow synchronous cursor bridge in the shell.

## Proposed Minimal List Refinements

These are proposed API additions for approval with this design, not implemented
changes. Existing callers omit them and retain their current behavior.

1. `keyboardNavigation?: boolean`, default true. Always invoke caller `onKeyDown`
   first. When false, skip all built-in keyboard movement and activation without
   consuming otherwise unhandled keys. Do not disable mouse behavior, focus,
   controlled state, repair requests, scrolling, or reveal.
2. `controlHints?: ControlHintSource`, using the existing local hint type. A supplied
   source replaces List's hints, including an explicitly empty source. Without an
   override, retain today's hints when keyboardNavigation is true and expose no
   built-in keyboard hints when it is false. List remains the sole hint registration
   owner for its endpoint; no changes to the shared hint helper are needed.
3. `footer?: ReactNode`, rendered after the internal ScrollArea and inside the List
   root. It is non-scrolling content, not a registered row or selection candidate.
   The navigator supplies a non-focusable error Text. As with rich rows, footer
   content must not introduce additional focus stops. Omitted footer adds no space
   or wrapper. Caller sizing reserves its error row and permits a zero-height viewport.

No ListItem API, activation-source argument, ScrollArea API, custom imperative
handle, exported context, extra scrolling engine, or compound List framework.

## Navigator Composition And State Ownership

Keep the current title and outer dimensions. Replace the bordered focusable Box
and native scrollbox with a bordered List at `region:navigator`, using the existing
single border style, height constraints, and native Box ref contract. List's
internal ScrollArea is the local scrolling composition; do not nest a second
viewport or depend on its private child positions for application behavior.

Render each projected entry as a one-row, non-focusable ListItem with the existing
React key and `navigator-row:<entry.key>` ID. Use its entry key as the List value.
Keep hierarchy projection, project/item ordering, expansion, and shell snapshot
reconciliation in their existing owners.

Pass activeKey as controlled `value` and cursorKey as controlled `activeValue`,
mapping null to explicitly supplied undefined. Do not supply onValueChange or
onActiveValueChange: application callbacks and reconciliation remain the authority
for both values and repair. This prevents List from choosing another application
cursor during registration, collapse, refocus, or a snapshot arriving before an
opened item. Do not key/remount List merely to synchronize its state.

Retain caller-owned native keyboard handling and synchronous cursor/expansion refs.
Recognized movement stays local even at an edge. Preserve modifier handling,
Enter aliases, and existing repeat behavior; add no Space, Home/End, g/G, Ctrl+n/p,
or paging bindings. Preserve cursor on refocus rather than resetting to selection.
Buffered browsing, Enter, expansion, project o, and contextual creation must use
the latest applicable cursor without waiting for a React commit.

The shell remains the single global-policy owner. Any necessary shell change is
limited to providing current navigator cursor context to its existing command
availability/execution paths; do not rewrite the router, command framework, or
selection model.

### Pointer Sequence

Proposed detail for full design approval: primary press focuses the navigator and
moves its browsing cursor, retaining the existing press-time cursor behavior and
cancelling pending pane entry immediately. It does not activate selection or send
an open command. On a matching release inside the row, use List's onActivate to
activate with mouse intent and synchronize the latest local cursor to that row.

An abandoned gesture may leave the browsing cursor on the pressed row but must not
change active selection or open an item. Use List's existing gesture matching,
child-hit-target tolerance, clipping checks, and cancellation on removal/disablement.
Secondary buttons and hover neither browse nor activate. Do not install another
pointer observer or global input listener. Let List defer reveal during its row
press so the row does not move out from under the release.

Keyboard Enter is handled separately in Navigator and reports keyboard intent.
Project Enter stays in navigation; item Enter and shell-owned project o retain
keyboard-open intent. Mouse activation remains a preview in the navigator.

## Appearance And Scrolling

Approved direction B adopts List's default one-cell horizontal row padding,
focus/selection backgrounds, and semantic foregrounds. Remove `>`/`*` and their
marker column. Normal labels become foreground-colored rather than muted; focused
cursor background takes priority, and an overlapping cursor/selection uses List's
primary foreground. Unfocused selection retains its primary background.

Preserve one-row entries, two-cell hierarchy indentation, compact Unicode project
initials, compact item dots, ANSI-aware visible-width truncation, category title,
single border, IDs, regional error colors, and compact INFO labels. Account for
row padding and scrollbar space without expanding navigator width or consuming
workbench/status rows. The browser comparison is illustrative, not terminal proof.

Reuse List's existing cursor reveal on committed cursor changes and relevant
post-layout geometry changes. Manual wheel scrolling changes only the viewport
and is not undone by ordinary renders. Resizes and content reordering reveal the
candidate using updated geometry; missing targets and zero space remain safe.

Proposed scrolling difference for full approval: refocusing the navigator reveals
its retained cursor, even when manual scrolling had moved it out of view. This
does not reset the cursor, select an item, or request pane focus. Wheel containment
and semantic scrollbar styling follow the existing ScrollArea contract.

## Application Actions And Pane-Focus Handoff

Keep project/item commands, creation eligibility, regional failures, and all
asynchronous handoff policy in shell/commands and shell/shell. Do not move them
into List or Navigator. Only successful keyboard opening may enter a valid pane
after the rendered snapshot reaches the response revision in the initiating epoch.
Restore a remembered pane only if it belongs to the opened item's active tab;
otherwise use its first pane. Empty/undersized workbenches and failures stay local.

Preserve cancellation on further keyboard input, pointer browsing/activation,
native focus changes including buffered leave-and-return, dialogs, active-selection
changes, and epoch changes. A later snapshot must not revive a cancelled handoff.
Test both response-before-snapshot and snapshot-before-response ordering.

Keep Session → Workspace → Category → Navigator drill-down, global/leader priority,
modal ownership, native terminal IDs, keyed ancestry, mounting, registration,
replay, input, and resize untouched. Keep accepted header/status styling, full
workspace labels, outlined numbers 1–10, header Tab traversal, HorizontalScroller
behavior, key formatting, and status-safe overlays unchanged. During disconnect,
retain the last coherent view and local browsing; preserve mutation eligibility
rather than disabling the whole List.

## Scope And Verification Gate

Expected edits reach Navigator and its behavioral tests, List and its tests,
focused shell integration coverage and any regression-proven navigator input
bridge, and Phase 4 documentation. Projection/state/command tests remain regression
oracles; change production owners only where the approved composition requires it.
List exports remain direct from its existing module. No new dependency, config,
fixtures framework, server protocol, shared navigation, or workbench operation.

After full design approval, write a separate implementation plan and obtain its
approval before coding. Then recommend native or subagent-driven execution based
on the actual task boundaries, expected context, and cost.

Use TDD for the API additions and affected integration contracts. Cover bounded
and buffered input, pointer press/release/cancellation, controlled cursor ownership,
refocus, ordering/collapse, expanded/compact styling and Unicode truncation, fixed
errors during long-list scrolling, resize/zero-space behavior, and one focus/hint
owner. Preserve representative success/failure/cancellation, dialog/disconnect,
drill-down, terminal identity, and unchanged terminal-input coverage.

Run affected navigation, List/scrolling, shell, and input tests plus relevant
terminal/PTY acceptance, retaining the test daemon's `/bin/sh` setting. Run a fresh
`bun run check` including build/smoke, obtain independent read-only review, and
address actionable findings with failing regression coverage before re-verifying.
Known listener-limit and React act warnings are outside scope.

Report intentional differences and verification evidence, then pause for human
verification: expanded/compact modes, long-list scrolling, collapse/expand, empty
categories, keyboard opening versus mouse preview, failed commands, cancelled
focus handoffs, and unchanged terminal input. Do not progress beyond Phase 4.

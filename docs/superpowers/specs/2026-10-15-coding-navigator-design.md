# Coding Navigator And Unified Work Items

## Repository-group Follow-up Checkpoint (2026-10-17)

The separately approved [navigation follow-up](./2026-10-17-coding-navigation-followup-design.md)
supersedes this document's independent registered-worktree-root contract and
registration-without-entry TUI behavior. Schema 4 now groups a repository under
its primary checkout regardless of registration order; duplicate registration
resolves the exact requested root/child. API/CLI remain metadata-only; successful
TUI registration/generic creation enters that item's existing or new surface.
Local terminal-source tab switches complete focus, and stopped panes retain output
with live input exclusion and explicit restart. No migration or old-surface merge
is provided. Independent review and regression-tested fixes are complete; human/physical-terminal acceptance of this
follow-up remains pending and exact visual flicker was not reproduced. The schema-3,
775-test and review records below are historical evidence for the predecessor,
not verification of these amendments. Phase 5 live cwd/equalization stays deferred.

## Manual Testing Follow-up Scope (2026-10-17)

The user has manually exercised the TUI extensively and agreed on the following
scope split. This records follow-up direction, not blanket human acceptance of
the current implementation or authorization to start implementation:

- **Next navigation design/planning round:** open and focus the terminal after
  successful TUI registration (#1); reuse/select an existing repository or
  worktree entry instead of creating duplicate repository trees (#2); always
  group a repository's primary checkout above its worktrees, regardless of which
  checkout was registered (#3); preserve appropriate terminal focus when
  switching tabs (#6); and address the functional exited-terminal indication,
  input, and status-flicker behavior (#7). Repository identity and existing
  surface preservation need to be specified before changing the implemented
  independent-root behavior below.
- **Keep unchanged (#4):** Coding does not permit manually created child items
  through `leader+n`. Discovered Git worktrees remain its child entries; plain
  directories/subdirectories can still be registered as separate roots.
- **Implement in component-adoption Phase 5, not this navigation follow-up:**
  source-terminal live-cwd inheritance on split (#5) and automatic pane
  equalization after splitting (#8). Both must already be implemented on reaching
  architectural Stage 3. See the amended
  [Phase 5 scope](./2026-10-13-tui-component-adoption-design.md#phase-5-workbench-presentation)
  and [Stage 3 roadmap](./2026-09-18-tui-overhaul-design.md#stage-3-workbench-operations).
  Richer exited-pane visual treatment can be refined with Phase 5 presentation;
  the functional part of #7 remains in the navigation follow-up.

Only these documentation amendments are authorized in this step. Stop afterward
and wait for the user's instruction before beginning the next specification,
implementation plan, or code changes. The implemented behavior and historical
verification record below remain unchanged by this scope allocation.

## Implementation Progress (2026-10-16)

The implementation plan was separately approved and executed natively in the existing worktree. Implementation, automated verification and independent whole-change review are complete; human acceptance remains pending. Fresh `bun run check`: **775 tests, zero failures, 6119 assertions**, lint/format/typecheck/build and compiled smoke passed. Real CLI/daemon/PTY acceptance and the new external-worktree/filter/drawer/guard PTY test passed; that new PTY test also passed three consecutive runs.

The four Important review findings were reproduced and fixed in one regression-tested pass: live buffered Archive targeting, session/snapshot scope restoration, matching successful-entry error clearing, and source error/flag pruning after archival/removal. Two Minor findings remain deferred: background errors use stable source order rather than active-source preference, and filter hints still advertise `n Create` although native input correctly treats `n` as text. Existing React act/listener, Task 1 cleanup-test and intentional control-regex warnings remain. Linux runtime and real human terminal/visual acceptance were not executed on this macOS host.

Actual ownership: server `application/directories.ts` and `items.ts` inspect/reconcile schema-3 unified items; `app.ts` coalesces probes and schedules five-second passes, closed by daemon lifecycle. TUI `navigation/model.ts` and `path-label.ts` project filtered two-line rows; Navigator composes Input/List with a separate cursor ref and hint override. Shell owns source-associated status, field errors, Archive, per-tab pane memory, cancellable entry, sticky docked/drawer visibility, and the resize guard. Workbench leaves remain keyed and mounted; live input eligibility is separate from resize eligibility. No shared navigation, other category schema, Git mutation, or later adoption phase is included.

## Status And Approval Gates

Design accepted by the user, including the subsequent clarification that Work
Craft failure messages belong in the status bar, field validation stays inline,
and persistent failure indicators remain beside affected items/panes. The separate
approved implementation plan is now implemented and automatically verified;
the human acceptance gate remains open.

This replaces the preservation-first
[Phase 4 draft](./2026-10-14-tui-component-adoption-phase-4-design.md). That draft's
bounded movement, keyboard opt-out, mouse preview, compact rail, and proposed
List footer are not requirements for this design.

The work has grown from component adoption into a Coding navigation vertical
slice with an explicitly approved unified item model. It remains between
architectural Stages 1 and 2 of the
[TUI overhaul](./2026-09-18-tui-overhaul-design.md). It does not implement shared
session navigation, the remaining category experiences, or adoption Phases 5/6.

Delivery gates:

- [x] Inspect existing components, callers, command/focus paths, and daemon model.
- [x] Agree on the initial product, item ownership, and responsive direction.
- [x] Complete independent read-only builder review of this written design.
- [x] Obtain approval of the complete design and error-presentation clarification.
- [x] Write and obtain separate approval of an implementation plan.
- [x] Recommend native or subagent-driven execution after plan approval.
- [x] Implement with TDD, verify, obtain independent review, and pause for human acceptance.

Stay in the existing `use-component-lib-in-tui` worktree. Preserve its index and
all existing staged/unstaged source work. New changes stay unstaged and uncommitted.
Do not create another worktree. The latest supplied complete baseline is 680
passing tests plus build/smoke; existing listener-limit and React act warnings
remain outside scope. Earlier pending-verification notes for Phases 1–3b are
superseded by the user's acceptance, including styling and demo follow-ups.

## Intent And Boundaries

Navigation is a category-aware way to find, organize, and enter work, not a
uniform project-folder tree imposed on every category. A common interaction
language can support different entry meanings without a plugin system or a
speculative navigation framework.

Coding is the first concrete experience. A Project represents an existing local
directory, optionally a Git checkout. Its worktrees are children representing
their own directories. Opening either enters its persistent terminal environment.
Expanding a Project is independent of opening it.

The other five categories remain visible and selectable. Their meeting, note,
document, task, collaboration, and dashboard schemas are future work. Preserve
the existing generic work-item/terminal escape hatch using the new item model;
do not build those category experiences or force them into Coding directory types.

Retain Bun, React/OpenTUI, the local component library, the capability organization,
and the single local daemon. The daemon owns durable items, metadata, surfaces,
PTYs, and history. The TUI owns presentation and local input/focus; the CLI remains
non-interactive with plain-text/JSON output.

## Confirmed Product Decisions

- A Coding Project opens a terminal initially cwd-ed to its registered directory.
- A worktree opens a terminal initially cwd-ed to that worktree's directory.
- Existing worktrees created outside Work Craft appear automatically under an
  already registered Project. Worktree creation/deletion inside Work Craft is not v1.
- Both levels have icons and two-line expanded rows: basename plus actual branch,
  then a quieter, intelligently abbreviated path. Plain directories omit branch.
- Filtering uses substring matching over basename, branch, and full path; no fuzzy matching.
- A matching worktree retains its parent for context, even if the parent does not match.
- Keyboard and primary-button mouse-release activation both enter the terminal;
  there is no separate mouse-preview behavior.
- Reopening returns to the existing surface and remembered terminal. If its active
  tab contains splits, restore that tab's last-focused valid terminal.
- Use List's existing browsing keys and wrapping. h/Left collapses, l/Right expands,
  Space toggles expansion, and Enter opens the candidate.
- Filter and results are two native focus stops, traversed by Tab/Shift+Tab. Rows
  are not individual Tab stops. Ctrl+n in the filter enters the first actual match,
  not a nonmatching contextual parent; with no matches it stays in the filter.
- Removed/unavailable worktrees remain as marked, selectable remembered entries.
  Their running terminals and history are not automatically destroyed or retargeted.
- Manual Archive is sufficient for v1; permanent deletion is deferred.
- Project and Item are no longer separate durable entity types. All entries are
  work items, optionally with a parent, and either level may own its surface.
- Existing saved application state is discardable; no legacy-state compatibility
  layer is required. This does not permit discarding staged/unstaged source work.
- Remove compact navigation. Use a docked sidebar at 120+ columns, a manually
  opened drawer at 80–119, and a blocking resize presentation below 80 columns.
- Report Work Craft operational failures centrally in the status bar, retain
  field-specific validation inline, and keep compact persistent failure indicators
  on affected rows/panes. Source ownership does not dictate message placement.

## Unified Item Model

Approved concrete shape:

```ts
type WorkItem = {
  id: string;
  workspaceId: string;
  category: CategoryKind;
  parentId: string | null;
  kind: "directory" | "worktree" | "generic";
  title: string;
  position: number;
  archived: boolean;
  data: DirectoryData | WorktreeData | Record<string, unknown>;
};
```

The implementation should express kind/data as a discriminated TypeScript union,
not permit arbitrary combinations. Use the existing small envelope plus validated
JSON payload approach rather than introduce separate repositories, adapters,
providers, or tables for hypothetical category types.

Outside Coding, generic roots may contain generic children, with the same one-level
limit. They are openable work items, not artificial Project entities. Their initial
presentation is a title/icon row without fabricated branch/path metadata. This
retains the existing generic placeholder capability, not a new category schema.

For Coding, root items have kind directory and child items have kind worktree.
Their data contains a normalized absolute path, last-known branch, and availability
with an optional failure reason. Directory data also identifies whether it is a
Git checkout and its Git common directory for discovery. Generic items preserve
the current non-Coding placeholder capabilities without a new business schema.

Enforce at most one child level. Parent and child must share workspace/category;
parents must be roots, and a worktree's parent must be a Coding directory item.
Reject cycles, invalid kinds/payloads, and externally fabricated discovered
worktrees at the command boundary. IDs are durable; branch changes do not replace
an item or its surface. Directory/worktree titles are derived from their basename,
not a separate user-supplied display-name feature.

Surfaces continue to reference one unique item ID. Root directories now own their
surfaces directly: remove the synthetic project-terminal child and ensureHere
indirection. There is no polymorphic project-or-item surface owner. Sessions,
workspace membership, categories, tabs, pane IDs, and runtime/history ownership
otherwise keep their present responsibilities.

### Development State And Protocol

The old separate projects schema and related commands/snapshot collection may be
replaced; no migration of old Projects or terminal associations is required.
Update the connected server, CLI, TUI, fixtures, and tests together rather than
retain compatibility aliases or a second presentation path.

The implementation plan must identify the exact development database reset target
and safe daemon shutdown/reset procedure before any destructive action. Replacing
the initial development schema is permitted. Do not add a normal-startup behavior
that silently deletes an incompatible database, and never delete project files or
Git repositories. Mixed old-daemon/new-client operation is not a supported target;
the development daemon must be restarted coherently for this protocol change.

## Registering And Discovering Working Directories

V1 registration is a single existing-directory path field, using the
current Dialog/Field/Input/Button composition. Derive the title from the basename.
Validate/normalize paths in the daemon, including home expansion and directory
access; do not trust a TUI-only check. Preserve form input and local focus on failure.
Do not add directory browsing, cloning, Git initialization, branch switching, or
worktree creation/deletion.

Registration identity is workspace/category plus canonical absolute directory path.
Repeating registration reuses the existing unarchived root and surface rather than
duplicates them; it does not implicitly open a terminal. An archived registration
requires explicit Restore, not automatic unarchival or a replacement item. TUI/CLI
resolve client-relative paths before sending; the daemon validates and canonicalizes
the final path rather than interpreting it relative to its unrelated cwd.

**Superseded by the 2026-10-17 follow-up; historical contract:**
An explicitly registered worktree directory may also be an independent root Project.
Its root item and any discovered child representing that path are separate entries
with independently owned surfaces. Do not automatically promote, reparent, merge,
or retarget an existing child and its terminals. This follows item-owned, not globally
path-owned, surface identity.

Use Git's own worktree registry, not folder nesting, to discover relationships.
Worktrees can live outside the Project directory. Read-only Git calls use argument
arrays, bounded execution, and NUL-delimited porcelain output so spaces and unusual
paths are data rather than shell syntax. Exclude the registered checkout itself
from its children. Never assume or force main to be checked out.

Refresh policy: discover immediately on registration, then refresh
registered, unarchived Coding directories every five seconds in the daemon. Use
one non-overlapping refresh pass with bounded subprocess lifetimes and proper
shutdown cleanup, not per-client directory watchers or a job framework. Plain
directories need no worktree entries; a nested directory is not silently promoted
to a different Git-root working directory.

Reconcile changed metadata in the daemon's ordinary transactional/revisioned update
path. Only real changes advance revision/broadcast snapshots. A successful scan
adds new worktree items and updates branch/availability while preserving known IDs.
A removed checkout becomes unavailable; do not delete its item, panes, or history.
A failed scan is not evidence that all children disappeared: retain last-known
membership/metadata, mark the affected source, and report its failure in the
status bar under the error-presentation policy below.

V1 identifies a discovered worktree by its parent plus normalized path, not branch.
A moved worktree can therefore become an unavailable old entry plus a newly
discovered entry. Reappearance at an unarchived remembered path reuses its item
and surface; never inject cd or otherwise modify existing terminals. Automatic
refresh must not resurrect explicitly archived entries.

The exact SQL layout, Git helper placement, and parsing helpers are builder choices
within these contracts. Do not generalize discovery into a category/plugin API.

## Navigation Presentation And Filtering

Compose one Input and List/ListItem with existing Stack/HStack, Text, and Icon.
List's internal ScrollArea owns local scrolling; do not add a nested viewport,
duplicate paging engine, second keyboard listener, or per-row native focus.
Keep `region:navigator` as the results endpoint and give the filter its own ID.
Rows use stable unified item IDs; old project-prefixed row IDs are intentionally
replaced as part of the entity-model change.

Rows are two terminal cells tall in normal/drawer presentation. Indent children,
use directory/repository/worktree icons from the local library, and mark unavailable
items with an unavailable/deleted-style icon and subdued treatment. They remain
eligible candidates because existing surfaces and Archive are still usable.
Use primary-colored basename/branch text and quieter path text, with contrast-safe
variants on List's focus/selection backgrounds. Remove old cursor/selection markers.
Show detached Git state explicitly rather than displaying an empty branch suffix.

For path display, replace the home prefix with ~, preserve the final directory
component when possible, and shorten intermediate components before falling back
to cell-aware ellipsis. Respect Unicode width and keep each display line bounded;
escape control characters rather than allowing filenames to create extra lines.
Matching uses full underlying values, not the shortened display. Exact component
shortening order and contrast-safe token choices are builder calls for terminal
verification, not a new path-formatting configuration surface.

Filtering details:

- Case-insensitive substring matching across basename, branch, and full path,
  including the user-facing home-relative path form. No regex/fuzzy syntax.
- Filter the full unarchived catalog, not only currently expanded rows.
- Show actual matches plus necessary root ancestors. Do not show unmatched siblings
  merely because their parent matches.
- Matching children are temporarily revealed independently of saved expansion.
  While the query is nonempty, expansion controls are unavailable; clearing it
  restores normal expansion. This avoids collapsing away a result the filter found.
- Filtering, expansion, and cursor repair never change the active workbench item.
  An active item may remain active even when its row is filtered or collapsed away.
- Keep query/cursor/expansion client-local and preserve them when hiding navigation.
  Queries/expansion are kept per workspace/category; do not leak one category's
  filter into another. No persistence or mirrored filtering in this slice.

Do not add a regional error-message row beside the results. Operational failure
text belongs in the status bar; unavailable/discovery-failed rows retain compact
state indicators. Use a compact EmptyState/Text composition for empty/no-match
results. Do not extend List with a footer to preserve the old border arrangement.

## Keyboard And Pointer Interaction

List retains its existing j/k, Up/Down, Ctrl+n/p, g/G, Home/End, Ctrl+u/d,
Ctrl+b/f, and PageUp/PageDown behavior. Single-step movement wraps; paging clamps
and measures viewport cells, including two-line rows. Preserve the library's
modifier and repeated-Enter safeguards. No keyboardNavigation opt-out is needed.

Caller-owned h/Left collapses a project, l/Right expands it, and Space toggles it.
These do nothing on leaves or roots without visible unarchived children, and are
not available while filtering. Mouse disclosure interaction only expands/collapses;
clicking the row body opens it. Disclosure clicks must not fall through to row
activation or add another focus stop. Retain List's primary-release gesture
matching, clipping checks, and stale/cancelled-gesture safeguards.

Within navigation, Tab/Shift+Tab cycles the filter and results endpoints. Preserve
a valid results cursor on ordinary Tab entry; when repair is needed, prefer an
actual match over a contextual ancestor. Ctrl+n from the filter explicitly chooses
the first actual match and focuses results without activating it. With no match,
keep filter focus. Enter in the filter does not implicitly open an item. No new
slash shortcut or additional filter/list focus chords are required in v1.

Use native Input editing behavior. Printable n/o/a, Space, and browsing letters
must remain text when the filter is focused; Ctrl+u/d there must not page the list.
Application routing must recognize the actual focused control, not apply all
navigator-region plain commands to its editing descendant. Global/leader routing
still has its existing priority. Header Tab and terminal Tab/Shift+Tab remain unchanged.

Contextual actions: n on Coding results adds a directory; a on an
unavailable Coding candidate requests Archive. Generic non-Coding creation uses
the unified generic item model, not worktree creation: n on non-Coding results adds
a generic root using a title form. The existing leader+n action adds a generic
child beneath the candidate's root, or the active item's root when invoked from
its workbench. Without an eligible generic root it is unavailable. Do not expose
leader+n as a way to fabricate Coding worktrees. Generic surface opening retains
the current optional cwd/default-shell escape hatch.

Replace Coding's former project-only o behavior with uniform Enter/mouse activation.
Keep action hints by their owning behavior; omit routine movement hints and never
install competing hint registrations on the same endpoint.

### Approved Minimal List Additions

List already supports rich rows, independent selection/cursor, dynamic ordering,
scroll reveal, and native Box refs. Its controlled cursor intentionally waits for
updated props; changing that globally would break its tested ownership contract.
It does not currently expose a way for a sibling filter to synchronously choose a
specific uncontrolled cursor before transferring native focus.

Add an optional, separate cursor ref while preserving the existing native
Box ref. Its only operation is `focusValue(value: string): boolean`: validate a
mounted eligible row, request/update the browsing cursor through the existing
controlled/uncontrolled rules, and focus List only if that value is now current.
Return true only when the requested value is current and native focus reached
List. Invalid, disabled, hidden, unregistered, or unacknowledged controlled requests
must not move focus. Do not select/activate, reset selection, or synthesize keys.

The navigator uses List-owned uncontrolled browsing plus synchronous change
notifications for application expansion/actions. A pending filter handoff must be
revalidated against the latest query, rendered rows, native origin, and scope;
buffered input must never activate an old/unfiltered candidate. Cancel stale
requests after editing, context changes, dialogs, hiding, or resize-guard entry.

Also add an optional `controlHints: ControlHintSource` override, defaulting to
today's List hints. This lets the caller supply Enter/Open and eligible Space/
expansion hints without a second registration or advertising unavailable actions.
An explicitly empty source suppresses hints. No ListItem API changes, exported
List internals, custom scrolling handle, header/footer slots, or compound framework.

These additive APIs are implemented and verified; the native Box ref and existing
controlled/uncontrolled List behavior are preserved.

## Opening Surfaces And Remembering Terminals

Opening root or child uses the same application-owned surface.ensure path. Reuse
the existing surface; first opening creates its initial tab and shell at the
directory/worktree's registered path. Never send cd to an existing shell or
implicitly restart it. Unavailable items may reopen an existing surface, but may
not create a new terminal at an unavailable target. A shell whose cwd vanished
may report errors only on later commands; Work Craft shows availability rather
than injects synthetic shell input/output.

New Coding tabs use the owning target's registered path rather than daemon cwd.
Keep existing split inheritance and restart operations; do not add live shell-cwd
tracking or unrelated workbench operations. Spawn validation/race failures remain
visible without destroying records or unrelated runtimes.

Keep per-tab last-focused-pane memory so opening each target restores its active
tab's last valid terminal, otherwise its first valid terminal. This memory is
client-local for this slice; durable/mirrored active-pane selection remains Stage 2.
Do not use one global remembered pane for all working environments.

Only hand input to a valid terminal after command success and a rendered snapshot
at or beyond the response revision in the initiating epoch. Failed/exited panes,
empty tabs, and undersized layouts do not receive automatic input focus. Further
input/browsing/activation, native focus changes including buffered leave-and-return,
dialogs, hiding, resize-guard entry, context/epoch changes, or target archival
cancel a pending handoff. It must never revive on a later snapshot.

Successful terminal entry requires both a successful command and a usable rendered
terminal; an ok surface response alone is not sufficient. If a pane is still
starting, retain the cancellable pending handoff until it runs or fails. If no
terminal can be entered because panes failed/exited, the tab is empty, or the
layout is undersized, clear the request and report a source-labelled status error without
closing the drawer or automatically selecting another tab. The selected item's
surface may still be displayed underneath for manual inspection/restart. Later
updates must not revive a failed/cancelled request; existing explicit restart and
tab operations remain available rather than silently restarting processes.

When a drawer is open, completed terminal entry closes it and enters the terminal;
failure leaves it open and reports in the visible status bar. Closing the drawer must not invoke
ordinary focus restoration after the successful terminal handoff. Guard against
stale focus-restoration microtasks rather than add delays or input replay machinery.

## Archive

Archive is explicit metadata mutation, not Git deletion or process shutdown.
UI behavior is an Archive confirmation for the selected unavailable
Coding candidate, identifying its basename/path and noting that terminals keep
running. Revalidate eligibility and target ID at confirmation; failure reports in
the status bar while preserving the dialog's input and valid focus.

Archive hides that entry; archiving a root hides its descendants without deleting
or rewriting their records. Preserve all surfaces, processes, and history. Cursor
repair chooses an eligible neighbor without activating it; archiving alone need
not replace the currently displayed surface. Automatic discovery cannot unarchive.

The archival boolean is reversible through the same
semantic API and plain-text/JSON CLI, but an archive browser is not v1. Restore is
explicit, never a side effect of a scan. Permanent deletion and Git lifecycle
operations remain out of scope.

## Responsive Navigation And Resize Guard

Confirmed thresholds are initial values to verify on real terminals:

| Terminal width   | Presentation                                   |
| ---------------- | ---------------------------------------------- |
| Below 80 columns | Blocking resize presentation                   |
| 80–119 columns   | Hidden navigation, manually opened as a drawer |
| 120+ columns     | Docked sidebar when open                       |

Keep one visibility preference and derive docked/drawer geometry from width;
remove compact mode rather than layer a second responsive state system on it.
Auto-hide on crossing from wide to narrow, not on every resize already inside
the narrow band. Hidden navigation stays hidden when resized, including widening.
An explicitly open drawer becomes docked on widening. Entering the resize guard
hides navigation; leaving it does not automatically reopen it.

Drawer geometry is an edge-to-edge overlay of the available main content body,
leaving the header, category rail, and one-row status bar visible. It does not
consume additional workbench width. The covered workbench remains mounted and
cannot receive keyboard/mouse input or spatial focus. Header/category controls may
still perform their explicit navigation actions; do not treat the drawer as an
unrelated application modal that blocks its own navigation commands.

Use the same navigator subtree in docked/drawer presentation and the same keyed
workbench/terminal ancestry underneath it. Reuse local layout/focus helpers; no
animation, generic Drawer library component, or Dialog API extension is required.
Creation/confirmation/session Dialogs retain their existing higher modal ownership
and suspend background navigation normally.

Escape or the existing navigator toggle closes the drawer and restores a valid
prior shell target. Successful activation instead focuses the destination pane.
Category activation remains an explicit user request to reveal/enter navigation,
including empty results, preserving Session → Workspace → Category → Navigator
drill-down. Resize/data refresh alone never counts as a reveal request.

Below 80 columns, cover the working UI with a clipped, noninteractive message:

```text
Please resize your terminal
Work Craft requires at least 80 columns. Current width: 64.
```

Reserve the existing bottom status row uncovered and undimmed. Keep terminals and
dialog state mounted, block ordinary keyboard/mouse interaction, clear pending
leader/handoff intent, and retain quit/reconnect. Restore a valid prior scope when
width becomes usable, without replaying blocked input or reopening navigation.
At extremely small sizes, clip safely; do not expose covered controls because a
message cannot fit. Existing height/pane undersizing protections still apply;
this design does not add a second global height threshold.

These are intentional replacements for the old compact/no-navigation-overlay
contract. The normal category rail remains invariant except when covered by the
explicit below-minimum resize presentation. The status-safe overlay rule remains.

## API, Ownership, And Change Reach

The snapshot has one items collection with parent IDs, not separate projects
and child items. Keep item-owned surfaces and existing terminal stream semantics.
Semantic operations are registering a Coding directory, creating a
generic non-Coding item, setting archival state, and ensuring an item's surface.
Registration/discovery own directory/worktree metadata; generic create must not
bypass their validation. Retire project.create, project-specific ensureHere, and
the old surface item kind rather than keep aliases for disposable development data.

Provide equivalent resource-oriented CLI commands for registration, generic item
creation, archive/restore, and surface opening. Exact spelling and SQL columns are
builder choices; semantics and validation are not. Keep existing session/workspace,
tab/split/restart, daemon, output, and JSON behaviors unless the unified item shape
requires connected adjustments.

Expected reach includes server protocol/schema/snapshot/commands, a small daemon
Git-discovery owner and lifecycle cleanup, CLI parsing/formatting, TUI projection,
shell state/model/actions/focus/routing/layout, Navigator, List, their fixtures and
tests, and the relevant architecture/adoption documentation. Do not move application
ownership into ui, introduce category adapters, or reorganize unrelated modules.

Preserve accepted header/status styling, complete workspace labels, outlined
numbers 1–10, header Tab behavior, HorizontalScroller behavior and demos, key
formatting, dialog status margins, and terminal identity/replay/input contracts.
During disconnect retain the last coherent catalog/view, local filtering/browsing,
and existing mutation eligibility. Do not disable the whole List while disconnected.

## Error Ownership And Presentation

This policy applies across the TUI, not just Coding. Earlier references to local
or regional errors meant both source ownership and physical placement; those are
now separate. Keep the originating operation, item/pane, and relevant epoch/context
for attribution and stale-result protection, but display Work Craft operational
failure messages centrally in the existing status bar's ERROR mode.

| Kind                                                       | Message location             | Persistent local treatment                               |
| ---------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| Field validation, detected by client or server             | Beside its field             | Retain input and eligible focus                          |
| Command/API, filesystem, discovery, or integration failure | Source-labelled status error | Affected item/source indicator when the problem persists |
| Work Craft terminal spawn/restart/recovery failure         | Source-labelled status error | Failed/interrupted state indicator in the affected pane  |
| Output/errors produced by a shell or child application     | Its terminal, unchanged      | Work Craft does not parse/reclassify stderr              |
| CLI failure or fatal failure before a usable TUI exists    | CLI/stderr reporting         | No dependency on a status bar being available            |

For example: `foo — Git discovery failed: permission denied`. Do not duplicate
the full failure message in a navigator footer, workbench banner, or generic form
FieldError. Persistent unavailable/failed indicators remain so replacing a status
message does not make a broken target appear healthy. An unavailable state is not
itself a new error on every scan. A resize warning or no-match state also keeps
its designated presentation rather than becoming a stream of error notifications.

Preserve valid focus, entered text, live processes, and the last coherent view.
Reporting an error never opens a dialog, enters a pane, restores an obsolete
target, or replaces the whole shell. Repeated identical discovery failures must
not reannounce every five seconds. Status reporting is source-associated, not an
error bus or a notification-history feature; error history is outside v1.

The implementation plan must explicitly specify status-message lifetime,
replacement/clearing, and priority with HINTS/LEADER and existing invalid-leader
feedback. Do not silently apply the invalid-leader one-second timeout to all
operational errors or consume a terminal application's Escape to dismiss them.
These implementation details remain subject to plan approval.

## Verification And Human Gate

The implementation plan must retain equal or stronger behavioral coverage while
updating obsolete project/item, compact-mode, and preview expectations. Do not
retain incorrect tests merely for their count or remove safety tests to fit a component.

Use TDD at the concrete boundaries:

- Unified item validation, direct root/child surface ownership, idempotent opening,
  correct initial/new-tab cwd, archival retention/restore, and database reset handling.
- Real temporary Git repositories/worktrees: external creation/removal, branch and
  detached metadata, out-of-tree paths, path edge cases, scan failure, reappearance,
  archive suppression, unchanged-scan revisions, overlap/timeouts, and cleanup.
- Two-line row styling/width, path abbreviation, substring filtering and ancestry,
  query clearing, local cursor versus active selection, and unavailable-item access.
- Default List browsing/paging with two-line rows, caller expansion, gesture
  cancellation, hints, cursor ref controlled/uncontrolled ownership, and buffered
  filter → Ctrl+n/Tab → results input that cannot activate a stale candidate.
- Actual-focus routing: filter text/editing, global/leader priority, Tab scopes,
  modal replacement/restoration, per-tab pane memory, success/failure/cancellation,
  both response/snapshot orderings, and no focus restoration behind a drawer/guard.
- Central status reporting across navigation, workbench, dialogs, and discovery;
  inline client/server field validation; persistent source indicators; source/stale
  attribution, repeated-error deduplication, and unchanged child stderr/input.
- Width boundary transitions at 79/80 and 119/120, sticky hidden state, drawer
  coverage/input blocking, tiny/zero geometry, status safety, and terminal identity
  and resize/input behavior through drawer/guard transitions.

Run affected server/CLI/navigation/List/shell/input tests, relevant real terminal/
PTY acceptance (retaining the test daemon's /bin/sh setting), and a fresh
`bun run check` including build/smoke. Obtain independent read-only implementation
review, address actionable findings with regression coverage, and reverify.

Report intentional behavior/visual/API changes and evidence, then pause for human
verification of real directories/worktrees, filtering, expansion, terminal reuse/
focus, unavailable entries/archive, failure/cancellation, drawer/resize behavior,
and unchanged terminal input. Do not proceed to shared navigation or another
adoption phase without acceptance.

## Consolidated Design Details

The following author-proposed details were accepted with the written design,
rather than individually fixed during the earlier product discussion:

- Five-second daemon refresh, path-based discovery identity, and strict filtered
  hierarchy with expansion unavailable while a query is active.
- Single-path registration, Archive confirmation and API/CLI reversibility, while
  retaining only generic placeholders for the other categories.
- Historical (independent-root portion superseded by the follow-up): idempotent root registration, explicit restoration of archived roots, and treating
  an explicitly registered worktree root as an independent entry rather than merging
  its terminals with an existing child. Generic n/leader+n creation remains as
  specified above; no additional non-Coding business types are introduced.
- Client-local per-tab pane memory until Stage 2, rather than cross-client/restart
  persistence of selected pane.
- Body-only drawer with header/category/status retained, Escape dismissal, and
  existing category activation counting as an explicit reveal request.
- The narrow List cursor-ref and hint-override APIs described above.

The error-presentation clarification above supersedes this document's earlier
regional message-placement wording. No implementation plan or code is approved
by the existence of this document.

## Builder Review

Independent read-only review identified three missing planning contracts: generic
root/child creation, registration identity/archival behavior, and successful
commands with no usable terminal. The author resolved them explicitly above using
the existing generic escape hatch, idempotent item-owned registration, and the
agreed rule that failed entry keeps navigation open. They are recorded in the
accepted design; implementation still requires its own approved plan.

Follow-up read-only review found no important planning questions remaining.
Runtime behavior and implementation have not been reviewed or verified.

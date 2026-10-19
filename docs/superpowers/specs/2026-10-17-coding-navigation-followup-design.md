# Coding Navigation Follow-up: Repository Groups And Terminal Entry

## Status And Approval Gates

Approved by the user on 2026-10-17 following manual testing of the
[Coding Navigator implementation](./2026-10-15-coding-navigator-design.md).
The user approved the scope below and clarified that existing Work Craft TUI
state/database records are disposable, and duplicate TUI registration must enter
the existing terminal. The complete design, including its builder proposals,
is approved. The new [implementation plan](../plans/2026-10-17-coding-navigation-followup-implementation-plan.md)
was separately approved on 2026-10-17. The user delegated method selection;
execution uses subagent-driven development by controller choice.

- [x] Confirm follow-up scope and disposable development-state requirement.
- [x] Confirm duplicate registration enters the existing terminal.
- [x] Complete independent read-only builder check of this design.
- [x] Obtain approval of the complete design.
- [x] Write and obtain approval of the implementation plan.
- [x] Implement with TDD, verify/review, and pause for human acceptance.
- [ ] Complete human/physical-terminal acceptance.

### Delivery Checkpoint (2026-10-17)

Tasks 1–7 have delivered grouping/schema-4/result contracts, trusted fallback
discovery, creation/duplicate entry, local terminal-source tab focus, stopped
labels/live input gates and explicit restart, with owner-specific RED→GREEN
including real daemon/CLI and normal-entrypoint PTYs. Task 7 audits those connected
tests and extends compiled duplicate metadata-only/rootItemId smoke and docs;
fresh command evidence is retained in the task/final-fix reports. Independent
connected review found five Important edge cases; regression-tested fixes and
scoped re-reviews resolved them, including stopped-pane selection on both split
axes, live archive gating, usable sibling entry, contained discovery conflicts
and linked separated-Git rejection. The latest full check passes 1,016 tests,
typecheck, build and compiled smoke on macOS; inherited lint/React/listener
warnings remain. Human acceptance is still pending. Exact reported visual flicker was not reproduced;
existing status deduplication was already correct. No speculative timeout, hints
or scroller change is claimed. Physical-terminal acceptance remains pending.

Keep the existing worktree, staged/unstaged source work, Bun, React/OpenTUI,
capability boundaries and local single-daemon architecture. No source commits,
staging, new worktree, application reset or daemon shutdown during design.

## Intent And Scope

Finish the workflow from finding or registering work to using its terminal.
Repository navigation should reflect one repository and its checkouts, not the
order in which checkout paths were registered. Tab switching should not strand
someone typing in a terminal. A stopped process must not look ready for input.

Included manual findings:

1. Successful TUI directory registration opens/enters its terminal.
2. Re-registering a repository or one of its checkouts reuses the existing entry
   and enters that requested checkout's existing terminal.
3. The primary repository checkout is always the parent; linked worktrees are
   its children, even when the first registered path is a linked worktree.
4. Local tab switching from a terminal restores terminal focus appropriately.
5. Functional stopped-terminal indication, input exclusion and status stability.

Finding #4 stays unchanged: no manually created Coding children or `leader+n`
escape hatch. Plain directories/subdirectories can be registered as roots.
Live source-terminal cwd inheritance (#5) and automatic pane equalization (#8)
remain scheduled for
[component-adoption Phase 5](./2026-10-13-tui-component-adoption-design.md#phase-5-workbench-presentation),
not this follow-up. Full-pane dimming and other workbench visual polish can also
be refined there. Shared navigation, additional category schemas, Git mutation,
permanent deletion, new workbench operations and unrelated component adoption
remain excluded. Existing deferred minor findings are not silently added here.

## Confirmed Decisions And Builder Proposals

The user confirmed the included findings, no manual Coding children, disposable
Work Craft state and duplicate entry into the existing terminal. Details marked
as builder proposals below are concrete recommendations to approve with this
document, not prior user decisions. Implementation mechanics are left to the
subsequent plan within the observable contracts.

## One Repository Group Per Workspace

### Identity And Hierarchy

- Repository grouping is scoped to a workspace's Coding category, not global
  across workspaces or sessions. Sessions sharing one workspace see its same
  durable group; independent workspaces may register the same repository.
- **Builder proposal:** identify a repository by its canonical Git common
  directory, using bounded read-only Git inspection. Do not infer repository
  identity from a branch name, basename, folder nesting or `.git` text alone.
- **Builder proposal:** "repository root" means Git's primary non-bare checkout,
  not the checkout currently using `main`/`master`. Its actual branch may be any
  branch or detached. Inspect the registry's primary checkout before excluding
  the originally requested checkout from the child list.
- Reuse the unified one-level item model: one directory parent representing the
  primary checkout, and worktree children representing the linked checkouts.
  Each item owns its own surface. No new repository entity, category framework,
  synthetic terminal child or nested worktree hierarchy is needed.
- Registering a linked checkout creates/reuses the primary parent and discovered
  children, then resolves the requested path to that linked child's item ID.
  It never creates an independent directory root for the linked checkout.
- Registering the primary checkout resolves to the parent's item ID. Registering
  any other known linked checkout resolves to that child. Branch changes do not
  change identity. Canonical symlink/relative/home aliases resolve consistently.
- A nested directory without its own checkout marker remains the exact plain
  directory registered; do not promote arbitrary subdirectories to a Git root.
- **Builder proposal:** bare repositories remain plain directory targets in this
  slice. A linked worktree backed only by a bare repository has no primary
  non-bare checkout: reject its registration with an explicit unsupported-layout
  operational error and create no items. Do not invent a parent, promote the
  linked worktree, or silently flatten it into a plain root. Supporting that
  repository layout is outside this follow-up.
- **Execution limit:** a Git `--separate-git-dir` primary absent from Git's
  worktree registry is rejected operationally rather than inferred from the
  metadata directory's parent. Ordinary canonical path aliases remain supported.

### Registration And Discovery

Registration must validate and inspect before its short transaction, then
revalidate workspace/group/path/archive identity at commit. Concurrent root and
linked-path registrations must produce one group and one item per checkout,
not duplicate trees or surfaces. The result identifies the exact requested item
and enough group information for the caller to distinguish parent from child;
CLI text/JSON, public client types, snapshots and tests change coherently.

Repeated registration is a successful reuse, not an error and not a new record.
It must resolve correctly even if the checkout was already discovered rather
than explicitly registered. A newly discovered checkout can be resolved by the
immediate registration scan; do not require a five-second refresh first.

Explicit archival stays explicit. An archived group or requested checkout must
not be duplicated or restored by registration/discovery; report that Restore is
required. Archiving the parent masks descendants without rewriting their own
archive flags or stopping their terminals.

Keep immediate discovery and the single non-overlapping five-second daemon
refresh, probe sharing, bounded subprocess cleanup, no-op revisions and
transaction-time archive/shutdown protection. Discovery owns metadata but never
selection or input focus.

**Builder proposal for unavailable primary checkouts:** retain the primary
parent marked unavailable; do not promote a linked child. A working linked
checkout can supply a valid registry scan for its group when the primary cannot
be inspected. If no trusted scan succeeds, retain last-known membership/branches
and report the affected discovery failure once. Do not interpret failure as an
empty registry. New registration must not guess a group or silently create a
plain duplicate if a recognized checkout's repository inspection fails.

Remembered checkout paths still preserve IDs, surfaces, processes and history
through ordinary removal/reappearance. A moved linked checkout may remain an
unavailable old child plus a new child at its new path. Do not inject `cd`, restart,
merge surfaces, or silently reparent existing runtime owners when repository
metadata changes. A changed canonical common-directory identity or inconsistent
group/registry relationship is an operational failure requiring explicit
resolution rather than an automatic merge.

**Builder proposal on identity limits:** identity is path-based, not a repository
incarnation fingerprint. Re-initializing or replacing a repository at the same
checkout/common-directory paths is not detected as a new repository in this
slice. Do not add Git-config UUIDs, object-history fingerprints or filesystem
watchers to detect it. Existing terminals are never programmatically retargeted
or restarted; external filesystem changes may still affect what their shells
see. This is not a promise to isolate shells from user-driven Git/file changes.

## Registration Enters Work In The TUI

For new and duplicate TUI registration:

1. Validate the live form value and submit once using the existing dialog.
2. Resolve the exact requested item through server registration.
3. Close the form only after registration succeeds. Select that returned item,
   whether parent or child; do not assume every registration returns a root.
4. Ensure/reuse that item's surface and enter its active tab's usable terminal
   through the shell-owned guarded terminal-entry flow.

The same local flow can support generic item creation where the existing TUI
creates a terminal-owning work item; session/workspace creation keeps its current
drill-down semantics. **Builder proposal:** apply auto-entry to directory and
generic item creation, but not to creating sessions/workspaces.

API/CLI registration and item creation remain metadata operations; neither
implicitly creates a surface, chooses a tab, nor focuses any client. Surface
opening remains an explicit semantic operation after registration in the TUI.
Duplicate TUI registration reuses the exact item's surface/history and active
tab; it must not choose the parent terminal when the requested path is a child.

Preserve inline field validation versus operational status, entered input and
valid native focus on registration failure. A successful registration followed
by failed terminal entry keeps the registered item and reports entry failure;
do not roll back registration, fabricate a new record or reopen the form with
an ambiguous "registration failed" message. A drawer stays open until entry
actually succeeds. Existing explicit-restart and unavailable-surface rules hold.

**Builder proposal:** preserve the current filter query. Active surface lookup
must remain independent of visible rows. Expand the parent when appropriate for
an unfiltered child, without activation of a different item or clearing queries.

Entry requires command success, matching epoch/context, rendered response
revision, registered native terminal, running process and usable geometry.
It remains cancellable before/after each asynchronous step. Further input,
newer registration/open, form cancellation/replacement, context or native focus
changes, hide/guard entry, archival and epoch replacement invalidate obsolete
handoffs. Closing a successful form is part of this one operation: do not let
its ordinary restoration microtask cancel or steal the intended entry.

## Local Tab Switching Preserves The User's Activity

**Builder proposal:** tab switching distinguishes the native source of the
action rather than unconditionally focusing a terminal:

- Hyper+`[`/`]` from a workbench terminal selects the adjacent tab and enters
  that destination tab's remembered valid running pane, otherwise its first
  valid running pane. Memory is per tab, never another tab's remembered pane.
- The tab's active layout after the qualifying snapshot is authoritative; do not
  assume the select-tab response includes a pane ID. Reuse existing terminals.
- Explicit tab browsing/activation while native focus is on the tab strip keeps
  tab-strip focus. Switching from another shell control preserves its scope.
  Background/other-client snapshots do not create local entry intent.
- At a boundary where no adjacent tab exists, do not drop current terminal focus.
- Starting panes may retain the same cancellable readiness request. An empty,
  failed/exited-only, missing or undersized destination does not receive terminal
  input or switch automatically to a different tab. Keep a valid tab-strip focus
  and selected-pane restart target; report a labelled entry failure as needed.
- Rapid/reversed requests, navigation away, dialogs and coverage cancel older
  completions. Preserve existing source ordering, per-tab memory, response-first
  and snapshot-first safety, drawer/guard exclusions and byte-exact terminal keys.

This is a focus completion rule for existing tab selection, not implementation
of shared tab/pane selection or the wider Stage 3 workbench operation set.

## A Stopped Terminal Is Clearly Not Accepting Input

- Show a persistent, compact, readable process-state indicator for `exited`,
  `failed` and `interrupted` panes, including an ordinary successful shell `exit`.
  Keep terminal output, pane identity and layout mounted. Full-pane dimming,
  animations, new status history and new restart controls are not required.
- Do not forward keystrokes, paste, mouse encodings, focus reports or emulator
  responses to a non-running pane. Gate callbacks against live authoritative
  status as well as visibility/modal/drawer/guard eligibility, including events
  buffered before a React commit. Keep valid output replay independent of input.
- **Builder proposal:** when the currently focused terminal stops, retain its
  logical selected-pane/restart target but move native input focus to its tab
  strip. Do not automatically jump to another terminal or tab. The stopped
  terminal must not leave a live input cursor on screen or masquerade as editable.
- Existing explicit restart remains available for that selected stopped pane.
  No automatic restart loop or restart induced by typing/opening. A deliberate
  restart may return to the pane only after running/native readiness and while
  the initiating intent is still current; failure preserves a valid shell focus.
- Process exit itself is persistent state, not a fresh operational error for
  every key. Work Craft spawn/restart failures still report once through the
  eight-second source-labelled status policy. Do not renew/recreate errors or
  churn HINTS/ERROR/scroller state when someone types after process exit.
- Shell/application stderr remains ordinary terminal output, not a Work Craft
  failure signal. Keep global/leader handling and all raw-key passthrough on
  running panes unchanged. Diagnose the observed flicker before choosing its fix;
  do not assume that shortening/lengthening status timeouts is the explanation.

## Ownership And Compatibility

The daemon owns repository grouping, canonical identity, discovery, records and
runtime process state. The CLI remains non-interactive. Shell owns registration
completion, local selection, per-tab memory and cancellable entry/focus policy;
navigation/workbench render authoritative data and report semantic interactions.
Keep UI-library defaults and dependency direction intact. No generic entry
framework or new library component is needed merely for this follow-up.

Relevant existing owners: server `application/directories.ts`, `items.ts`,
`app.ts`, protocol/client/schema and their connected CLI callers; TUI shell
commands/state/model/focus/orchestration, client process-state updates, Navigator
projection, SurfaceView and TerminalPane. The plan must enumerate connected
fixtures, public exports and acceptance tests rather than leave partial clients.

Existing development records/history and client-local state are disposable by
the user's explicit decision. Do not build a migration, merge old independent
worktree surfaces, or retain legacy identity aliases. If incompatible schema or
metadata requires a clean start, keep normal startup fail-fast with an actionable
explicit-reset message, never silently delete the database. Disposable app state
does not include staged/unstaged source, registered directories or Git metadata.

Any actual reset must follow the existing bounded daemon-destroy procedure:
resolve/show the selected Work Craft home/database, close reconnecting clients,
confirm concrete shutdown/reset scope, and stop/reap owned runtimes before
removing only the selected app database/sidecars. Use isolated temporary homes
for automated work. No default-state reset occurs during design/planning.

## Verification And Human Acceptance

The implementation plan must provide focused RED→GREEN coverage for:

- Real Git: primary or linked path first, reverse/repeated/concurrent alias
  registration, one group, exact returned item, non-main/detached branches,
  workspace isolation, plain/nested/bare paths, failed scans, unavailable primary,
  archive suppression, moved/reappearing children and shutdown races.
- New/duplicate TUI registration and generic creation: correct requested surface,
  both response/snapshot orders, live form/retry behavior, no duplicate submits,
  cancellation, filter independence, drawer success/failure and native identity.
- Tab selection from terminal versus tab strip/other scopes, per-tab pane memory,
  boundary no-ops, readiness/geometry failures, rapid reverse ordering and stale
  focus/restoration after dialog/guard/context/epoch changes.
- Exit/failure/interruption while focused: readable persistent state, preserved
  terminal object/output/history, no fake live cursor, no PTY-bound bytes or
  per-key status churn, explicit restart and source-associated successful recovery.
- Real normal-entrypoint PTY, CLI text/JSON, daemon lifecycle and compiled smoke,
  keeping raw Tab/Shift+Tab/Ctrl+C/Escape/double-prefix and replay protections.

Run affected tests and fresh `bun run check`, obtain independent read-only
implementation review, regression-test actionable findings and reverify. Then
pause for manual root/worktree registration/dedup/entry, tab focus, exited-pane
input/restart, and drawer/guard acceptance. Do not proceed to Phase 5 or shared
navigation as a side effect of finishing this follow-up.

## Builder Check Record

Independent read-only builder check: `ses_eb60b34e7ffe1i4bahrPWP9XE4`.
The reviewer asked about same-path repository replacement detection and linked
worktrees backed by bare repositories. The author resolved these as the explicit
builder proposals above: path-based identity without incarnation tracking, and
rejection of linked-bare grouping while preserving plain bare-directory targets.
Both limits were approved with the full description on 2026-10-17. They are
design decisions, not claims of implemented behavior.

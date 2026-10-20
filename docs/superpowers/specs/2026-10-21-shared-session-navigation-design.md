# Shared Session Navigation — Stage 2

## Status And Decisions

Draft companion to [TUI Overhaul Stage 2](2026-09-18-tui-overhaul-design.md).
The full design is not yet approved and does not authorize implementation.

The user confirmed tmux-inspired shared selection, client-local session attachment,
and latest-active-client terminal sizing. Other decisions below are proposed
engineering choices, not previously approved product requirements.

Workflow:

- [x] Clarify intent and establish the tmux-inspired baseline.
- [x] Create and enter an isolated native worktree; install with Bun.
- [x] Read architecture, current TUI ownership, and connected implementation.
- [x] Verify the unmodified baseline.
- [x] Draft this companion design.
- [x] Complete an independent builder check and resolve consequential questions.
- [ ] Obtain approval of this full design.
- [ ] Write an implementation plan after approval.

Worktree: `/Users/ovi/.local/share/opencode/worktree/c4185d/stage-2-shared-session-navigation`.
Baseline `bun run check` passed 1,519 tests, zero failures, lint/format/types,
compiled build and smoke on macOS. The first attempt failed the existing
`contained strip arrow cancels delayed entry after response without undoing
selection; fresh Enter works` focus assertion and timed out at 120 seconds.
The unchanged file rerun passed 90 tests and the full rerun passed. No root cause
or repair is claimed. The existing server `no-unsafe-finally` warning remains.

The independent builder check identified one consequential ambiguity: whether a
viewer with some undersized panes can own tab sizing. The explicit per-pane rule
in the sizing section resolves it while preserving usable siblings. This is an
engineering choice proposed for approval, not additional user-confirmed intent.

## Intent And Boundaries

Clients attached to one session work in the same durable context: workspace,
category, root/child item, tab and selected pane. Navigation in one is reflected
in the others, as window/pane selection is when sharing one tmux session.
Detaching never stops runtimes; reconnecting joins the session's current context,
not an obsolete selection remembered by the client.

Keep the single local daemon, React/OpenTUI, normal entrypoint, item-owned
surfaces, stable pane identities, bounded history and existing command routing.
Keep all six categories and the current docked/drawer/resize-guard rules. No new
key map or shell styling is required.

Not included: Stage 3 close/move/reorder/resize commands, mixed/built-in panes,
category integrations, read-only spectators, driver locks, selectable sizing
policies, tmux session groups, remote access, plugins or a server-side terminal
emulator. Preserve live-cwd inheritance and split equalization already delivered.

## Ownership And Session Isolation

Durable navigation belongs to the daemon and SQLite. Client-local state includes
the attached session ID, native/logical focus region, navigator and tab browsing
cursors, per-scope filters/expansion, viewport offsets, sidebar visibility/width,
dialogs, form drafts, leader state and pending terminal-entry intent.

Shared pane selection is not shared keyboard focus. Leaving a terminal to edit a
filter does not clear or change the session's selected pane. Merely browsing a
list or tab strip does not activate its candidate.

Separate sessions remain independent even if they include the same workspace
and therefore reference the same item/surface. They may choose different tabs
and panes without changing one another's selection. Structure, process state and
output remain shared wherever they reference the same durable objects. One PTY
cannot have a different size in each session; sizing arbitrates across all clients
actually viewing its tab, including viewers attached to different sessions.

## Durable Selection And Remembering Context

Expose one validated navigation cursor per session in snapshots:

```text
sessionId -> workspaceId -> category -> itemId -> tabId -> paneId
```

Workspace, item, tab and pane may be null where their parent has no eligible
children. Category is null without a workspace, otherwise one fixed category.
Every non-null descendant must belong to the selected parent chain. A selected
item may have no surface; displaying it must not implicitly spawn a shell.

Preserve the existing useful memories, but make them session-owned: selected tab
per surface and selected pane per tab. Switching away and back restores those
valid selections; visiting another context does not overwrite them. Do not add
remembered active items/categories per workspace in this stage: existing scope
changes do not retain that product behavior. Local filter/expansion memory stays.

Proposed storage is a session cursor plus session/surface tab memory and
session/tab pane memory. These are small concrete tables, not an event log or
general preference system. The cursor and affected memories update in the same
transaction. Snapshot projection never repairs or writes selection.

Initial selection is deterministic: first workspace by membership position/ID,
Inbox, first eligible root/child item by catalog preorder, then the remembered or
first tab by position/ID, then remembered or first pane in layout depth-first
order. No item/surface is created merely to fill a cursor. Empty sessions retain
a null chain. Adding the first workspace or first item fills an empty eligible
chain without spawning a runtime. Additional creation does not steal selection
unless the initiating operation explicitly requests activation.

Existing stopped/failed panes remain valid selected panes. Process exit does not
automatically switch to a running sibling or restart anything. Running/native
readiness gates still decide whether input can be handed to that selected pane.

## Commands, Ordering And Atomicity

Add a semantic navigation command with a required session ID and an explicit
workspace/category/item/tab/pane target. Resolve the full parent chain in the
daemon; reject mismatched ancestry, missing session membership and invalid IDs.
Do not accept an unchecked patch of unrelated selection fields.

Selecting a workspace retains the current category when valid and chooses the
new context's deterministic item. Selecting a category keeps the workspace and
chooses its first eligible item. Selecting an item restores its remembered tab
and pane, without creating a surface. Selecting a tab restores its pane memory.
Selecting a pane selects its owning item/tab and validates workspace membership.

The TUI's Open operation must ensure/reuse the exact item's surface and select
that item/tab/pane atomically in the same durable operation. Preserve explicit
unavailable-item rules: reopening an existing surface is allowed; creating a new
surface at an unavailable path fails. Failed ensure validation leaves the old
cursor unchanged. A committed surface whose process subsequently fails remains
selected for inspection and explicit recovery; do not roll back durable records.

Existing tab creation and splitting gain explicit session activation context
for interactive callers: the new tab/pane and shared selection commit together.
Creation without activation context (such as scripting) creates structure without
moving an arbitrary session. Explicit restart preserves selection unless its
interactive caller explicitly targets that pane; it never selects a sibling.
Directory registration remains metadata-only; the TUI's subsequent Open activates
the returned exact item, not its repository root.

Daemon commit order wins for concurrent absolute selections. No driver lock,
wall-clock conflict resolution, optimistic shared selection or client repair.
Resolve relative category/item/tab navigation in the daemon against its current
cursor, so rapid repeated next/previous commands do not all select the same stale
client-computed neighbor. Item stepping follows the unfiltered catalog, not any
client's expansion/query; ordinary List browsing remains local and filtered.

Navigation/interactive mutations capture the expected session context at issue
time. Commands whose prerequisite context changed during asynchronous cwd or
directory inspection must reject activation rather than reopen an obsolete
context. Structural operations with explicit resource IDs may still complete if
their documented preconditions remain valid; they must not reactivate a session
that has since moved elsewhere. Define these checks alongside existing final
split runtime-identity checks, not with a generic concurrency framework.

All durable changes use validation, one SQLite transaction (including cursor
normalization), revision increment and ordered broadcast. No-op navigation does
not advance the durable revision, but successful user activity may still affect
ephemeral sizing. Publish a coherent committed selection before asynchronous
process effects can publish further snapshots; a command response identifies the
committed selection revision for guarded entry. Later runtime-status revisions
must not be mistaken for ownership of a different destination.

## Invalid Targets And Fallback

Invalid explicit commands reject without changing selection. An existing cursor
invalidated by a successful structural mutation is repaired in that mutation's
transaction, for every affected session and remembered tab/pane record.

- Removed workspace membership: next surviving membership in old order, otherwise
  previous; without a neighbor, null workspace and descendants.
- Invalid item: next eligible item in old unfiltered preorder, otherwise previous;
  without one, null item/tab/pane. Keep the current workspace/category.
- Invalid tab: next then previous in tab order, otherwise null tab/pane.
- Invalid pane: next then previous in old depth-first layout order, otherwise null.
- A changed parent repairs descendants using valid memory, then first-child order.

Archival makes the item and any archived-root descendants ineligible for shared
selection. Repair all affected sessions atomically but preserve records, PTYs and
history. This intentionally supersedes the Coding slice's permission to leave an
archived surface active. Local browsing repair still does not activate candidates.
Restore does not steal an existing valid selection. Filesystem unavailability or
a failed scan does not invalidate a remembered item or its existing surface.

Stage 2 does not add deletion operations for items/tabs/panes. The normalization
contract is tested against supported mutations and explicit domain fixtures;
future Stage 3 mutations must call the same concrete normalization path.

## Attach, Detach, Reconnect And Focus

The daemon tracks an ephemeral stream connection and its attached session. A
client may switch its own attachment; this never moves another connection.
Navigation commands require an explicit session; TUI-origin commands also bind to
the current attachment so late commands from an obsolete attachment cannot act
on a newly attached session. CLI targeting does not require a TUI connection.

Preserve initial TUI choice: auto-attach if exactly one session exists; otherwise
show the session chooser. Reconnect remembers this running client's chosen
session if it still exists and reads its current durable cursor. Do not replay
disconnected selection/input/resize commands. After a fresh TUI launch with
multiple sessions, use the chooser rather than persisting a client preference.
If the attached session is deleted, detach to the chooser; do not silently move
the client into another session. Session deletion does not kill item runtimes.

Remote navigation updates the displayed context and shared selection immediately.
If local focus was already inside an unobscured workbench, follow the new selected
pane once its authoritative selection and native geometry are ready. Do not write
this projected focus back as another selection command. If focus is in chrome,
filter/results, tab browsing, dialog or drawer, keep it there; a remote activation
does not close a drawer or take focus out of editing. Preserve scoped filter,
cursor and expansion memory without expanding to reveal a remote active item.

Create/archive dialogs capture explicit target scope/IDs when opened. A remote
navigation change does not silently retarget a draft. Submission validates those
captured targets; successful creation in an old scope may create its resource but
must not pull shared navigation back or perform a stale terminal-entry handoff.
Invalidated targets report failure and preserve editable input where applicable.

An obsolete input callback must never send a key to the formerly selected pane.
Both the live client store and daemon validate attachment, epoch/current selection
identity, pane status and ancestry before forwarding interactive input. Selection
away-and-back must invalidate older input/entry intent even when IDs match again;
use a per-session navigation generation rather than invalidating on unrelated
global revisions. Bytes rejected as stale are dropped, never redirected to the
new pane or replayed. Local pending selection does not permit terminal input
until its authoritative result and native readiness are observed.

Keep existing cancellation/readiness rules for locally initiated entry, including
snapshot-first/response-first delivery, new input, dialogs, guarded drawer closure,
exact split/tab/restart destination and process-start failures. Shared selection
does not relax the three independent client/shell/native input gates.

## Latest-active-client Sizing

The tmux baseline is `window-size latest`: use the dimensions of the most
recently active eligible viewer, not the last resize sender. Upstream documents
the behavior in [tmux.1](https://github.com/tmux/tmux/blob/master/tmux.1) and sets
`WINDOW_SIZE_LATEST` in [options-table.c](https://github.com/tmux/tmux/blob/master/options-table.c).
This design borrows that policy, not all tmux viewport/configuration features.

For each displayed tab, a client reports its available workbench-content viewport
after local shell chrome/sidebar/padding, independently of the negotiated terminal
grid. The daemon validates bounded positive integer dimensions and current
attachment/tab identity. Do not feed the shared grid's measured size back as the
client's available dimensions.

The daemon maintains a monotonic activity order in memory. Successful attachment
to a displayable context and accepted user keyboard/paste/primary-pointer activity
are activity; passive resize, output, snapshots, pointer motion and programmatic
focus are not. Emulator-generated device replies are not user activity. Keyboard
input while using a visible docked navigator may count; editing a covering modal,
using a drawer or being behind the below-80 resize guard does not claim sizing.
No per-keystroke SQLite writes or full durable snapshot broadcasts are needed.

The latest eligible viewer owns a tab's canonical canvas dimensions. An owner's
resize updates those dimensions; an idle non-owner's resize only updates its
candidate report. A newly attached viewer may become owner, as attachment is
intentional activity. Opening a covering presentation or losing usable layout
withdraws that client as a candidate; pick the remaining most recent eligible
viewer. With no eligible viewer, retain the last usable dimensions. With none
ever reported, use the existing 80x24 PTY bootstrap until a usable report arrives.
Detach removes only that stream's reports/activity and reelects; it never stops
or restarts processes. Reconnect starts a fresh connection, not durable ownership.

Eligibility is per visible tab, not all-or-nothing across its panes: the client's
whole workbench must pass its existing minimum layout checks and at least one
running pane must have a locally projected output viewport of 20 columns by five
rows. The selected pane need not be that pane; a usable running sibling is enough.
Covering presentations still exclude the whole client. When this viewer wins,
resize each running pane whose projection meets its minimum; undersized siblings
retain their own last effective grid (or 80x24 bootstrap), remain mounted, and
cannot receive user input locally. A sibling's failure/exit does not disqualify
otherwise usable panes. Tabs with no usable running pane have no sizing candidate;
explicit Reactivate remains independently available at its existing 20x4 minimum.

Choose one owner's complete width/height pair, never independent minima/maxima.
Use its canvas and the durable split tree to produce canonical pane grids with
the existing divider, border and minimum-viewport rules. Keep undersized creation
and equalization: do not reject a split merely because a viewer cannot fit it.
Do not resize a pane to zero or remove protections to manufacture eligibility.
After a layout/process change, recompute current owner eligibility against the
new layout; retain each runtime's last usable size if no usable replacement exists.

Resize only when the effective grid changes. Publish effective canvas/pane sizes
in an ordered ephemeral stream update before output produced at those new sizes;
snapshots include current effective dimensions for initial attach/resynchronizing.
Owner identity need not be a new visible UI element. A user input that changes
ownership applies the new usable sizes before forwarding those bytes to the PTY.
Epoch/connection/tab generations reject late reports and prevent old owners from
reclaiming size after detach or navigation. Geometry ordering is independent of
the durable domain revision, with an explicit sequence for gap/reconnect recovery.

## Consistent Terminal Rendering And Replay

Arbitrating PTY resize alone is insufficient. Every viewer's native emulator
must parse the same pane output at the effective grid dimensions, even when its
visible area differs. Otherwise wrapping and cursor addressing disagree.

Keep local shell layout and pane frames responsive. Inside each local pane frame,
render its terminal at the canonical pane grid size and clip to the local output
viewport. Larger output viewports show unused background, not stretched output.
Smaller ones follow that pane's terminal cursor in both axes, clamped to the
canonical grid. No manual panning commands or generic scrolling widget are added.
This is intentionally not tmux's whole-window viewport: the existing locally
projected split frames remain visible and keyboard-spatial navigation stays local.
Alerts, Reactivate and the one-row status bar remain outside terminal clipping.

Use the installed native terminal's `screen()`/`onScreenChange` information and
fixed-size clipped ancestry, preserving keys, mounting and history cursors. The
builder must first verify native clipping/cursor placement in a focused rendered
test; if that native path cannot support the contract, return to design rather
than adding another terminal emulator or silently using independent grids.

Only the current sizing owner may forward emulator-generated terminal responses;
other mirrors must not duplicate device replies. Response bytes do not count as
activity and must be distinguished from user input using OpenTUI's existing
`onData` source discriminator. Ordinary user input is permitted from any eligible
attached client after its current selection/grid is synchronized. Ownership is
not an exclusive typing lock. Mouse coordinates must map through the clipped
viewport into canonical pane coordinates; keyboard access remains complete.
Daemon response validation is separate from user-input validation: a response may
come from an unselected running pane in the owner's current tab, but only from
that tab's current owner and matching geometry generation. A non-owner mirror
must not answer the same query or claim activity through an automatic response.

Resize ordering must survive retained-history replay, not just live output.
Retain bounded grid-change markers at output-cursor boundaries with each pane's
history and the initial dimensions for the retained range. Replay resizes in
order between byte segments before consuming later cursor-addressed output.
Several resizes at the same byte cursor retain sequence order; history trimming
keeps the last preceding size as the new baseline, dropping older markers.
Persist markers with their corresponding output flush so cold recovery/reconnect
does not reinterpret multi-size history at one guessed width. Preserve existing
raw history bytes/cursors and truncation/reset behavior; this is small replay
metadata, not an event-sourced domain model or server-side screen emulator.

Hold output until the matching native grid is ready, preserving chunk/marker
ordering and the existing bounded-buffer/reconnect policy. Do not inject escape
sequences into child output to simulate a resize. A daemon restart creates a new
geometry epoch and discards ephemeral ownership; durable selection and recorded
history geometry survive, followed by the existing explicit recovery separator.

## Persistence And Compatibility

Migrate the current schema 4 non-destructively to the Stage 2 schema in one
transaction. Preserve IDs, items, surfaces, layouts, policies and output bytes.
Seed each session deterministically. Copy the old surface active-tab selection
into each session's accessible surface memory, then remove the global authority;
there must not be two conflicting active-tab sources. Existing history without
grid markers is legacy data: preserve its current replay behavior and establish
a known baseline for newly recorded output; no claim to reconstruct unknown past
resize history. Old schemas already rejected by schema 4 remain rejected safely.
Migration failure rolls back with an actionable error; no reset or deletion.

Protocol changes require coherent daemon/client restart, not mixed-version
operation. No destructive commands against the user's real development home are
authorized by this design. Tests/smoke use isolated homes. Update every command
caller, snapshot fixture, client-safe export, CLI formatter and smoke assertion
affected by the changed selection/stream/history shapes.

Replace the ambiguous `surface.selectTab` operation with explicit session-scoped
navigation; old calls without a session fail actionably rather than selecting
every session. Provide non-interactive plain-text/JSON CLI navigation for all
five cursor levels and useful relative stepping. CLI reads expose the shared
cursor and can target a session without attaching a renderer. No CLI controls
are needed for local presentation, stream attachment or sizing activity.

## Failure Presentation

Retain the accepted source-labelled status bar, inline field validation, process
indicators and last coherent disconnected snapshot. Remote changes do not create
success toasts or duplicate errors in another client's UI. Direct navigation
failures belong to their issuing client; invalidations produce one corrected
shared cursor, not a per-client fallback error.

Keep the current operational-error duration, priority, deduplication and clearing
rules; Stage 2 adds sources rather than a new notification/history mechanism.
Stale terminal bytes/reports are expected races and are discarded without a
per-key error flood. Malformed protocol messages still fail validation. Connection
loss disables commands/input immediately; presentation remains mounted.

## Implementation Ownership And Verification

Follow [the current source map](../../tui-source-map.md), not historical trees.
Server protocol/transport owns attachment and ordered messages; application owns
navigation validation/normalization and ephemeral size arbitration; persistence
owns migration/memories/history metadata; terminal runtime owns actual PTY writes
and resizing. Keep these concrete mechanisms in their existing capabilities.

TUI `client/` owns live attachment/selection/geometry authorization and stream
ordering. `shell/` coordinates semantic commands, local presentation and guarded
focus. `navigation/` keeps local projection/filter/expansion. `workbench/` owns
canonical-grid rendering, clipping and replay through native leaves. Do not move
application behavior into reusable `ui/` or add a new shared package/framework.

The implementation plan must cover:

1. Transactional migration/rollback, deterministic empty/initial selection,
   session isolation with shared workspace/surface, per-surface/tab memory,
   no-op revisions and cursor generations including away-and-back.
2. Commit-order concurrent navigation and rapid relative steps; atomic Open,
   create/split activation, runtime failure after commit, asynchronous stale
   completion and all supported invalidation/archive/membership fallbacks.
3. Two real stream clients: attachment, switching only one client, stale callback
   rejection, disconnect/reattach, same-revision resync, and cold recovery with
   durable selection/history and no duplicate runtime creation.
4. Latest-active sizing: idle versus owner resize, attach/activity transfer,
   owner withdrawal/detach, cross-session viewers of one PTY, hidden tabs,
   drawer/dialog/guard/undersized exclusion, stale reports, ordered resize before
   input/output and no redundant runtime resizes.
5. Native rendered terminals: common grid at different visible dimensions,
   cursor-follow clipping, canonical mouse coordinates, one device response,
   replay across resize markers/trimming/reconnect and stable terminal identity.
6. Shell keyboard/mouse selection and local browsing/editing preservation:
   remote navigation while typing, existing exact-entry/cancellation races,
   stopped panes, drawer success/failure, and status-row reservation.
7. Two real normal-entrypoint TUIs against one isolated daemon: mirror all five
   cursor levels, simultaneous navigation, different dimensions and activity
   handoff (`stty size` plus a cursor-addressed full-screen fixture), disconnect,
   reattach and unchanged unaffected shell PIDs/output. Exercise CLI navigation
   and compiled smoke, not a special second entrypoint.
8. `bun run check`, connected whole-change review and explicit acceptance evidence.
   Automated macOS results do not certify Linux/physical-terminal behavior or
   long-running listener stability. Do not claim Stage 4's mixed-pane acceptance
   as part of this stage.

Precise module names, table names and message field spellings belong to the
implementation plan. The ownership, selection, ordering, sizing, replay and
failure contracts above are not left to accidental implementation behavior.

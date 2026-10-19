# TUI Component Adoption Phase 5: Workbench Presentation

## Status And Gates

Approved by the user on 2026-10-18, including the mouse-activation and Reactivate
amendments. Initial and follow-up independent builder reviews found no important
planning gaps. The separate implementation plan was approved on 2026-10-18.
Tasks 1–9 are implemented. Independent whole-session and follow-up implementation
reviews are complete, including accepted split, Hyper+n and explicit-restart focus
repairs: successful entry targets only its exact ready destination and newer
intent cancels it. The user accepted Phase 5 for progression and separately
approved Phase 6 consolidation. This does not claim every physical/manual check
below was executed.

The accepted **2026-10-19 restyle/status repair** supersedes the original dimming
and frame assumptions: three-row header/workspaces, two-row Tabs, one-row pane top
border, three-row unavailable Alert, one-cell horizontal workbench padding and no
outer workbench border. Status stays one final row, uncovered/undimmed by overlays.
All native terminal output is transparent and undimmed. Exited/disconnected Alerts
use warning; enabled/unfocused Reactivate uses warning/background colors, with
normal focused/disabled Button styling. Actual terminal input needs `20×5`; recovery
needs a `20×4` pane. The canonical
[adoption inventory](./2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries)
records concrete component owners and intentional native focus, measurement,
mounting/replay, event and modal/router boundaries.

The Oct 19 verified macOS baseline is **1,398 tests, zero failures, lint/format/types,
production build and compiled smoke**. Phase 6's connected review passed with no
findings, and its fresh macOS full check passed **1,399 tests, zero failures,
lint/format/types, production build and compiled smoke**, exit `0`. No production
source changed. The user accepted all component-adoption work as complete on
2026-10-19; this does not certify unexecuted manual checks. Injected default/Dracula tests
add no runtime theme UI/API.
Linux live-cwd and physical-terminal contrast are not certified; long-running
listener stability, existing native/input/React warnings and five lint warnings
remain debt. No warning cleanup or Stage 2 implementation is included.

- [x] Inspect the staged branch, owning specs, workbench, library and runtime.
- [x] Agree live-cwd failure/source rules, equalization and undersized splits.
- [x] Compare workbench mockups and confirm actual Tabs and bottom Alert.
- [x] Complete independent read-only builder review; resolve consequential gaps.
- [x] Recheck the mouse-activation and Reactivate amendments with a fresh builder.
- [x] Obtain approval of this complete design.
- [x] Write and separately approve the implementation plan.
- [x] Implement with parallel subagents where tasks are independent, using TDD.
- [x] Complete independent whole-session/follow-up review and fresh Phase 5 verification.
- [x] Obtain user acceptance for progression to separately approved Phase 6.

Preserve the existing worktree and the entire staged index. Leave all new work
unstaged and uncommitted. No database reset, daemon shutdown, dependency addition,
new worktree or architectural Stage 2 implementation is authorized.

Implementation plan: [Phase 5 implementation](../plans/2026-10-18-tui-component-adoption-phase-5-implementation-plan.md).
It is approved and self-reviewed; execution tracking lives in this plan's local
`.superpowers/sdd/` workspace. Plans remain local under the repository's ignored
plans directory.

## Intent And Boundaries

Finish the workbench's adoption of actual library components without compromising
its daemon-backed terminals. Include the two already approved additions from the
[adoption roadmap](./2026-10-13-tui-component-adoption-design.md#phase-5-workbench-presentation):
live shell-directory inheritance on split, and automatic pane equalization.

The architecture, source organization, focus/input contract and repository-group
follow-up remain binding except for the explicit local tab interaction changes
below. React/OpenTUI, Bun, server ownership of durable layouts/runtimes and the
disposable-client model remain unchanged. Other Stage 3 operations, mixed panes,
shared navigation, shell integration and foreground-program cwd tracking are out
of scope. Do not add tab closing/reordering, pane archival or error history. The
only new restart control is the approved Reactivate button for exited terminals.

### Confirmed Choices

- Use the actual library `Tabs`, not a ToggleGroup imitation.
- Adopt its existing immediate-switch behavior: browsing selects a tab;
  Enter/Space enters that tab's content. Its two-row strip is accepted.
- Change library Tabs mouse selection to both select and activate the clicked
  tab's content, including clicking the already-selected tab.
- Improve TabsList itself with horizontal scrolling when labels do not fit.
- Keep terminal output transparent and undimmed (Oct 19 accepted amendment), with
  a bordered library Alert at the bottom, not a top label or Badge. Its three-row cost is accepted.
- Put one Reactivate button inside an exited terminal's bottom Alert. It invokes
  explicit restart of that pane, not item restoration or an Archive operation.
- Default splits inherit the underlying shell's live cwd, including shell `cd`,
  not a foreground program's independently changed directory.
- If live cwd cannot be determined reliably, reject the split with a clear
  source-labelled status error and change neither layout nor existing processes.
- After splitting, equalize widths/heights by direction throughout the affected
  tab, not equal total area per pane. Preserve topology and pane positions.
- Create splits even if the resulting panes cannot fit the current viewport;
  preserve terminals and gate input/focus instead of rejecting for size.

Earlier tentative ToggleGroup/manual-activation and borderless-Alert proposals
are superseded. The user withdrew the later Archive-button idea and confirmed
Reactivate inside the bottom Alert, not a terminal-replacing EmptyState. The user
requested alternatives and a recommendation with future questions; do not present
builder guesses as confirmed decisions.

## Tabs: Library Behavior, Application Ownership

Use `Tabs` / `TabsList` / `TabsTrigger` for the strip. Keep SurfaceView and the
native terminal subtree outside `TabsContent`. Generic panel mounting, visibility
and first-focusable-child activation must not own daemon terminal lifecycles.

No new manual-activation mode is needed. Adopt native Tabs navigation, including
wrapping left/right and h/l, Home/g and End/G, Enter/Space activation and matching
primary-button release selection. Keep one native `region:tabs` endpoint, not
one stop per trigger. Focus/browsing colors and the heavy underline come from
Tabs rather than the old `>` / `*` text markers.

Browsing now requests the existing durable select-tab command immediately; there
is no extra confirmation to switch the workbench. The daemon remains authoritative:
"immediate" means no confirmation step, not optimistic durable-state mutation or
a promise of zero API latency. A rejected selection retains the authoritative
view and reports its source-labelled failure. While disconnected, local browsing
can move the candidate, but cannot change durable selection or displayed content.

Rapid/buffered browsing advances from the latest local candidate/request, not an
old rendered selection. Responses/snapshots must not resurrect stale entry intent.
On strip refocus, initialize browsing from the authoritative active tab. Other
selection updates do not manufacture local terminal-entry intent.

Enter/Space explicitly requests entry into the selected/requested tab's remembered
valid running pane, otherwise its first usable running pane. If selection is still
pending, wait for its successful response revision in the same epoch before entry.
Use the existing shell-owned cancellable readiness coordinator, not TabsContent's
generic focus operation. Empty/undersized destinations retain strip focus and
the existing selected-pane restart target; no automatic restart or other-tab
fallback is introduced. Starting panes may finish under that same live intent.

Mouse selection must also activate content as a library default, not as a special
workbench handler. A matching primary-button release selects the clicked tab,
then focuses its content's first eligible control or its eligible focusable
surface, using the same activation operation as Enter/Space. Clicking an already
selected tab still activates. Disabled/cancelled/outside-release gestures do not
select or enter. Scroll arrows and wheel input are not tab selection gestures.

Controlled selection may commit asynchronously: activation targets the clicked
value, never the previously selected panel, and waits for its eligible committed
content. Newer interaction/focus/context changes cancel stale pending activation.
Keyboard browsing still switches selection without entering content.

For Work Craft, mouse and Enter/Space activation share shell-owned guarded entry
into that requested tab. Existing terminal-source Hyper switching retains its
guarded terminal-entry behavior. Hyper switching from other controls and
background snapshots preserve their local focus scope. Keep command IDs and
global-key boundary behavior; only local strip interaction is amended.

**Builder call:** add one narrow optional library activation callback that lets
a concrete caller own entry instead of generic TabsContent focusing. Supply the
requested value directly for both mouse and keyboard activation; the workbench
uses it to await authoritative selection and terminal readiness. With no override,
Tabs owns its normal generic content activation. Do not duplicate the library
keymap, add a manual-selection mode, import application code into Tabs or build
a second tab framework. Fix concrete controlled/buffered-navigation issues in
Tabs itself where required by integration tests.

## TabsList Horizontal Scrolling

Integrate the existing HorizontalScroller inside TabsList, rather than requiring
each application caller to reconstruct scrolling. Labels remain unabridged and
nonshrinking when their natural widths exceed the constrained list width. Keep
existing fitting/expanded demo layouts intact, including explicitly equal-width
triggers when their contents fit.

HorizontalScroller currently hardcodes a one-row height. Allow its existing
height prop to be honored, retaining one row as the default. A two-row TabsList
scrolls whole triggers, including underlines; arrows remain on the label row and
appear only on overflow. Do not change workspace/status-bar scroller geometry.

Reuse existing half-viewport primary-release arrow movement, wheel containment,
edge treatment and focus preservation. Browsing/refocus reveals the complete
candidate when possible; an oversized label aligns its leading edge. Pointer
scrolling alone changes neither selection nor focus. Selection changes outside
the strip reveal the active trigger without requesting entry. Preserve manual
scroll offsets until the existing reveal/geometry rules require a change.

Tabs owns trigger reveal identity internally; no application import or new
global input listener is introduced. Add focused library/demo coverage for
fixed-width overflow, two-row rendering, buffered reveal, resize and pointer
behavior. Automatic keyboard selection and existing Enter/Space content focus
remain intact; mouse now requests the same content activation by default.

## Empty, Error And Unavailable Presentation

Compose surface-not-opened and empty-layout states with EmptyState title and
description. Use compact spacing for short available heights rather than adding
buttons or spending fixed padding rows. Keep the existing undersized presentation
and mounted-terminal policy; a size notice must not replace the terminal subtree.

Replace the stopped-pane top Text row with a bottom `Alert` containing one concise
title. Its normal border plus one content row occupies three rows. For an exited
terminal, put a library Button labelled Reactivate alongside the title on that
same interior row. Do not add full operational-error descriptions, an Archive
button or unrelated EmptyState actions. Surface-not-opened/empty-layout states
have no exited process to reactivate and do not show this button.

Reactivate requests the existing explicit `process.restart` operation for that
exact pane, using its saved cwd and restore policy. It starts a new shell, not a
resumption of the dead process. Keep pane identity, retained history and output;
do not create a replacement pane, tab or surface. Disable duplicate submissions
while pending and disable mutation while disconnected. Do not offer it on
running/starting panes or silently broaden it to failed/interrupted states;
their existing explicit restart command remains available.

Use the same cancellable shell-owned restart-success handoff as the existing
restart command. Only successful running/native readiness can enter the shell;
failure leaves the pane/history intact, retains valid control/strip focus and
reports the source error in the status bar. Explicit newer intent cancels the
handoff. Intentional button disabling/focus repair during its own submission must
not accidentally cancel or redirect that operation.

The button is a real keyboard/mouse control, not a clickable label: Enter/Space
and primary release invoke it. Spatial navigation can reach an eligible exited
pane's Reactivate endpoint and return to the strip/other panes; native focus on
the button identifies that exact logical pane without making its dead terminal
input-eligible. The existing leader restart command remains an additional path.
If geometry or connectivity makes the button ineligible, use a valid strip
fallback. No global Tab traversal across running terminal panes is introduced.

**Builder call for tab-content entry:** prefer the remembered/first usable running
terminal as before. If none exists but the selected exited pane has an eligible
Reactivate button, explicit tab-content entry focuses that control without
pressing it. Otherwise keep strip focus. A spontaneous process exit still moves
native terminal focus to the strip as before; it does not automatically focus or
press Reactivate. Other navigator-open and background-selection semantics do not
change as a side effect of adding the action.

**Builder choice approved with this design:** consider starting, exited, failed,
interrupted and disconnected panes unavailable. Disconnection takes presentation
priority, then process status; running/connected panes have no Alert. Use info
for starting, warning for exited/interrupted/disconnected and error for failed.
Being merely unfocused, covered by a dialog/drawer, or temporarily too small does
not create a new process-state Alert. Existing coverage/resize guards remain.

The original 0.75 opacity proposal is historical and superseded by the accepted
Oct 19 styling: preserve transparent, undimmed native output, its renderer and
saved bytes. Alert, Reactivate, framing and status remain full contrast too. No
output parsing, recoloring, library overlay or animation is needed.

Place the Alert in normal pane flow below the terminal: it reduces the viewport
while unavailable rather than covering its last lines. Preserve output/replay
and terminal identity through every state transition. Do not send resize/input to
an ineligible or dead runtime. Removing the Alert on recovery restores the normal
viewport without restarting the existing process or automatically stealing focus.

Always use the bordered Alert, not the earlier borderless fallback. If the pane
cannot fit it, clip presentation strictly to that pane's bounds; do not enlarge
the layout, spill into a sibling/status row or reject the split. The existing
whole-workbench resize notice may cover it when that whole region is undersized.
No guarantee that a complete three-row Alert is readable in fewer than three rows
is possible. Input eligibility still uses actual remaining terminal geometry.

Retain a compact fixed source-failure indicator beside the strip when applicable.
Remove the redundant workbench-wide `! Operation failed` row. Full operational
errors remain in the source-labelled status bar under the existing priority,
deduplication and eight-second lifetime policy. Alerts are persistent state
indicators, not a second full-error channel or a source of per-key notifications.

## Live Cwd On Split

Resolve default split cwd in the daemon from the registered source runtime at
command time, before any durable mutation. Query the original shell process PID
owned by that runtime, not an arbitrary descendant, foreground job or `$PWD`
environment value. An `exec` replacement naturally remains that owned PID;
there is no attempt to recover an underlying shell that no longer exists.

**Builder call:** use `/proc/<pid>/cwd` readlink on Linux and bounded
`/usr/sbin/lsof -a -p <pid> -d cwd -Fn0` inspection on macOS. These require no
package or shell-integration installation. Do not run a shell command string,
inject `pwd`/`cd`, parse terminal escape sequences or trust child-program output.

The macOS probe verified that lsof follows an actual shell `cd`, but also verified
that machine-readable names escape backslashes/newlines. Parse PID/cwd/name
records strictly, decode supported unambiguous lsof escapes without trimming path
characters, and reject malformed, ambiguous or unrepresentable results rather
than guess. Check absolute directory existence/accessibility. Linux cannot be
claimed verified from this Mac; provide parser/failure tests and platform-specific
live acceptance evidence before claiming support on either platform.

Bound subprocess time/output (initial builder limits: one second and 64 KiB),
terminate/reap a timed-out probe, and return an actionable failure if lsof is
unavailable or the platform/permissions do not support inspection. No fallback to
startup cwd, item cwd or home. A stopped source with no explicit cwd also fails.

Capture the runtime object/generation before inspection and confirm it is still
the same live source afterward. Revalidate pane ownership/layout/archive validity
in the short mutation transaction. Never attach an old probe result to a restarted
runtime or hold an SQLite transaction open across OS inspection. This is a
point-in-time cwd sample, not a lock preventing an external shell from changing
directory immediately afterward.

**Compatibility builder call:** preserve the existing explicit `pane.split.cwd`
override for API/CLI callers; it bypasses discovery and remains explicitly chosen,
not a silent fallback. TUI splits omit it and inherit live cwd. Validate explicit
paths before mutation as well. Store the resolved directory on the new pane for
spawn/recovery; do not update the source pane's saved startup cwd or broaden this
into continuous cwd tracking. Preserve the source shell restore policy.

## Automatic Direction-Aware Equalization

Split and equalize in the same durable transaction. Only the source tab changes;
all split ratios in that tab are recomputed. Preserve direction, ordering,
topology, pane IDs and every other tab/surface. No persistent auto-balance mode
or separate balance command is added.

**Builder definition of direction-aware shares:** a pane requires one logical
span on either axis. A split parallel to an axis adds its children's spans; a
perpendicular split takes their maximum. At each split, set its ratio to the
first child's span divided by the sum of both spans, on that split's axis.
Apply recursively throughout the resulting tree.

This produces three equal-width columns after repeated side-by-side splits.
Splitting one of two columns top/bottom keeps the two columns equal in width and
halves that column's height; it does not widen it to equalize total pane areas.
Deeper mixed trees allocate enough logical tracks for their parallel branches.
Shares are dimension-independent; terminal divider cells and rounding can cause
small visible differences. Cell-perfect equality across arbitrary client sizes
is not promised, and no viewport-dependent durable ratios are stored.

Allow the mutation regardless of the requesting viewport's dimensions. Continue
to gate every input source, native focus and PTY resize by current authoritative
eligibility and actual terminal dimensions (at least 20 columns by five rows).
Keep an undersized new pane as the logical split result without focusing it; move
native focus to a valid strip endpoint if the source also becomes unusable.
Later enlargement alone must not revive cancelled entry intent.

A committed split whose new shell subsequently fails to spawn retains its new
failed pane and equalized layout, matching existing mutation/runtime-effect
semantics. Report the spawn failure and show its bottom Alert; do not roll back
successful durable state or restart surviving shells. A precommit cwd/validation
failure creates nothing and does not equalize the old layout.

## Terminal Identity And Geometry

Existing terminal renderer objects, daemon processes and replay positions must
survive equalization and splitting, not just chrome changes. Current recursive
LayoutView nesting can change an existing leaf's ancestry when a split is
inserted; keys alone do not protect it across different parents.

**Builder call:** render active-tab terminal leaves as a stable keyed sibling
collection within a workbench-owned host; project the split tree into pane and
divider rectangles. Changing ratios or inserting a branch updates bounds, not
existing terminal ancestry. Keep the established pane/epoch/replay-key rules and
active-tab mounting policy; do not introduce always-mounted hidden tabs or a
terminal runtime registry in the TUI. Use existing local layout primitives.

Account for the two-row strip, one-row pane top border, horizontal workbench
padding, divider cells and bottom Alert
when calculating remaining terminal geometry. Keyboard spatial movement, live
same-buffer input gating, entry readiness and actual rendering must agree on
usable rectangles. Keep header three rows, status one row and status-safe overlay margins.
Do not copy stale one-row-strip/failure-row arithmetic into the new layout.

## Ownership And Connected Scope

- `ui/components/tabs.tsx`: native tab interaction, default mouse content
  activation, the narrow caller activation override and shared overflow/reveal.
- `ui/components/horizontal-scroller.tsx`: concrete two-row content support,
  preserving existing defaults; existing Alert/EmptyState APIs are sufficient.
- `workbench/tab-bar.tsx`, `workbench.tsx`, `surface-view.tsx`,
  `terminal-pane.tsx`, `layout.ts`: library composition, stable pane presentation,
  geometry and terminal lifecycle. Do not move theme/library types out of `ui`.
- `shell` state/model/commands/focus/layout/orchestration: semantic selection,
  mouse/keyboard strip entry, pane-action focus, Reactivate submission, request
  ordering, source errors and readiness cancellation.
- `client/use-work-craft.ts`: authoritative runtime/connection eligibility remains
  here; pass only concrete presentation information needed for unavailable states.
- Server `terminal/runtime.ts` and its concrete cwd helper if needed,
  `application/app.ts`, `commands.ts`, `layout.ts`: runtime lookup, preflight and
  transactional splitting/equalization. No new durable schema is expected.
- Preserve API/client/CLI split contracts; update connected tests/help only where
  default live-cwd semantics and explicit override validation require it.
- Extend colocated library/workbench/server tests, components demos and normal
  entrypoint/CLI/PTY acceptance. Update owning specs/checkpoints only with actual
  approved contracts and evidence, not merely because this draft exists.

These are connected owners, not instructions to change every listed file or
extract a general framework. Plans must enumerate concrete affected fixtures and
public contracts just in time. Parallel implementers must have disjoint ownership
or explicit dependency handoffs; nobody stages or commits their work.

## Verification And Acceptance

Focused regression coverage must prove:

1. Native Tabs immediate switching, two-row styling, wrapping/endpoints and
   Enter/Space shell entry; mouse release selects and enters both generic library
   content and Work Craft terminals, including an already-selected trigger.
   Cover delayed controlled commits, cancelled/outside gestures, modified/repeated
   keys, buffered rapid changes, failing responses, refocus and source-aware Hyper.
2. Shared tab scrolling at fitting/overflow/oversized-label widths, two-row
   clipping/underlines, candidate reveal, pointer focus preservation and resizing;
   existing workspace/status scroller behavior and demo sizing stay intact.
3. Bottom bordered Alerts and transparent, undimmed output across process/connection
   changes; no duplicate full errors, no per-key churn, no status-bar dimming,
   clipped tiny panes and no input/resize to unavailable runtimes.
4. Real shell `cd` followed by both split directions inherits the owned shell's
   cwd; a foreground child's independent cwd is ignored. Cover spaces, Unicode,
   backslashes/newlines, inspection failure/timeout, missing directories, stopped
   and replaced runtimes, explicit cwd overrides and unchanged state on rejection.
5. Transactional full-tab equalization for repeated and mixed-axis trees, with
   unchanged other tabs; failed preflight versus committed spawn failure,
   disconnected clients, undersized creation and later viewport enlargement.
6. Renderer object identity, replay/output/cursors and daemon PIDs survive split
   insertion/equalization, state Alerts, scrolling and unrelated UI changes.
   Include same-buffer geometry/input tests and existing raw terminal Tab,
   Shift+Tab, Ctrl+C, Escape and double-prefix protections.
7. Exited-pane Reactivate uses the exact pane's existing restart operation once;
   keyboard/spatial and mouse access, pending/disconnected disablement, failure
   and readiness cancellation preserve history, valid focus and source ownership.
   Explicit tab entry may focus Reactivate but never press it; typing or browsing
   never restarts a pane. Generic empty states and non-exited panes gain no action.
   Existing components-demo mouse tests adopt content-entry expectations.

Run focused tests, real daemon/CLI and normal-entrypoint PTYs, independent
connected-code review, then a fresh `bun run check`. Fix actionable findings with
regression evidence and reverify. No broad visual snapshot suite is required.
Document platform-specific evidence and any unverified Linux behavior honestly.

Human acceptance: check tab browsing/entry and overflow, bottom Alert readability
and Reactivate recovery, `cd` then each split direction, repeated/mixed splits, tiny panes,
disconnect/reconnect, drawer/guard resizing, preserved running processes and
output. Stop after Phase 5 acceptance; Phase 6 and shared navigation are not
implicitly authorized.

## Original Design Evidence (Historical)

- Initial index tree: `21491fc4e9c0a4197114aeae2f6231fd03c69dcc`;
  tracked working tree initially matched the index.
- Direction-aware equalization mockup A, creation despite undersizing and native
  immediate-switch Tabs mockup B were selected by the user.
- The user explicitly accepted a two-row strip and a bordered three-row bottom
  Alert, with slightly dimmed unavailable output; the compact borderless mockup
  is not selected.
- The user subsequently confirmed library-wide mouse tab activation into content
  and one exited-pane Reactivate button inside the bottom Alert. Archive was
  explicitly withdrawn. The initial builder review predates these amendments.
- Browser mockups are local ignored artifacts under `.superpowers/brainstorm/`.
  Their interaction/width checks do not verify native TUI implementation.
- macOS live-cwd exploratory probes verified an actual shell `cd` and exposed
  lsof name escaping. They do not certify the unimplemented discovery helper.
- Independent read-only builder review: `ses_eb0ed87d5ffenoGoh5bOG4KSf1` reported
  "nothing important left" for the initial draft. Fresh follow-up review
  `ses_eb0c963dcffeS0CinTA3wkei5a` also reported "nothing important left" after
  the mouse-activation and Reactivate amendments.
- The user approved the complete amended design and authorized planning on
  2026-10-18, then approved the implementation plan. Parallel-subagent execution
  is starting in the existing worktree; delivery/review/human acceptance remain
  pending.
- The initial fresh baseline check exceeded its tool's 120-second timeout during
  tests and was terminated; it is not a passing result. The full rerun with a
  longer limit completed successfully: `bun run check` passed lint, formatting,
  types, 1,020 tests (zero failures), compilation and compiled smoke. Existing
  listener/React act warnings remain. This is preimplementation baseline evidence,
  not verification of Phase 5 behavior. Its local log is
  `.superpowers/brainstorm/12826-1792326831/baseline-check.log`.
- A later docs-only planning check passed lint/format/types but finished tests
  with 1,019 passes and one failure: the unchanged daemon test
  `stale claim cleanup cannot remove a concurrent recoverer's claim` exceeded
  its three-second process-exit wait. Its isolated rerun passed (one pass,
  zero failures). This does not establish a root cause or a fresh full-suite pass;
  no daemon/test source was changed and build/smoke were not reached in that run.
  Local log: `.superpowers/brainstorm/12826-1792326831/planning-check.log`.

## Implementation And Acceptance Evidence (2026-10-18, Historical Checkpoint)

This preserves actual earlier attempts and pending gates at that time. The current
Oct 19 accepted checkpoint above supersedes its review/progression status, not its
test results or unexecuted Linux/physical checks.

- Tasks 1–8 supply focused native library/demo/geometry/identity, daemon preflight,
  input ownership and response/snapshot ordering coverage. Task 8's reviewed repair
  passed 532 focused tests plus types/lint/format before integrated acceptance.
- The first integrated product check before that repair had 1,221 passes and one
  failure: normal-entrypoint acceptance still expected obsolete `*Second` (and later
  `*Main`) markers. Captured native output already showed styled Tabs and readiness.
  Task 9 adapts the owning test, not product titles or selection semantics.
- Task 9 focused real acceptance:
  `bun test packages/server/src/acceptance.test.ts packages/cli/src/cli.test.ts packages/tui/src/entrypoint.test.ts`
  passed **36 tests, zero failures, 383 assertions** on Darwin (37.07 seconds).
  PTYs exercise app-key split commands after `cd`, real new-shell `pwd`, mixed/repeated
  ratios, undersized creation and old shell `$$`/history. Direct stream probes inspect
  retained shells after undersizing; they do not certify app input eligibility there.
- Normal-entrypoint acceptance retains terminal-source Hyper sentinels and adds
  control-source Hyper, browse-without-entry, daemon-paused keyboard/mouse tab entry,
  and exact exited-pane Reactivate with an untouched sibling and a fixture shell-start
  count. Existing raw Tab/Shift+Tab/Ctrl+C/Escape coverage is reused; native tests
  retain double-prefix, object identity, delayed ordering and action-key coverage.
- CLI acceptance pins `Pane: <id>` text and exact `id`/`paneId`/`surfaceId`/`tabId`
  JSON shapes, live-cwd omission, client-relative explicit override, real shell `pwd`,
  and nonmutating failures for stopped sources and invalid/unavailable directories.
- Compiled smoke adds live-cwd splitting and an original-vs-retained shell PID/output
  sentinel. Its PID parsing self-checks were observed RED→GREEN (five assertions),
  rejecting echoed commands and malformed/wrong-source markers.
- Fresh full-check command/counts/exit, compiled evidence, warnings and self-review
  are recorded in the local Task 9 report at
  `.superpowers/sdd/2026-10-18-tui-component-adoption-phase-5-implementation-plan/task-9-report.md`;
  a focused pass is not a substitute for that integrated gate.
- Earlier Task 9 integrated attempts are not passing gates: one passed 1,242 tests
  and compilation but hit the ten-minute tool timeout during smoke; a background
  rerun accumulated interrupted/long-duration test failures and was explicitly
  terminated (exit 137). Their logs are retained separately in the report. A later
  focused run exposed an acceptance-readiness race: pre-split source cursor output
  could lie inside the future destination rectangle. The owning test now awaits
  the rendered new-divider boundary before accepting destination native readiness;
  the full focused suite above passes after that test-only repair.
- **Linux live-cwd acceptance is unverified.** This host is Darwin; Docker's
  read-only info probe failed because `/Users/ovi/.docker/run/docker.sock` is absent,
  and podman/colima/limactl are unavailable. No VM/container, image download or
  dependency installation is authorized. macOS lsof and parser tests do not certify
  Linux procfs behavior.
- Independent connected whole-session implementation review is still controller-owned
  and pending, separate from the earlier planning/task reviews. Human acceptance is
  pending. Implementers perform no staging/commits; preserve the user's index.
  Phase 6, Stage 2/shared navigation and other Stage 3 operations remain out of scope.

### Physical / Platform Checklist (Execution Not Claimed)

Phase 5 acceptance for progression is recorded above. These unchecked items retain
the original manual checklist, not evidence of physical execution by this worker.

- [ ] App and demos: two-row Tabs, immediate browsing, Enter/Space and mouse
      click/reclick entry, overflow arrows/wheel/reveal without truncation/focus theft.
- [ ] Running terminals have no footer; exited output stays readable/undimmed above
      the bordered Reactivate Alert. Keyboard and mouse restart the exact pane once
      and enter only after readiness.
- [ ] Starting/failed/interrupted/disconnected indicators persist correctly;
      no duplicate full errors, status-row dimming, accidental restart or disconnected mutation.
- [ ] After `cd`, both split directions inherit shell cwd, not a foreground child's
      private cwd; discovery failure leaves pane count/layout untouched with an actionable error.
- [ ] Repeated/mixed splits equalize only the affected tab and preserve old shell
      PIDs/output; tiny splits exist, and enlargement does not revive cancelled entry intent.
- [ ] Drawer, resize guard, dialogs, reconnect and unrelated navigation preserve
      eligible focus, terminal objects/history and raw application input.
- [ ] Run live-cwd acceptance on an available Linux runner before certifying procfs.

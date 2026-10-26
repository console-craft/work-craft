# Remaining TUI and product roadmap

## Status and scope

**In progress:** the persistent shell/input foundation (Stage 1), shared session
navigation (Stage 2) and selected workbench operations are delivered. This is the
remaining roadmap, consolidated from the approved designs; it is not current
architecture documentation or an authorization to implement every item now.

Read the [current overview](../../docs/overview.md),
[TUI ownership](../../docs/capabilities/terminal-interface.md),
[terminal lifecycle](../../docs/capabilities/persistent-terminals.md) and
[input authority](../../docs/foundations/client-synchronization.md) before
designing a selected slice.

## Delivered baseline to preserve

- Persistent shell, keyboard routing, responsive navigator, component adoption,
  field validation and source-labelled operational errors.
- Unified items, daemon-owned directory/worktree discovery and repository groups.
- Durable per-session selection/memories, independent client attachment and local
  focus/drafts, mirrored programs and latest-active eligible viewer sizing.
- Tabs/splits, source-shell live-cwd inheritance, split equalization, stopped-pane
  history and explicit Reactivate, bounded cold-history display and fresh-shell
  recovery. These are not new Stage 3 work.

Completed component-adoption Phase 6 is distinct from the still-future whole-TUI
Stage 6 below. Do not reopen completed work or restore superseded preview/focus
behavior because an earlier historical specification described it differently.

## Stage 3: Remaining workbench operations

**Partially delivered.** Design and implement the remaining keyboard-first tab and
pane management: closing, movement, reordering and explicit split resizing.

A focused companion design must settle command semantics, destructive-action
safeguards, focus/selection fallback and split-tree transformations. Preserve
durable pane IDs, running processes/output, session memories and current input
authority. Useful durable operations need equivalent non-interactive CLI access;
local presentation actions do not. No provisional historical keybindings are
required before that design.

## Stage 4: Mixed panes

**Not started.** Extend protocol, persistence and rendering to support terminal
and first-party built-in panes in one split tree. Deliver one minimal built-in
pane before adding dashboards or category-specific integrations.

The companion design must define pane discriminants, durable data, migration,
renderer dispatch, lifecycle, loading/errors and daemon/client ownership. Built-in
panes consume structured daemon data; they do not introduce plugins, third-party
pane contracts or user-composed widget systems.

## Stage 5: Category experiences

**Not started beyond Coding.** Add category-specific data, actions and first-party
views while preserving common item navigation and optional terminal surfaces.
Select and design each category/integration separately rather than implementing
the entire list speculatively.

Deferred product goals retained from the original architecture, to confirm when
selected:

- Inbox triage into other work, retaining provenance to the captured source.
- Concrete collaboration/operations views such as `gh`/`az` integration.
- Neovim recovery using the user's session facilities, and OpenCode recovery using
  a known native session ID where available. Only shell recovery exists today;
  adapters should be plain spawn-spec functions, not a plugin framework.
- User-facing repair/reconfiguration for a missing working directory or executable,
  preserving pane/history/restore metadata and allowing an explicit retry. The
  current failure reports must not be confused with a completed repair flow.

## Deferred Neovim focus cooperation

**Not started.** A cooperating Neovim integration should handle `Ctrl+h/j/k/l`
inside editor windows and delegate to Work Craft's existing semantic spatial-focus
operation only at editor edges. Host interception must not block this cooperation.
The plugin, enabling mechanism and transport need a separate design; do not add
process-name detection or unused adapter abstractions in advance.

Acceptance includes a plain terminal beside Neovim with two vertical editor
windows: `Ctrl+l` traverses terminal → editor window 1 → editor window 2, and
`Ctrl+h` reverses that path. Test in the real editor; shared-editor process tests
alone do not prove this adapter exists.

## Stage 6: Whole-overhaul consolidation

**Not started.** After the remaining stages are delivered, remove displaced
presentation paths, align themes/status treatment and complete resize, empty,
loading and error states. Verify keyboard accessibility, mixed-pane persistence,
end-to-end session/workspace/category/item/tab/pane navigation and reconnect without
stopping unrelated runtimes. Keep one normal runnable entry point, not a second UI.

## Small stabilization debt

These deferred issues remain distinct from the delivered navigator:

- Prefer the relevant active-source background error instead of stable source-key
  ordering. Current owner: `packages/tui/src/shell/errors.ts`.
- Stop advertising `n Create` while the navigator filter owns text input. Native
  input correctly treats `n` as text; hint eligibility must agree with routing.
  Current owners: `packages/tui/src/input/command-router.ts` and shell hint composition.
- Test-only `sendProjectionInput()` in
  `scripts/test-support/terminal-projection-paste.ts` does not reject out-of-range
  or fractional numeric paste bytes before `Buffer.from()` can silently coerce
  them. Preserve this diagnostic-helper validation debt during the test overhaul;
  normal captured bytes are valid, and canonical base64 validation cannot recover
  malformed original values. This is not an established production validation defect.

## Deferred test-cost reduction proposal

The testing-policy overhaul is delivered; commands, gates, hooks, failure handling
and test-first policy now live in the
[development reference](../../docs/foundations/development.md).
The retired proposal also suggested deeper cost reduction, not implemented or
authorized as part of that gate split:

- Measure expensive cases by cost and distinct product risk, then consolidate
  repeated private-structure assertions, redundant permutations and over-broad
  fixtures while proving retained tests still catch the original regressions.
- Preserve real persistence, input-authority, lifecycle, synchronization and UI
  interaction coverage. Minimal dependency compatibility belongs in product
  gates; wider characterizations remain separate executable tooling.
- The proposal's approximately 15-second fast and 60-second core-integration
  ambitions are unachieved targets, not current gate names, deadlines or promises.
  Agree any further split and budget from measurements; do not delete by count,
  impose coverage-growth quotas or reclassify failures to obtain green gates.

This is optional follow-up, not a new merge or release prerequisite.

## Delivery constraints

Select one coherent slice, approve its focused design and implementation plan, and
leave the normal app runnable after each stage. Preserve the single local daemon,
React/OpenTUI, disposable clients, bounded history and non-destructive persistence.
No remote/distributed service, custom top-level categories, plugin system,
mouse-only action or broad visual snapshot suite is implied.

Each implemented slice needs focused behavioral/regression coverage, connected
review and `bun run check`. Report physical-terminal/platform/long-duration gaps
explicitly; automated success is not certification of every acceptance dimension.

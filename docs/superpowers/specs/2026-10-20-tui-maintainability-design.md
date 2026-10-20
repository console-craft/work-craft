# TUI Maintainability Refactor

## Status

Approved by the user, including the capability-local test-placement amendment.
This document describes the cleanup proposed in the October 20 assessment.
The user approved the implementation plan and native execution. Implementation
is proceeding in separately verified slices, with an independent final review.

All implementation slices are delivered in the worktree: capability-local tests,
shared projections/geometry, shell lifecycle owners, native UI mechanisms,
compound collection internals, client store/buffers, named demos, current source
documentation and executable import boundaries. Final connected review and its
verification remain pending; this is not approval to merge or push.

Fresh implementation verification on macOS passed `bun run check`: 1,509 tests,
zero failures, formatting/types, build and compiled smoke. The final TUI JUnit
inventory preserves all 1,144 original case names/parameter combinations and adds
92 focused cases. Only the existing server lint warning remains. No server, CLI,
protocol/schema or dependency files changed. Physical-terminal/Linux/long-running
acceptance and the final independent review are not inferred from this result.

Workflow checkpoints:

- [x] Confirm behavior-preserving intent and read existing architecture contracts.
- [x] Create an isolated worktree and install dependencies with Bun.
- [x] Verify the fresh worktree baseline with `bun run check`.
- [x] Write the proposed design.
- [x] Complete an independent builder check and resolve consequential questions.
- [x] Obtain user approval of this design.
- [x] Write the implementation plan after approval.

The initial independent read-only builder check and a fresh check of the
test-placement amendment found no consequential questions. The user subsequently
approved the full amended design. A builder check assesses design completeness,
not implementation or runtime behavior. The self-reviewed implementation plan is
`docs/superpowers/plans/2026-10-20-tui-maintainability.md`; that directory remains
intentionally workspace-local/gitignored.

Fresh worktree baseline: `bun run check` passed 1,417 tests with zero failures,
formatting, types, build, and compiled smoke checks. Five existing lint warnings
remain. This is pre-implementation evidence, not verification of future changes.

A later planning check completed the same full gate but emitted one native
OpenTUI `LayoutLimit` diagnostic during the shell suite. An unchanged isolated
shell rerun passed 508 tests without reproducing it. No production code had
changed; the root cause remains unresolved. Preserve this observation when
comparing refactor verification instead of treating a zero test-failure count as
proof that native diagnostics are clean.

## Intent

The TUI is a stable product checkpoint. Make its implementation easier for one
person to understand and change without redesigning its behavior or architecture.
The user requested implementation of the preceding assessment's suggested
improvements in a new worktree using the Superpowers workflow.

The highest-value result is clear ownership of terminal entry, native focus,
error presentation, and client synchronization, with regression tests that are
easy to find. A lower line count is useful only when it reduces duplication or
removes unnecessary machinery. Moving a large closure to another large file is
not sufficient.

## Scope And Non-goals

Cover the nine TUI maintainability recommendations: shell coordination, shell
tests, pane geometry/readiness rules, snapshot projections/context identities,
native-control plumbing, operational errors, substantial compound UI internals,
client store organization, and demos/documentation/import boundaries.

Keep `client/`, `input/`, `shell/`, `navigation/`, `workbench/`, `ui/`, and `demos/`.
The current capability structure is sound. Add only concrete modules with an
existing responsibility or multiple existing callers, not empty folder grids.

Explicitly out of scope:

- New features, styling, key bindings, rendered IDs, or altered interaction rules.
- Protocol, command/result shapes, database/schema, migrations, or durable state.
- Stage 2 daemon-owned shared navigation or other roadmap features.
- Server directory-refresh extraction, CLI reorganization, or daemon rewrites.
- New dependencies, state libraries, state-machine frameworks, shared packages,
  generic collection engines, command buses, or dependency-inversion layers.
- Generic `shared/`, `helpers/`, `hooks/`, or `utils/` directories and barrel files.
- Performance claims, listener redesigns, or removal of working safety gates.
- Rewriting historical specifications or certifying untested platforms/hardware.

The lower-priority transport-recovery recommendation is satisfied by making the
two existing owners explicit and testing their boundary. This refactor does not
remove either layer's synchronization protection or change fetch behavior.

## Existing Contracts

This is a focused amendment to the existing
[architecture](./2026-09-16-work-craft-architecture-design.md),
[source organization](./2026-09-21-tui-source-organization-design.md),
[focus/input contract](./2026-10-02-tui-focus-input-contract-design.md), and
[component adoption inventory](./2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries).
Their current accepted behavior remains binding; earlier dated behavior is not
revived by reorganizing source files.

The user-approved test-placement convention below explicitly supersedes the
older source-organization document's mixed source/test listings, root test-support
placement, and requirement to retain `src/entrypoint.test.ts` at its original
depth. Behavioral ownership and runtime contracts remain unchanged. Keep the
older document as a historical record and explain the current convention in the
new source map.

### Architecture And Dependencies

- The single local daemon owns durable records, layouts, discovery, PTYs, history,
  and runtime decisions. TUI state remains disposable presentation state.
- The TUI imports server APIs only through `@work-craft/server/client`.
- Shell composes capabilities. Client, input, navigation, and workbench never
  import shell. UI foundation never imports application capabilities.
- Keep React/OpenTUI, the native terminal leaf, local theme contracts, and direct
  imports. No capability learns about another capability's transient policy merely
  to share a helper.

### Behavior And Timing

- Preserve terminal keys, keyed ancestry, mount conditions, registration order,
  replay cursors, history, resize behavior, and raw running-terminal input.
- Preserve the distinction between native keyboard focus, browsing cursor,
  authoritative selection, and remembered pane selection.
- A terminal handoff requires the exact command response revision in the same
  epoch, the correct active destination, running state, native mounting, and usable
  geometry. Newer intent cancels it permanently.
- Snapshot-first and response-first completion, buffered leave-and-return focus,
  creation form closure, drawer closure, restart protection, and exact-pane
  split/restart/tab-creation entry keep their existing semantics.
- Native event callbacks continue to read live state before React commits. Do not
  replace synchronously updated refs with render-only state or change effect
  scheduling just to make an extraction easier.
- Terminal input requires the existing 20-column by five-row viewport. Reactivate
  requires the existing 20-column by four-row pane and never automatically runs.
- Preserve dialogs, resize guard, docked/drawer navigation, status-bar hints,
  field errors, source-associated errors, and disconnected behavior.
- Application overlays must not cover or dim the bottom one-row status bar.

## Proposed Ownership

All module names below are proposed engineering choices, not additional product
requirements. The implementation plan may refine names while preserving the
responsibility boundaries and avoiding speculative abstractions.

### 1. Capability-local Tests And Fixtures

Colocate by capability, not by individual file. Each meaningful existing source
owner keeps its tests inside one local `tests/` directory, separate from the
production-file listing. Apply this convention to all existing TUI tests during
this refactor, not just newly extracted suites.

Placement rules:

- Capability tests belong in `client/tests/`, `input/tests/`, `shell/tests/`,
  `navigation/tests/`, `workbench/tests/`, and `demos/tests/` as applicable.
- UI tests follow their existing production owners: `ui/tests/` for UI-root
  mechanisms, `ui/controls/tests/`, `ui/components/tests/`, and
  `ui/primitives/tests/`. Do not mirror every source file with a new directory.
- `src/tests/` holds root/package-wide tests, including the real entrypoint/PTY
  acceptance suite. Its `support/` directory holds genuinely cross-capability
  test support; move root `test-fixtures.ts` and `test-render.ts` there as
  `fixtures.ts` and `render.ts` and update consumers directly.
- Keep fixtures with their narrowest consumer, for example
  `shell/tests/fixtures.ts`. A test-only helper does not belong beside production
  modules merely because several tests use it.
- Classify tests by behavioral owner, not mechanically by unit/integration level.
  Shell integration remains shell-owned; package-wide process acceptance belongs
  in `src/tests/`.
- Do not add empty test directories or wrapper directories solely to contain one
  source/test pair. A new production subdirectory is justified only by a cohesive
  subsystem with cooperating production modules; its tests then follow the same
  local-directory convention.
- Preserve direct `@/` imports and descriptive test names. No new import alias,
  mandatory `index.ts`, barrel, or test-discovery dependency is required.

Illustrative ownership layout (not a requirement for empty files or directories):

```text
packages/tui/src/
├── app.tsx
├── main.tsx
├── tests/
│   ├── entrypoint.test.ts
│   ├── render.test.tsx
│   └── support/
│       ├── fixtures.ts
│       └── render.ts
├── shell/
│   ├── model.ts
│   ├── state.ts
│   ├── shell.tsx
│   └── tests/
│       ├── model.test.ts
│       ├── state.test.ts
│       ├── shell.test.tsx
│       ├── terminal-entry.test.tsx
│       └── fixtures.ts
└── ui/
    └── components/
        ├── list.tsx
        ├── tabs.tsx
        └── tests/
            ├── list.test.tsx
            └── tabs.test.tsx
```

Within that migration, split `shell/shell.test.tsx` by behavior. Keep shell
composition and cross-region assertions in `shell/tests/shell.test.tsx`; give
item entry, tab entry, pane operations, and dialog integration their own files
under `shell/tests/`. Move isolated component assertions into their owner's test
suite when they do not require the shell.

Moving the entrypoint suite to `src/tests/entrypoint.test.ts` changes its depth.
Update its repository-root calculation and trace explicit test paths, import
consumers, fixture paths, scripts, and documentation before moving tests. Verify
the relocated process tests through the normal runner; preserving coverage means
preserving what actually executes, not merely keeping the same source text.

Extract the existing render/setup helpers and snapshot builders into
`shell/tests/fixtures.ts` or a genuinely shared support module under
`src/tests/support/`. Reuse the real client store for live authoritative input
tests instead of reproducing its policy in more fakes. Presentation tests may
retain intentionally permissive fakes. Test expectations must remain independent
of the production decision functions they verify.

Preserve explicit control over command responses, snapshot publication, React
commits, native frames, and input batches. In particular, publishing a snapshot
without rendering it must remain possible. Preserve every existing case and
parameter combination; no blanket replacement with broad snapshots or a scenario
DSL. Share the duplicate measured-render settling helper where the shell and
surface tests genuinely require the same two-frame behavior, without changing the
default renderer helper's frame semantics for unrelated tests.

### 2. Shared Projections And Pane Geometry

Use feature-owned pure helpers for repeated snapshot relationships and identity
construction. Navigation owns navigator item keys and ordered workspace/category
projection. Workbench owns surface/tab selection projection. Shell owns its
navigation/completion context identities and composes those feature projections.

Preserve current behavior, including intentional differences between an exact
authoritative selection and a presentation fallback. Characterize existing sort,
missing-selection, and missing-record behavior before extracting; do not silently
turn a disagreement into an unrelated bug fix. Prefer explicitly named functions
over a configurable selector framework. Keep live store authorization separate
from presentation fallback rules.

Extend the existing `workbench/layout.ts` and `pane-state.ts` owners rather than
adding competing geometry modules. Name shared minimum dimensions and reuse pure
viewport/recovery geometry across shell layout, focus, surface rendering, and
terminal leaf checks.

Three gates remain independent:

1. Client store: live connection, epoch, process, ancestry/archive, and active layout.
2. Shell: current dialog/drawer/resize presentation and operation protection.
3. Terminal leaf: native dimensions, current input/resize readiness, and stream use.

Only identical calculations move into common functions. Keeping more than one
check at a different lifecycle boundary is intentional.

### 3. Terminal Entry And Shell Focus

Introduce a shell-owned terminal-entry coordinator, such as
`shell/use-terminal-entry.ts`, with small pure decision helpers in a nearby
concrete module when useful. It owns pending entry requests, intent versions,
origin transfer, response-revision readiness, terminal registration, cancellation,
and the frame listener that completes a request.

Requests remain explicit about item/tab/exact-pane destination and operation kind.
Separate synchronous request/cancel bookkeeping from React effects and pure
candidate/readiness decisions. Expose semantic operations needed by current
callers; do not return the entire internal ref collection or accept a copy of the
whole shell closure as an options object.

Restart submission protection has a different lifetime from focus intent: a
cancelled handoff must not release protection before a successful restart's
authoritative response revision. Keep this distinction explicit in the relevant
operation/entry owner and retain its tests.

A shell-local focus hook owns native/logical focus synchronization, drawer and
resize-guard restoration, and focused-control memory. Shell still owns the one
application keyboard-routing policy and composes dialogs and capabilities.
Dialog's existing restoration veto and form-close handoff remain coordinated
through narrow callbacks; neither hook becomes a second global focus authority.

Extract in small steps while keeping listener/effect ordering intact. Add focused
tests for newly separated nontrivial decisions, but retain native integration and
real-entrypoint coverage because pure tests cannot prove timing correctness.

### 4. Operational Errors And Commands

`shell/errors.ts` remains the home for error policy. Place source-key construction,
source-retention rules, message lifetime, and background-error projection together
instead of scattering interpolated keys and suffix matching across files.
Keep existing externally rendered labels, deduplication, direct/background
priority, eight-second expiry, and matching-request clearing behavior unchanged.

A shell-local error-observation hook may own background observation and expiry
timers. Keep command request identity/stale-completion guards in the command
coordination path, with the existing separation between inline field validation
and operational status reporting. Do not route errors through the notification
store or add a generalized error/event service.

`commands.ts` continues to execute semantic shell commands. Extract request
reporting or create submission only where the resulting owner is cohesive and
reduces cross-reading, not merely to shorten its switch statement.

### 5. Native UI Mechanisms

Reuse `setDisabled` in controls that duplicate its blur-before-disable workaround.
Extract a small native focus-subscription helper only for controls with identical
subscription/cleanup semantics. Keep group-specific initialization and each
control's keys, callback ordering, pointer cancellation, and colors local.
Do not replace local subscriptions with a new global focus store.

Move the renderer-scoped pointer observer from ScrollArea into `ui/pointer.ts`.
Keep its single-parser-per-renderer, reference-counted lifetime, prepend-listener
ordering, report consumption, and teardown behavior. ScrollArea and actual gesture
consumers acquire observation explicitly where necessary; consumers no longer
depend on a scrolling ancestor incidentally mounting the observer. Preserve
nested scrolling and same-batch multi-gesture behavior. Test shared acquisition,
independent consumer use, teardown, and reacquisition.

### 6. Compound UI Internals

Focus on the substantial existing List, Command, and Tabs implementations.
Extract identical rendered-tree ordering into a narrow UI helper with existing
callers, retaining caller-specific visibility and eligibility rules. Extract
nontrivial pure paging/candidate operations and coherent local controller/reveal
logic where doing so makes the component readable.

Keep public compound components and their current import paths. Implementation
modules may be named siblings such as `list-state.ts` rather than introducing a
folder/barrel for every component. Leave cohesive JSX together. Preserve
controlled/uncontrolled semantics, buffered input behavior, rich rows, filtering,
scroll reveal, exact pointer gestures, and local hints. Do not generalize the
different components into one configurable selection controller.

### 7. Client Store And React Adapter

Move framework-independent store construction and its contracts from
`client/use-work-craft.ts` to `client/store.ts`; put terminal buffer contracts and
pure buffer operations in `client/terminal-buffer.ts`. Keep the hook module as
the React adapter and production store lifetime owner. Update all internal callers
and tests directly; do not preserve old imports with re-export-only modules.

Transport streaming still owns its connection's ordered snapshot delivery and gap
recovery. The TUI store still owns lifecycle/run invalidation, authoritative state
acceptance, epoch/revision rejection, reconnect, live input gates, and terminal
buffer recovery, including same-revision history updates. Document that boundary
and retain/add connected tests as needed. Removing duplicate-looking guards or
changing recovery requests is explicitly not part of this refactor.

### 8. Demos, Documentation, And Enforcement

Split independent sections of `demos/components.tsx` into named demo files under
`demos/`, leaving the entry composition obvious. Preserve demo order, IDs,
dimensions, shortcuts, theme cycling, notification isolation, and demo tests.
No new demo framework or product feature is needed.

Add a concise current TUI source/ownership map and link it from README. It should
explain where changes belong, the three input gates, terminal identity/timing
invariants, test commands, and intentional native exceptions. Link historical
specifications rather than copying their checkpoint histories into another file.
Include the capability-local test convention, fixture-placement rules, and
package-wide acceptance/support locations rather than the old sibling-test tree.

Extend the existing lint restrictions to enforce the documented capability and UI
dependency boundaries, including type-only imports. Keep aliases/direct imports;
add no dependency-analysis package. Verify both accepted and rejected import
examples using the installed linter or a small focused regression check.
Production code must not import test files or test support. Tests may import
their subjects and the shared `src/tests/support/` modules; scope any test-specific
lint allowances to test/support paths, never to the surrounding production
capability. Test relocation must not weaken production dependency restrictions.

Review touched warnings only. For intentional control-character sanitization,
use a narrowly scoped explanation/suppression rather than weakening the regex.
Do not suppress warnings globally or change server test cleanup to make the TUI
refactor appear warning-free. Record remaining warning debt honestly.

## Delivery And Verification

Implement in separately verified slices: tests/fixtures, shared rules, shell
coordination, native UI mechanisms, compound UI internals, client organization,
and demos/docs/enforcement. Keep the normal entrypoint runnable after every slice;
no parallel v2 implementation or temporary product path.

Preserve existing tests during moves. Use characterization tests before changing
an unprotected extraction seam, and test-first development for new nontrivial
helpers. Run focused affected suites for each slice and `bun run check` for
integration checkpoints and the final result. The full gate includes lint,
formatting, types, all tests, compiled build, and compiled smoke/PTY coverage.

Review the final connected change for behavior parity, timing, ownership,
duplication, listener teardown, and unnecessary abstractions. Any actual bug found
that requires changed behavior is reported separately rather than silently folded
into cleanup. A failed baseline is a blocker for user direction, not license to
repair unrelated work.

Acceptance requires:

- Every assessment area above has a concrete delivered improvement, with no
  unexplained omission. Deferring an entire approved area requires user approval.
- The shell reads as orchestration/composition with named lifecycle owners, not a
  relocated monolith or a mesh of hooks sharing all their private state.
- Shared rules have a single concrete owner; intentional independent safety gates
  and differing presentation/authoritative selection policies stay explicit.
- Existing timing, native identity, input, dialog/status, reconnect, and output
  regressions remain covered; new nontrivial decisions have focused tests.
- All TUI tests and test-only fixtures follow capability-local `tests/` ownership,
  with root/package-wide suites and genuinely shared support in `src/tests/`.
  Relocated tests are discovered and explicit path/depth assumptions are updated.
- Capability boundaries are enforced, and the source map reflects actual files.
- No new dependencies, protocol/schema changes, or user-visible differences.
- Fresh final `bun run check` passes and the reviewed diff is limited to scope.

Physical-terminal acceptance, Linux-specific behavior, and long-running listener
stability remain unverified unless separately exercised and recorded. Passing
automated tests is not certification of those limits.

## Engineering Decisions Left To The Plan

The builder chooses exact file names, helper signatures, test grouping, and slice
sizes after tracing callers. Prefer the smallest extraction that fully gives a
responsibility an owner. Do not impose line-count targets, new public options,
arbitrary symmetry, or a requirement to split every large function.

The worktree/branch is `refactor/tui-maintainability`. The design is committed as
required by the brainstorming workflow after its builder check; no implementation
or merge is authorized by that documentation commit. Implementation execution
method and commit cadence are selected after design approval and planning.

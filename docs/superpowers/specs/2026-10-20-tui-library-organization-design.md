# TUI Library Organization Follow-up

## Status And Intent

The user approved the organization proposed in chat on October 20, 2026.
Make demos and reusable UI easier to scan, preserving behavior and preparing
the existing ownership boundary for a possible future library extraction.
The user approved the implementation plan and native execution in the existing
worktree. Implementation, verification and independent read-only review are
complete. The user subsequently authorized committing and publishing this branch
as a pull request. No merge or worktree removal is authorized.

This is a small, mechanical follow-up to the completed
[maintainability refactor](2026-10-20-tui-maintainability-design.md), not a
standalone-library project.

## Approved Moves

Paths below are relative to `packages/tui/src/`.

- Move all thirteen `demos/*-demo.tsx` files into `demos/component-demos/`,
  preserving basenames. Keep `components.tsx`, `controls.tsx`, `demo-page.tsx`,
  `use-demo-theme.ts`, and showcase integration tests in `demos/`.
- Move `ui/collection.ts`, `ui/control-hints.ts`, `ui/focus-manager.tsx`,
  `ui/focus-utils.ts`, `ui/modal-focus.ts`, and `ui/pointer.ts` into
  `ui/interaction/`, preserving basenames.
- Move `ui/theme.ts`, `ui/theme-provider.tsx`, and the entire `ui/themes/`
  directory into `ui/theming/`, preserving basenames.
- Move the five interaction suites from `ui/tests/` into
  `ui/interaction/tests/`: collection, control-hints, focus-manager,
  focus-utils, and pointer. Move `theme-provider.test.tsx` into
  `ui/theming/tests/`. Keep notification tests in `ui/tests/`.
- Leave `ui/notifications.ts`, `ui/renderer.ts`, `ui/utils.ts`, icons,
  primitives, controls, components and their component-local internals unchanged
  in ownership and location.

## Boundaries And Non-goals

Reusable interaction and theming mechanisms stay in `ui/`; Work Craft policy
stays in application capabilities. In particular, application keyboard routing,
terminal-entry eligibility, operational errors and status-row reservation do
not move into the library. Renderer listener configuration remains an explicit
bootstrap call; application composition still chooses the theme.

Preserve all exports, signatures, rendered IDs, terminal identity, effect order,
event registration, focus/input rules and test assertions. Update every affected
import, including string fixtures and `scripts/smoke-build.ts`. No compatibility
re-exports, barrels, new dependencies, package scaffolding, public API redesign,
generic utility directories, or alias migration are needed.

These concrete subdirectories and their owner-local test directories supersede
the older flat UI-root locations in the source-organization and maintainability
specifications. Keep those dated documents as historical records and update
`docs/tui-source-map.md` to describe the new current locations. The single-daemon,
disposable-client architecture and reusable-UI dependency restrictions remain
unchanged.

## Verification

Compare pre/post inventories to ensure every moved file and existing test is
retained. Audit obsolete paths in executable source, scripts and the current
source map. Exercise nested UI ownership with the existing real-config boundary
tests, then run the TUI suites and the repository-wide `bun run check`, including
compiled smoke. No physical-terminal, Linux or long-duration certification is
implied. Initial implementation excluded staging, commits, merge and push; the
subsequent user request authorizes commits, push and PR creation only.

## Delivery And Verification Record

- All 32 approved file moves are accounted for: thirteen demo sections, thirteen
  UI source/preset files and six UI test suites. All 208 TUI source/test files
  remain present, with no files left at the old moved paths.
- Baseline comparisons preserved every non-import source and original test body,
  except the approved lint-fixture path updates and additions. Import bindings
  match the exact approved path substitutions, allowing formatter sorting/reflow.
  The three retained UI-root modules are byte-identical. No obsolete executable
  aliases remain in TUI source or scripts.
- Demo baseline and post-move suites each passed 32 tests. The pre-move UI plus
  boundary baseline passed 403 tests. The final whole-TUI run passed 1,244 tests
  across 83 files: all 1,236 existing cases plus eight nested-owner value/type
  boundary cases, with zero failures.
- The final macOS `bun run check` passed lint, formatting, types, all 1,517 tests
  across 103 files (zero failures), compiled build and compiled smoke. Whitespace
  checks passed. The existing server `no-unsafe-finally` warning at
  `packages/server/src/application/directories.test.ts:542` remains.
- A fresh read-only reviewer independently checked the entire uncommitted
  follow-up against `7062691`, including untracked move destinations, retained
  source/test bodies, aliases/string references, nested boundaries, smoke import
  and current documentation. No Critical, Important or Minor findings; no fixes
  requested. The reviewer independently passed typecheck, lint, formatting and
  whitespace checks, but did not rerun tests/build/smoke during the implementer's
  runtime gates.

An initial broad TUI run failed the existing case `a cancelled ensure failure
cannot report status over a replacement form` at
`packages/tui/src/shell/tests/item-entry.test.tsx:692` because the category focus
target was absent, then reached the 120-second command timeout. Its orphaned test
process was terminated. The unchanged isolated case passed (1/1), the unchanged
whole file passed (116/116), and subsequent whole-TUI and repository-wide runs
passed. No root cause or repair is claimed.

Ruling: retain that diagnostic rather than alter runtime/test behavior in a
move-only follow-up; no move-related cause is established. An intermittent
focus/rendering failure could recur and require separate investigation. This
resolves the reviewer's sole deferred judgment, not a demonstrated code defect.
There are no deferred review findings. Physical-terminal, Linux and long-duration
acceptance remain unverified.

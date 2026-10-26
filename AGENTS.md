# Agent Guidelines

- Use Bun for dependencies and scripts.
- Keep changes focused and follow existing project conventions.
- Read `docs/overview.md` before planning features or changing architectural boundaries; it and its linked architecture documents describe the current implementation.
- Read `docs/terminal-interface.md` before changing source organization or TUI ownership, and `docs/terminal-processes.md`, `docs/terminal-display.md` plus `docs/client-coordination.md` before changing terminal behavior, input authority or recovery.
- Keep TUI tests in their capability owner's `tests/` directory; reserve `packages/tui/src/tests/` for package-wide acceptance and genuinely shared support. Follow the enforced import boundaries in the terminal-interface document and the current verification workflow in `docs/development.md`.
- Keep README user/feature-focused with installation, short onboarding and essential caveats. Put technical/current developer guidance in the owning capability, foundation or choice document under `docs/`, not dated specs; update it when behavior changes.
- Keep all Superpowers work in the repository-root `.superpowers/` directory, not `docs/`. Save design specs and open investigation briefs in version-controlled `.superpowers/specs/`, and local implementation plans in gitignored `.superpowers/plans/`; these locations override skill defaults. Specs track unfinished work, not current implementation authority. Preserve active requirements and unresolved issue evidence before retiring documents; completed history belongs in Git, not a separate handovers directory.
- Optimize for a small codebase that one person can maintain.
- Preserve the local-first, single-daemon architecture: the server owns durable state and runtimes; the TUI and CLI are disposable clients.
- Use React with OpenTUI for the TUI. Do not introduce Solid.
- Keep theme types and providers in `packages/tui/src/ui`; add reusable UI only when concrete callers need it.
- Application overlays must not cover or dim the one-row status bar; reserve its bottom row while keeping component-library full-screen defaults.
- Prefer native OpenTUI primitives until a dedicated local primitive or component exists. Keep application-specific behavior in callers.
- Keep the CLI non-interactive and Unix-like, with plain-text or JSON output.
- Do not introduce remote, distributed, or plugin-system abstractions without an explicit requirement.
- Run `bun run check` before completing work, plus affected acceptance/tooling tests for relevant changes. Local commits are checkpoints; CI owns complete product acceptance on macOS/Linux. Use `bun run check:all` for local full-product certification, not every edit or commit.
- When saving shell-command output to a log, also mirror stdout and stderr to the terminal with `2>&1 | tee <log>`, and enable `pipefail` so command failures propagate.
- Use Conventional Commits for commit messages.
- Do not stage or commit changes unless explicitly requested or when required when running some skill that requires it.

## Test-First Work (Including Superpowers)

- Keep RED → GREEN. Before writing a regression test, name the failure it must catch, its primary test owner and its execution gate.
- Extend an existing owning test when it already covers the contract. Add a separate case for a distinct failure mode, not automatically for every function or implementation step.
- Use the cheapest boundary that can faithfully prove the behavior. Keep real database/process tests where durability, authority or lifecycle is the risk; do not reproduce those boundaries in generic UI fixtures.
- Add response-order/input/layout permutations only when they protect different failures. Prefer behavioral outcomes over private structure, exact frames, styles or mock choreography unless those are the actual contract.
- Consolidation must retain protection against the original regression. Remove a temporary probe or duplicate only after verifying the surviving test can catch that failure; do not delete by count or require test-count/coverage growth.
- Test-first development does not make a test a pre-commit requirement. Assign its gate by cost and product risk; never move a failing product contract into tooling or diagnostics just to obtain a green gate.
- Use `bun run test`/`bun run check` for routine repository gates; use `bun test` with explicit paths for focused work, not bare broad discovery. Detached fixtures must retain `WORK_CRAFT_TEST_RUN_ID`; use `testProcessEnvironment()` from `scripts/run-bounded.ts` when scrubbing their environment.
- Apply this policy through repository instructions; do not edit installed/global Superpowers skills as part of project work.

## Pre-PR Test Quality Review

- Before finalizing a PR, review every added or materially changed test against the merge base with the PR's target branch. Follow renames; exclude pure moves, import-path fixes and unchanged tests. Review changed cases in existing files, not only new test files.
- Read each complete test, its relevant fixtures/helpers and the production behavior it exercises. Score each test from 1–10 with a concrete reason; passing tests, names, line counts and coverage percentages do not establish quality.
- Judge meaningful regression detection, independent and specific assertions, real behavior rather than mock choreography, determinism/isolation/cleanup, resistance to unrelated refactors, and appropriate boundary/cost/duplication/readability. Name the plausible production bug it would catch; do not penalize necessary database/process boundaries just for being expensive.
- Scores 8–10 mean trustworthy, useful protection with no consequential gap: keep. A 7 has a concrete repairable gap: improve and reassess to at least 8. Scores 1–6 mean the test is not worth retaining in its current form: remove it, replacing or consolidating meaningful unique regression protection first. Never raise a score merely to clear the gate.
- Before removing unique protection, verify the surviving or replacement test catches the original failure, using a targeted mutation or equivalent faithful reproduction. Do not delete useful regression protection solely because its current test is poorly written; report unresolved gaps as blockers.
- Report each test's path/name, score, reason and proposed action; after cleanup, include final scores and verification evidence. Treat scores as reasoned review judgments, not objective measurements. No deletion quotas, required count/coverage growth or new scoring framework.
- Honor dry-run requests: report scores and proposed changes without modifying tests, fixtures or production code, and wait for approval before cleanup. After approved cleanup, run affected gates and `bun run check`; retain test ownership and cost/risk-based gates.

## Coding Style and Conventions

- Keep modules and functions focused and easy to scan. Treat roughly 200 lines per file and 50 lines per function as review signals, not hard limits; do not split cohesive code merely to satisfy a counter.
- Prefer small, local duplication over speculative abstractions. Extract shared code when the duplicated behavior must evolve together.
- Use explicit return types for exported APIs and functions whose contract is not obvious. Allow inference for simple local functions.
- Use braces and newlines for control-flow blocks.
- Prefer named function declarations for top-level functions. Use function expressions where they are idiomatic or clearer, including callbacks.
- Add comments or JSDoc for public contracts, invariants, and non-obvious behavior. Do not restate TypeScript signatures or obvious implementation details.

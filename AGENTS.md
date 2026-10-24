# Agent Guidelines

- Use Bun for dependencies and scripts.
- Keep changes focused and follow existing project conventions.
- Read `docs/architecture/overview.md` before planning features or changing architectural boundaries; it and its references describe the current implementation.
- Read `docs/architecture/references/ownership.md` before changing source organization or TUI ownership, and `docs/architecture/references/terminal-lifecycle.md` before changing terminal behavior, input authority or recovery.
- Keep TUI tests in their capability owner's `tests/` directory; reserve `packages/tui/src/tests/` for package-wide acceptance and genuinely shared support. Follow the enforced import boundaries in the ownership reference and the current verification workflow in `docs/architecture/references/development.md`.
- Keep README user/feature-focused with installation, short onboarding and essential caveats. Put technical/current developer guidance in `docs/architecture/`, not dated specs; update the owning reference when behavior changes.
- Save Superpowers design specs and open investigation briefs in `docs/specs/`, and local implementation plans in the ignored `docs/superpowers/plans/` directory; these repository locations override skill defaults. Specs track unfinished work, not current implementation authority. Preserve active requirements and unresolved issue evidence before retiring documents; completed history belongs in Git, not a separate handovers directory.
- Optimize for a small codebase that one person can maintain.
- Preserve the local-first, single-daemon architecture: the server owns durable state and runtimes; the TUI and CLI are disposable clients.
- Use React with OpenTUI for the TUI. Do not introduce Solid.
- Keep theme types and providers in `packages/tui/src/ui`; add reusable UI only when concrete callers need it.
- Application overlays must not cover or dim the one-row status bar; reserve its bottom row while keeping component-library full-screen defaults.
- Prefer native OpenTUI primitives until a dedicated local primitive or component exists. Keep application-specific behavior in callers.
- Keep the CLI non-interactive and Unix-like, with plain-text or JSON output.
- Do not introduce remote, distributed, or plugin-system abstractions without an explicit requirement.
- Run `bun run check` before completing work.
- When saving shell-command output to a log, also mirror stdout and stderr to the terminal with `2>&1 | tee <log>`, and enable `pipefail` so command failures propagate.
- Use Conventional Commits for commit messages.
- Do not stage or commit changes unless explicitly requested or when required when running some skill that requires it.

## Coding Style and Conventions

- Keep modules and functions focused and easy to scan. Treat roughly 200 lines per file and 50 lines per function as review signals, not hard limits; do not split cohesive code merely to satisfy a counter.
- Prefer small, local duplication over speculative abstractions. Extract shared code when the duplicated behavior must evolve together.
- Use explicit return types for exported APIs and functions whose contract is not obvious. Allow inference for simple local functions.
- Use braces and newlines for control-flow blocks.
- Prefer named function declarations for top-level functions. Use function expressions where they are idiomatic or clearer, including callbacks.
- Add comments or JSDoc for public contracts, invariants, and non-obvious behavior. Do not restate TypeScript signatures or obvious implementation details.

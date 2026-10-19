# Agent Guidelines

- Use Bun for dependencies and scripts.
- Keep changes focused and follow existing project conventions.
- Read `docs/superpowers/specs/2026-09-16-work-craft-architecture-design.md` before planning features or changing architectural boundaries.
- Read `docs/superpowers/specs/2026-09-21-tui-source-organization-design.md` before changing TUI ownership or source organization.
- Optimize for a small codebase that one person can maintain.
- Preserve the local-first, single-daemon architecture: the server owns durable state and runtimes; the TUI and CLI are disposable clients.
- Use React with OpenTUI for the TUI. Do not introduce Solid.
- Keep theme types and providers in `packages/tui/src/ui`; add reusable UI only when concrete callers need it.
- Application overlays must not cover or dim the one-row status bar; reserve its bottom row while keeping component-library full-screen defaults.
- Prefer native OpenTUI primitives until a dedicated local primitive or component exists. Keep application-specific behavior in callers.
- Keep the CLI non-interactive and Unix-like, with plain-text or JSON output.
- Do not introduce remote, distributed, or plugin-system abstractions without an explicit requirement.
- Run `bun run check` before completing work.
- Use Conventional Commits for commit messages.
- Do not stage or commit changes unless explicitly requested or when required when running some skill that requires it.

## Coding Style and Conventions

- Keep modules and functions focused and easy to scan. Treat roughly 200 lines per file and 50 lines per function as review signals, not hard limits; do not split cohesive code merely to satisfy a counter.
- Prefer small, local duplication over speculative abstractions. Extract shared code when the duplicated behavior must evolve together.
- Use explicit return types for exported APIs and functions whose contract is not obvious. Allow inference for simple local functions.
- Use braces and newlines for control-flow blocks.
- Prefer named function declarations for top-level functions. Use function expressions where they are idiomatic or clearer, including callbacks.
- Add comments or JSDoc for public contracts, invariants, and non-obvious behavior. Do not restate TypeScript signatures or obvious implementation details.

# Agent Guidelines

- Use Bun for dependencies and scripts.
- Keep changes focused and follow existing project conventions.
- Read `docs/superpowers/specs/2026-09-16-work-craft-architecture-design.md` before planning features or changing architectural boundaries.
- Optimize for a small codebase that one person can maintain.
- Preserve the local-first, single-daemon architecture: the server owns durable state and runtimes; the TUI and CLI are disposable clients.
- Use React with OpenTUI and termcn for the TUI. Do not introduce Solid.
- Keep the CLI non-interactive and Unix-like, with plain-text or JSON output.
- Do not introduce remote, distributed, or plugin-system abstractions without an explicit requirement.
- Run `bun run check` before completing work.
- Use Conventional Commits for commit messages.
- Do not stage or commit changes unless explicitly requested or when required when running some skill that requires it.

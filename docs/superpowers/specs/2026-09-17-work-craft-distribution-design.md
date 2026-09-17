# Work Craft Distribution Design

## Goal

Distribute Work Craft as one standalone executable while preserving the three source packages and process roles: TUI, CLI client, and local daemon.

## Executable Modes

The `work-craft` executable selects its mode from command-line arguments:

- no arguments starts the TUI;
- documented commands such as `list`, `ensure`, `status`, `stop`, and `destroy` run the non-interactive CLI;
- one undocumented internal argument starts the daemon.

The internal daemon mode exists only so a compiled client can re-execute the same binary. It is not part of the public CLI contract.

Source-mode development continues to run through Bun. A source client starts `packages/server/src/main.ts`; a compiled client starts `process.execPath` in internal daemon mode.

## Build And Checks

`bun run build` compiles the root entrypoint for the current host into `dist/work-craft`. It does not cross-compile or install the executable.

`bun run check` includes the current-host build followed by a packaged smoke test. The smoke test copies the executable outside the checkout, uses an isolated `WORK_CRAFT_HOME`, asks for JSON status so the compiled client must start its daemon, launches the compiled TUI in a PTY, stops the daemon through the compiled executable, and removes its temporary installation and state.

The build does not run from the pre-commit hook. It is covered by the existing pre-push `bun run check` gate and CI.

## Release Support

Official prebuilt releases support exactly two targets initially:

- Apple Silicon macOS (`darwin-arm64`);
- x86-64 glibc Linux (`linux-x64`).

Release jobs run on matching native GitHub-hosted runners, execute the full check including the packaged smoke test, archive the executable, generate a SHA-256 sidecar, and attach both files to the published GitHub release.

Intel macOS, Linux ARM64, and musl Linux are not official prebuilt targets. They may be added when there is demonstrated user demand and CI coverage.

## Documentation

The README distinguishes development from installation, documents the two official prebuilt targets, and shows manual installation into `~/.local/bin`. Package-manager distribution, an install script, automatic updates, and release notarization are outside this change.

## Verification

- Existing source-mode CLI, TUI, server, and tests remain functional.
- The current-host standalone executable starts its bundled daemon, launches its TUI, and stops cleanly from an isolated installation directory.
- Linux x64 and macOS ARM64 release jobs build and smoke-test natively.
- `bun run check` remains the canonical local and CI correctness gate.

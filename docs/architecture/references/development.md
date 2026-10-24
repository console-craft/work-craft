# Development and verification

Read the [architecture overview](../overview.md) and [ownership map](ownership.md)
before changing the system. The commands here describe the existing workflow;
they do not introduce the proposed test overhaul.

## Setup and running from source

Use the Bun version pinned by `packageManager` in
[`package.json`](../../../package.json). The application needs native PTY support
on macOS/Linux. Install dependencies from the repository root:

```sh
bun install --frozen-lockfile
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run dev
```

`dev` watches source and restarts the TUI; `bun run tui` runs once. The daemon
starts on demand. Keep development state separate from your normal installation,
and use the same explicit home for source CLI commands:

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- snapshot --json
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- daemon status --json
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- daemon stop
```

Do not mix installed/source versions against one running daemon. Shutdown keeps
state but stops shells; see [recovery and reset safety](terminal-lifecycle.md#local-state-and-safe-operation).

## CLI reference

The CLI is non-interactive, with plain text by default and `--json` for structured
output. [`args.ts`](../../../packages/cli/src/args.ts) defines its accepted syntax.
Replace ID placeholders with IDs returned by earlier commands or `snapshot`:

```sh
work-craft session create --name Main --json
work-craft workspace create --session SESSION_ID --name Work --json
work-craft directory register --workspace WORKSPACE_ID --path ~/code/repository --json
work-craft surface ensure --item ITEM_ID --json
work-craft session open-item SESSION_ID --item ITEM_ID --json
work-craft session select SESSION_ID --workspace WORKSPACE_ID
work-craft session select SESSION_ID --category implementation
work-craft session select SESSION_ID --item ITEM_ID
work-craft session select SESSION_ID --tab TAB_ID
work-craft session select SESSION_ID --pane PANE_ID --json
work-craft session step SESSION_ID --level tab --direction next
work-craft pane split PANE_ID --direction vertical --json
work-craft pane split PANE_ID --direction horizontal --cwd ./checkout
work-craft pane restart PANE_ID --json
work-craft item create --workspace WORKSPACE_ID --category design --title Notes
work-craft item archive ITEM_ID
work-craft item restore ITEM_ID --json
work-craft snapshot --json
```

Directory registration returns the exact requested checkout's `id`/`itemId` and
its `rootItemId`; CLI/API registration never opens a surface or focuses a client.
`surface ensure` creates/reuses one without selecting a session; `session open-item`
atomically creates/reuses and selects it. Selection alone never starts/restarts a
terminal. `session select` requires exactly one target flag; `session step` supports
category/item/tab and previous/next. Navigation JSON includes the authoritative
cursor; text snapshots include selected IDs (`-` for null).

The parser also supports session updates/deletion, workspace membership and tab
creation. Old project commands and `surface select-tab` are not aliases.

## UI demos

```sh
CONTROLS_DEMO=true bun run tui
COMPONENTS_DEMO=true bun run tui
```

Use the same variables with `bun run dev` for watch mode. Both showcases support
`Ctrl+t` for themes, `Ctrl+r` for content widths, `Tab`/`Shift+Tab` for control
traversal and `Ctrl+c` to exit. Click page background to focus scrolling; nested
scroll areas keep wheel events local. These theme controls are demos, not an
application theme preference. Composite sections live in `demos/component-demos/`.

## Checks and test execution

Run the full repository gate before completing a change:

```sh
bun run check
```

It runs, sequentially:

1. `bun run lint` (Oxlint).
2. `bun run format:check` (Oxfmt).
3. `bun run typecheck` (TypeScript).
4. `bun run test` (`bun test`, automatic correctness discovery).
5. `bun run build` (current-host standalone executable).
6. `bun run build:smoke` (relocated compiled CLI/TUI/daemon and PTY coverage).

There is currently no separate fast/unit/integration execution policy. The
ordinary suite includes pure logic, SQLite, native parser/renderer, filesystem/Git,
CLI/daemon/PTY and multi-TUI acceptance tests. Capability location identifies
ownership, not cost or isolation. Native continuation characterizations run by
default. Do not silently move correctness assertions into opt-in diagnostics.

Use targeted existing suites during development, then the full gate:

```sh
bun test packages/server/src/application/navigation.test.ts
bun test packages/server/src/terminal/tests
bun test packages/tui/src/shell/tests
bun test packages/tui/src/client/tests
bun test packages/tui/src/ui/components/tests
bun test packages/tui/src/ui/interaction/tests packages/tui/src/ui/theming/tests
bun test packages/tui/src/demos/tests
bun test packages/tui/src/tests/entrypoint.test.ts
bun test packages/tui/src/tests/shared-session.test.ts
```

Real-process acceptance requires a working shell/PTY and Git where repositories
are created. Neovim cases run only when `nvim` is installed. Platform/permission
skips include macOS-specific cwd probes and inaccessible-directory behavior under
root. Three failed-reactivation cases are quarantined on macOS for an unresolved
native hang; their assertions still run on other platforms. See
[known risks](terminal-lifecycle.md#known-limitations-and-unresolved-risks).

The current [Git hooks](../../../lefthook.yml) format/lint staged files, typecheck
and run the **whole ordinary suite at pre-commit**. Pre-push runs the full check.
Hooks unset Git-local environment variables so fixture repositories cannot target
the invoking repository. Do not stage or commit as a side effect of verification.

[CI](../../../.github/workflows/ci.yml) runs the full check on Ubuntu for main
pushes and pull requests. The macOS job builds and runs compiled smoke only; it
does not run the full ordinary suite. Passing one host does not certify every
supported platform or physical terminal. Existing React `act(...)` diagnostics,
listener warnings and a server `no-unsafe-finally` lint warning are not claims of
repaired timing or long-duration stability.

When retaining a command log, mirror both streams and preserve failure status:

```sh
set -o pipefail
bun run check 2>&1 | tee check.log
```

## Manual benchmarks and known-failing diagnostics

Output benchmarks require a fresh artifact directory and are outside the normal
gate. The full run compares PTY/native/application paths, fifty panes and a
ten-minute soak:

```sh
PROFILE_DIR="$(mktemp -d)"
WORK_CRAFT_OUTPUT_PROFILE_DIR="$PROFILE_DIR" bun run benchmark:output
```

Append `-t 'output profile comparison'` or `-t 'fifty-pane capacity'` for a subset.
The benchmark lives in `packages/tui/src/tests/output-profile.benchmark.ts`.

```sh
bun run diagnose:hyperlinks
```

This explicitly selects three OSC8/hidden-wide fidelity reproducers with their
original assertions. They currently fail against stock OpenTUI 0.6.6 and exit
nonzero; they are evidence of unsupported fidelity, not a passing acceptance gate.
`.benchmark.ts` and `.diagnostic.ts(x)` files require explicit selection rather
than an opt-in skip flag. Neither command certifies performance parity or visual
fidelity.

## Builds and preview tooling

```sh
bun run build
bun run build:install
WORK_CRAFT_BIN_DIR="$HOME/bin" bun run build:install
```

`build` writes `dist/work-craft` without installing it. The installer defaults to
`~/.local/bin`, creates the destination and warns if it is not on `PATH`; it never
edits shell configuration. Use `build:smoke` to exercise the compiled executable.

The retained `preview:build` and `preview:smoke` scripts are development provenance
checks for stock registry OpenTUI, not another supported product or runtime
fallback. They audit registry artifacts/compiled imports and run a relocated
preview with disposable state. Preview seeding/reset is explicit tooling, not an
instruction to replace a normal installation or reuse old machine-local homes.

## Documentation maintenance

README is user-facing. This overview/reference set describes current behavior;
update the owning reference when contracts, ownership or commands change. Avoid
copying checkpoint test counts and session-specific acceptance records into it.
Repository workflow locations are defined in [AGENTS.md](../../../AGENTS.md).
Active work lives under `docs/specs/`:

- [Remaining product roadmap and stabilization debt](../../specs/2026-09-18-tui-overhaul-design.md).
- [Unmet performance acceptance](../../specs/2026-10-21-output-lifecycle-design.md).
- [Unresolved native PTY-hang investigation](../../specs/2026-10-23-native-pty-exit-hang.md).

These describe unfinished work, not current implementation authority. Completed
specs/reports live in Git history; retained evidence links use fixed revisions.
Do not create a separate handovers directory or treat old session instructions as
current workflow authorization.

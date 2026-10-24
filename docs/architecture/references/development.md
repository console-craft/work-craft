# Development and verification

Read the [architecture overview](../overview.md) and [ownership map](ownership.md)
before changing the system. This reference owns the implemented verification
policy; older testing proposals are context, not additional gates.

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

## Test-first changes without suite growth

Superpowers/TDD remains a RED → GREEN development loop, not a requirement to add a
new permanent test for every function or commit. Before RED, name the regression,
its primary test owner and its execution gate. Extend the existing owning test
when it already establishes that contract; add a new case for a distinct risk.

Use the cheapest faithful boundary. Real SQLite, authority and process-lifecycle
contracts still need their real boundaries; routine UI assertions should not
reimplement them. Additional input methods, layouts and response orderings earn
coverage when they expose different failures, not merely more combinations.

Consolidation must leave a retained test that catches the original regression.
Temporary probes and duplicate assertions can go only after verifying that
protection survives. There is no test-count or coverage-growth quota. Choose gate
membership by cost and product risk, never by whether the test was written first
or whether moving a failing product contract would make the gate green. Keep this
policy local to the repository rather than modifying installed Superpowers skills.

## Checks and test execution

Run the everyday repository gate before completing a change:

```sh
bun run check
```

It runs, sequentially:

1. `bun run lint` (Oxlint).
2. `bun run format:check` (Oxfmt).
3. `bun run typecheck` (TypeScript).
4. `bun run test:core` (also `bun run test`).

It does **not** compile or start real application/PTY acceptance journeys. Local
commits are recoverable checkpoints, not release certification.

| Command             | Coverage                                                                                          | External deadline                  |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `test`, `test:core` | Rules, real SQLite, lightweight transport and native component/parser contracts                   | 120 seconds                        |
| `test:acceptance`   | Real application/PTY, CLI/daemon, recovery and multi-TUI journeys                                 | 300 seconds                        |
| `test:all`          | Core followed by acceptance: all product suites                                                   | Per-suite deadlines above          |
| `test:tooling`      | Benchmark-harness processes, preview seeding/build, no-fork probes and research characterizations | 300 seconds                        |
| `check:all`         | Static checks, all product suites, build and relocated compiled smoke                             | Suite deadlines; smoke 120 seconds |

Gate membership lives in [`scripts/test-gates.ts`](../../../scripts/test-gates.ts),
not directory layout. It discovers correctness files under `packages/` and
`scripts/`; new tests default to core. Explicit acceptance/tooling exceptions must
exist and cannot overlap. `bun scripts/test-gates.ts <suite> --list` lists exact
paths without running them. Capability location identifies ownership, not cost or
isolation. Tooling assertions remain executable; they are not product acceptance
or known-failing diagnostics. Bare `bun test` still performs Bun's broad discovery
across all three groups; use repository scripts for normal gates.

Use focused tests while editing, then `check`. Changes touching a native/process
contract also need the affected acceptance cases locally; tooling/dependency
changes need the affected tooling cases. Use the external supervisor for focused
native/process execution:

```sh
bun test packages/server/src/application/navigation.test.ts
bun test packages/tui/src/shell/tests
bun test packages/tui/src/client/tests
bun test packages/tui/src/ui/components/tests
bun test packages/tui/src/ui/interaction/tests packages/tui/src/ui/theming/tests
bun test packages/tui/src/demos/tests
bun scripts/run-bounded.ts 300000 bun test ./packages/tui/src/tests/entrypoint.test.ts
bun scripts/run-bounded.ts 300000 bun test ./packages/tui/src/tests/shared-session.test.ts
```

Real-process acceptance requires a working shell/PTY and Git where repositories
are created. Neovim cases run only when `nvim` is installed. Platform/permission
skips include macOS-specific cwd probes and inaccessible-directory behavior under
root. Three failed-reactivation cases remain quarantined on macOS pending targeted
verification after the Bun PTY-exit fix; their assertions still run on other
platforms. Cold-history frame equality has also failed intermittently despite
green runs; preserve that assertion and its open investigation. See
[known risks](terminal-lifecycle.md#known-limitations-and-unresolved-risks).

The [Git hooks](../../../lefthook.yml) format/lint staged files at pre-commit;
commitlint remains enabled. Pre-push runs everyday `check`, unsetting Git-local
environment variables so fixture repositories cannot target the invoking
repository. Do not stage or commit as a side effect of verification.

[PR/main CI](../../../.github/workflows/ci.yml) runs core/static checks on Ubuntu
and product acceptance, build and compiled smoke on **both Ubuntu and macOS**.
Require `check`, `acceptance (ubuntu-latest)` and `acceptance (macos-14)` in branch
protection; workflow files alone do not configure remote merge enforcement.
[Release](../../../.github/workflows/release.yml) runs `check:all` on each packaged
platform. A [separate tooling workflow](../../../.github/workflows/test-tooling.yml)
runs on relevant scripts, dependency, terminal/material and fixture changes, or by
manual dispatch. It never substitutes for product checks. CI jobs have explicit
15-minute limits; no gate automatically retries a failure.

[`run-bounded.ts`](../../../scripts/run-bounded.ts) keeps supervision in a separate
native-free parent, forwards output live, and exits nonzero on timeout (124),
interruption or unsafe cleanup. It tracks owned descendants and revalidates process
birth before signalling, including detached fixture processes; it never restarts
the user's daemon or deletes uncertain fixture state. A timer in a native-blocked
test process is not an external watchdog.

Detached fixture launchers must preserve `WORK_CRAFT_TEST_RUN_ID`. When deliberately
scrubbing an environment, pass `testProcessEnvironment(cleanEnv)` from
`scripts/run-bounded.ts`; it transfers only the ownership marker, not ordinary
environment variables. All current detached application/fixture launchers retain
the marker. This is cooperative test supervision, not an OS sandbox: an arbitrary
program that clears ownership and detaches between observations can escape
tracking. Supervising uncooperative programs would require separate OS-level
isolation, not permission to signal unrelated processes.

The opt-in no-fork probe launcher owns its newly spawned process group. Timeout,
cancellation and leader-exit cleanup share one termination guard: after a
successful `SIGKILL` or `ESRCH`, they never signal that group again. Other signal
errors propagate; a redundant signal can itself fail on macOS after termination.

Classify failures: changed-behavior regressions block readiness; unrelated failures
need evidence and an explicit scope statement; suspected runtime/infrastructure
faults remain unresolved, not passed. After two unsuccessful causal experiments
or roughly 20 minutes without new evidence, preserve the reproducer, remaining risk
and next useful experiment rather than making debugging an open-ended feature gate.
Quarantine requires an explicit risk decision and retained assertions/revisit
criteria; moving a failing product test into tooling is not a repair.

Passing one host does not certify every supported platform or physical terminal.
Existing React `act(...)` diagnostics, listener warnings and a server
`no-unsafe-finally` lint warning are not repaired timing or long-duration stability.

When retaining a command log, mirror both streams and preserve failure status:

```sh
set -o pipefail
bun run check 2>&1 | tee check.log
```

## Manual benchmarks and known-failing diagnostics

Output benchmarks require a fresh artifact directory and are outside product and
tooling correctness gates. The full run compares PTY/native/application paths,
fifty panes and a ten-minute soak, with a 1,800-second external deadline:

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
The command has a 60-second external deadline.
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
- [macOS failed-reactivation quarantine follow-up](../../specs/2026-10-23-native-pty-exit-hang.md).
- [Cold-history frame investigation and separate unexplained CI failures](../../specs/2026-10-25-cold-history-frame-followup.md).

These describe unfinished work, not current implementation authority. Completed
specs/reports live in Git history; retained evidence links use fixed revisions.
Do not create a separate handovers directory or treat old session instructions as
current workflow authorization.

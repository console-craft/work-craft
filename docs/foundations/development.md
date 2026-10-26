# Development and verification

**Use Bun and the repository gates; local checks are not full-product
certification.** Capability ownership determines where tests live, while execution
cost and product risk determine their gate. Start with the [overview](../overview.md)
and follow [AGENTS.md](../../AGENTS.md) for contribution rules.

## Setup and local state

Use the version pinned in [package.json](../../package.json) (`bun@1.4.4`) and
macOS/Linux native PTY support:

```sh
bun install --frozen-lockfile
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run dev
```

`dev` watches the source entry point; `bun run tui` runs once. The daemon starts on
demand and outlives the client. Use the same explicit home for related source CLI
commands; do not mix source/installed versions against one daemon:

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- snapshot --json
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- daemon status --json
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run cli -- daemon stop
```

`bun run db:seed` requires an explicit nonblank home and refuses existing
application records. It uses the normal CLI to create two sessions, two shared
workspaces, generic Inbox/Today items, and four real shells across two tabs with
splits. It never resets state; a partial failure may leave records. Choose an
empty development home or follow the deliberate
[reset safeguards](daemon-and-persistence.md#shutdown-and-destruction).

`CONTROLS_DEMO=true bun run tui` and `COMPONENTS_DEMO=true bun run tui` run standalone
UI showcases. Their theme/width controls do not persist an application preference.

## Gates

Run `bun run check` before completing work. It runs lint, format checking,
TypeScript checking and core tests sequentially.

| Command                              | Scope                                                                      | External test deadline |
| ------------------------------------ | -------------------------------------------------------------------------- | ---------------------- |
| `bun run test` / `bun run test:core` | Rules, SQLite, lightweight transport and native component/parser contracts | 120 seconds            |
| `bun run test:acceptance`            | Real application/PTY, CLI/daemon, recovery and shared-TUI journeys         | 300 seconds            |
| `bun run test:all`                   | Core then acceptance; all product suites, not tooling                      | Per suite              |
| `bun run test:tooling`               | Compatibility probes, benchmark support and research characterizations     | 120 seconds            |
| `bun run test:smoke`                 | Relocated compiled executable with disposable state; build first           | 60 seconds             |
| `bun run check:all`                  | Static checks, all product suites, build and compiled smoke                | Per suite              |

[test-gates.ts](../../scripts/test-gates.ts) discovers correctness files under
`packages/` and `scripts/`. New tests default to core. Explicit acceptance/tooling
exceptions must exist and cannot overlap. Use
`bun scripts/test-gates.ts core --list` (or another suite) to inspect membership.
Do not use bare broad `bun test` as a substitute for these gates.

For focused work, pass explicit paths:

```sh
bun test packages/server/src/application/tests/navigation.test.ts
bun test packages/tui/src/shell/tests
bun scripts/run-bounded.ts 300000 bun test ./packages/tui/src/tests/shared-session.test.ts
```

Native/process changes also need affected acceptance cases; tooling/dependency
changes need affected tooling cases. `check:all` is for deliberate local
full-product certification, not every edit. No gate automatically retries failure.

## Test ownership and faithful evidence

Keep server tests in the owning `api`, `application`, `daemon`, `persistence` or
`terminal` capability's `tests/`; public-client/package acceptance belongs in
`packages/server/src/tests/`. TUI tests belong in their capability or UI owner's
`tests/`; `packages/tui/src/tests/` is for package-wide acceptance and genuinely
shared support. CLI tests live in `packages/cli/src/tests/`; script tests/support
live in `scripts/tests/` and `scripts/test-support/`.

Before RED, name the protected failure, primary owner and execution gate. Extend
an existing owning test when it already covers the contract. Choose the cheapest
boundary that faithfully proves the risk; database/process authority and lifecycle
still need real boundaries. Neither test-count growth nor moving a failing
contract into tooling establishes quality.

Shell fixtures can separate responses, store publication, React commits, native
frames and buffered input. Preserve those controls: one generic flush can hide the
ordering bug being tested. Some connected UI fixtures use real daemon parsers;
being in a capability directory does not make a test isolated.

[run-bounded.ts](../../scripts/run-bounded.ts) supervises in a separate native-free
parent and returns nonzero for timeout (124), interruption or unsafe cleanup. It
tracks descendants and revalidates process births before signalling. Detached
fixtures must retain `WORK_CRAFT_TEST_RUN_ID`; use `testProcessEnvironment()` when
scrubbing ordinary environment variables. This is cooperative supervision, not
an OS sandbox for arbitrary ownership-erasing programs.

Preserve reproducer evidence for unresolved runtime/infrastructure failures;
green static checks do not establish physical-terminal focus/fidelity, Linux cwd
behavior from a macOS run, or long-duration listener stability. See
[terminal risks](../capabilities/persistent-terminals.md#known-limitations-and-unresolved-risks).
The full changed-test scoring/review policy remains in [AGENTS.md](../../AGENTS.md).

## Builds, hooks and CI

`bun run build` compiles `src/main.ts` to `dist/work-craft`; `test:smoke` tests that
already-built executable after relocation. `bun run build:install` also installs
it using [install.sh](../../scripts/install.sh), defaulting to `~/.local/bin` or
`WORK_CRAFT_BIN_DIR`. Installation does not edit shell configuration.

[Git hooks](../../lefthook.yml) format/lint staged files, typecheck the full worktree
at pre-commit, enforce Conventional Commits and run `check` at pre-push. Verification
does not authorize staging/committing. [CI](../../.github/workflows/ci.yml) runs
static/core checks on Ubuntu and acceptance/build/smoke on Ubuntu and macOS.
[Release](../../.github/workflows/release.yml) runs `check:all` for darwin-arm64 and
linux-x64. [Tooling CI](../../.github/workflows/test-tooling.yml) is separate and
path-triggered or manual. Workflow files do not configure remote branch protection.

When retaining command output, mirror both streams and preserve failure status:

```sh
set -o pipefail
bun run check 2>&1 | tee check.log
```

Current architecture lives in `docs/`, organized by responsibility rather than
source directories. Update the owning document when architectural meaning or
useful code references change. Superpowers work belongs in the repository-root
`.superpowers/`, not `docs/`: version-controlled specs and investigation briefs in
`.superpowers/specs/`, local plans in gitignored `.superpowers/plans/`. The
[unfinished roadmap](../../.superpowers/specs/2026-09-18-tui-overhaul-design.md)
retains active requirements without authorizing their implementation. Previous
architecture and issue evidence remain in
[Git history](https://github.com/console-craft/work-craft/tree/6b7279b35f75f16baf1ae651af33f7b7b1d7c604/docs/architecture),
not as a second documentation tree or current implementation authority.

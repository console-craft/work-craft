# Development and verification

[Architecture entry point](overview.md) · [Contribution policies](../AGENTS.md)

This is a Bun workspace compiled into one local executable. Package separation
keeps daemon internals out of disposable clients; it does not imply separately
deployed services. Verification separates fast routine checks from process/PTY
acceptance and explicit compatibility diagnostics. Follow [AGENTS.md](../AGENTS.md)
for contribution and test-quality policy.

## Runtime and build boundaries

The root [package manifest](../package.json) declares Bun 1.4.4. Server and TUI both
pin OpenTUI core to 0.6.6; the TUI also pins its React adapter to 0.6.6 and uses
React 19.3.1. The server needs native OpenTUI for headless terminal interpretation,
not only for drawing. [Consumer checks](../scripts/tests/opentui-consumer.test.ts)
verify that daemon, TUI and React resolve one core installation. An upgrade must
validate extraction, semantic input, native resources and render behavior together;
matching TypeScript signatures alone is insufficient.

From an installed development checkout, the main entry points are:

```sh
bun run dev
bun run cli snapshot --json
bun run server
bun run build
```

`dev` watches the root dispatcher; no arguments select the TUI. `server` launches
the internal daemon path. `build` compiles the dispatcher and imports into
`dist/work-craft`. `build:install` additionally invokes the install script. Use a
separate `WORK_CRAFT_HOME` for development/fixtures so commands do not mutate the
ordinary local catalog or connect to an incompatible daemon. `db:seed` provides
explicit development state through [seed.ts](../scripts/seed.ts).

The [release workflow](../.github/workflows/release.yml) builds on macOS ARM64 and
glibc Linux x64, runs full product checks and packages the executable plus a checksum.
Other platform builds are not currently part of that release matrix. Build/install
instructions for users remain in [README](../README.md).

## Verification ownership

| Gate | Responsibility |
| --- | --- |
| `bun run check` | Lint, format check, typecheck and core tests |
| `bun run test` / `test:core` | Default correctness tests under a bounded runner |
| `bun run test:acceptance` | Explicit database/process/PTY and shared-session contracts |
| `bun run test:tooling` | Selected compatibility and feasibility diagnostics |
| `bun run check:all` | Check plus core/acceptance, build and compiled smoke test |

`test:all` selects core and acceptance; it does not include tooling. New discovered
test files default to core unless explicitly classified in
[test-gates.ts](../scripts/test-gates.ts). The classifier rejects missing exception
paths or duplicate memberships so tests are not silently omitted. Focused runs use
`bun test` with explicit owning paths, not bare broad discovery.

Normal CI runs `check` on Linux. A separate macOS/Linux acceptance matrix runs
acceptance, build and compiled smoke checks. The
[tooling workflow](../.github/workflows/test-tooling.yml) runs the tooling gate on
both platforms for its selected path changes or manual dispatch. `check:all` is
the full local product certification path, not the expected cost of every edit.

The [bounded runner](../scripts/run-bounded.ts) supplies deadlines and process
cleanup. Detached fixture environments must retain `WORK_CRAFT_TEST_RUN_ID`; use
`testProcessEnvironment()` when scrubbing environment values. When capturing command
logs, repository policy requires mirroring stdout/stderr through `tee` with
`pipefail` enabled. [Git hooks](../lefthook.yml) format staged files, lint relevant
source and typecheck at pre-commit; pre-push runs `check`. Tests are not a pre-commit
requirement. Do not stage or commit unless requested.

## Where changes and tests belong

Keep TUI tests under the owning capability's `tests/` directory. Root TUI `tests/`
is for package-wide acceptance or genuinely shared support. The enforced production
dependency directions are explained in [terminal interface](terminal-interface.md#composition-and-dependency-direction).
Server code separates command/catalog behavior, transport authority, persistence,
daemon lifecycle and terminal runtime concerns; choose the boundary that can prove
the behavior under change.

For a regression, name the failure, primary owner and execution gate before writing
the test. Prefer an existing owning case if it already covers the contract. Keep
real database/process coverage where durability, lifecycle or authority is the risk;
avoid duplicating those boundaries with broad UI mocks. Follow AGENTS.md's pre-PR
test-quality review without substituting line counts or passing status for useful
regression detection.

Useful contract entry points include
[command acceptance](../packages/server/src/application/tests/commands.test.ts),
[shared navigation](../packages/server/src/application/tests/shared-navigation.test.ts),
[stopped material](../packages/server/src/api/tests/stopped-material.test.ts),
[shared-session TUI acceptance](../packages/tui/src/tests/shared-session.test.ts) and
[import boundaries](../packages/tui/src/tests/boundaries.test.ts).
[probe-opentui-compatibility.ts](../scripts/probe-opentui-compatibility.ts) owns the
explicit native consumer probe; diagnostics are evidence for the selected contracts,
not proof of compatibility with every terminal application.

Architecture docs describe current implementation. Unfinished requirements and
investigation evidence belong in root `.superpowers/specs/`; local implementation
plans belong in ignored `.superpowers/plans/`. Completed history stays in Git.
Keep README user-focused and update the owning architecture explanation when a
change alters state ownership, lifecycle, protocol or useful source navigation.

[Architecture entry point](overview.md) · [Contribution policies](../AGENTS.md)

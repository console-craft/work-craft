# Development guide

[Overview](overview.md) / Development guide

Topic 4 of 4

[Parent: Overview](overview.md) | [Previous: Choices](choices/overview.md)

Development follows the same ownership boundaries as runtime behavior: the server
owns durable state and processes, the clients use the public client API, and the
TUI shell composes capability modules. Use the
[architecture overview](overview.md) to choose an owner before changing a concern;
[AGENTS.md](../AGENTS.md) remains the contribution-policy authority.

## Entry points and local work

Use Bun for dependencies/scripts. The repository declares the package manager in
[package.json](../package.json); each package is private in the Bun workspace.
Typical local entry points are `bun run dev` for watched TUI startup,
`bun run cli -- <command>` for explicit CLI commands, and `bun run server` for
direct daemon startup. `bun run build` compiles `src/main.ts` to
`dist/work-craft`; `build:install` also runs the installer.

Use a separate `WORK_CRAFT_HOME` for disposable development state so experimental
schema/runtime work does not share the normal instance. Clients and daemon must
use the same state directory. A client automatically reuses a healthy daemon,
so changing source and launching another client does not replace an already
running server. Deliberately stop the instance before expecting new daemon code
to take effect. `daemon stop` retains state; `daemon destroy --force` deletes it.

`CONTROLS_DEMO=true` and `COMPONENTS_DEMO=true` select reusable control/component
demos at the TUI entry point. They are presentation exploration paths, not the
product's normal daemon-connected shell. `db:seed` supplies a development seed
script; read [seed.ts](../scripts/seed.ts) before choosing a target state directory.

## Existing verification gates

These are the repository's established gates, not a claim they were run while
writing this documentation. Choose focused tests by ownership and preserve the
policy in AGENTS.md.

- `bun run check` runs lint, format check, typecheck, and core tests. `bun run test`
  and `test:core` select the same core gate.
- `bun run test:acceptance` runs explicitly classified process/database/product
  acceptance files. CI runs this plus compiled build/smoke on Linux and macOS.
- `bun run test:tooling` runs compatibility/feasibility/support tests classified
  separately and selected by a dedicated path-sensitive workflow.
- `bun run check:all` runs static checks, core plus acceptance tests, build, and
  smoke. Despite the name, `test:all` selects core and acceptance, not tooling;
  tooling remains its own gate.
- Focused work uses `bun test` with explicit paths. The gate runner discovers
  correctness files, defaults new files to core, and validates classified
  exceptions. Diagnostics and benchmarks are not silently included as tests.

[CI](../.github/workflows/ci.yml),
[test tooling](../.github/workflows/test-tooling.yml), and
[release](../.github/workflows/release.yml) define actual automation. Release
packaging runs `check:all` and produces one archive/checksum per supported target.
[lefthook.yml](../lefthook.yml) defines staged formatting/lint/typecheck and push
checks; repository policy distinguishes checkpoints from complete certification.
Do not infer a full acceptance pass from a local commit.

## Ownership and useful investigation paths

Application selection/item/directory tests live with their server owner. Real
SQLite and subprocess boundaries matter where durability and lifetime are the
risk. TUI `client`, `navigation`, `workbench`, `shell`, and reusable UI tests remain
with those owners; package-wide acceptance and shared support live in
`packages/tui/src/tests`. Import restrictions and their focused boundary tests
protect client-safe server imports and shell/UI direction.

Use [test-gates.ts](../scripts/test-gates.ts) for exact gate membership and
[run-bounded.ts](../scripts/run-bounded.ts) for bounded process fixtures and
`testProcessEnvironment`. Detached fixtures must preserve
`WORK_CRAFT_TEST_RUN_ID`, as required in AGENTS.md. When collecting shell logs,
mirror both output streams with `tee` and preserve failure propagation as that
policy specifies.

For terminal compatibility, inspect
[probe-opentui-compatibility.ts](../scripts/probe-opentui-compatibility.ts) and the
owning projection/input tests before selecting a diagnostic. Instrumentation
modules under server terminal, TUI client, and the client-safe output-probe export
cover stages from PTY output through store/material/render. They diagnose timing
and budgets; they do not alone establish visible terminal fidelity.

Specs and plans live in repository-root `.superpowers/` according to AGENTS.md.
They describe work in progress; this architecture tree describes current
implementation. Keep README focused on user onboarding/features, and update the
owning current document when behavior or a useful source reference changes.

[Parent: Overview](overview.md) | [Previous: Choices](choices/overview.md)

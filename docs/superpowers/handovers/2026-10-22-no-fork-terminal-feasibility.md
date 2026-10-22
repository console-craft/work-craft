# No-Fork Terminal Feasibility — 2026-10-22

## Scope And Current Status

Native execution of the approved feasibility plan, based on PR #41 at
`9cba83769685a72c96bc8382ac107262cc7b3f4a`, on the separate
`feat/no-fork-terminal-performance` branch. Production dependencies and source
remain unchanged. This is not a completed fork removal or performance claim.

The user permits unsupported hyperlink destinations and a slight slowdown versus
#41, but no major performance regression or hidden functionality loss. No private
forks, dependency-source edits, method replacement or private-handle access.
See the [design](../specs/2026-10-22-no-fork-terminal-performance-design.md).

## Reproduce The Upstream Contracts

```sh
bun test scripts/probe-no-fork-terminal.test.ts
bun scripts/probe-no-fork-terminal.ts contracts /absolute/owned/artifact-directory
```

The opt-in launcher installs exact registry OpenTUI core/React 0.6.6 and React
19.3.0 into a fresh independent consumer. It externalizes native/React imports,
checks actual resolution, verifies React shares core and rejects the fork's input
hook. Each run retains `bun.lock`, the emitted test, provenance, install/test logs
and `result.json`. It never modifies application dependencies or installed source.
Normal tests need no network. Failed runs retain diagnostics too.

Initial launcher tests: six behavior failures against no-op implementations,
then six pass/21 assertions. Isolated registry contracts: seven pass/21 assertions.
One initial paste assertion expected literal ESC; native paste encoding sanitizes
it to a space. The corrected characterization requires native paste output, not
child mouse input; this is existing native behavior, not an app-side filter.

The contracts fixture lives under `workbench/tests/` rather than root scripts:
that is its capability owner and TypeScript already resolves OpenTUI there.
The script exposes small manifest/path/core-identity/owned-command checks so real
filesystem and timeout behavior can be tested without a network/process mock.

## Baseline And Local Evidence

Before source changes, a default cached install yielded 1,795 pass/14 skip/two
native-contract failures. The installed core bundle hash differed from the
committed tarball. Frozen installation with an isolated cache restored matching
hashes and both focused contracts. Full baseline then passed 1,797 tests/14 skips,
zero failures, types/lint/format, build and compiled relocation smoke. Existing
lint and React-act warnings remain. Linux CI failures from #41 are not repaired
or waived by this macOS baseline.

Machine-local evidence root:
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/no-fork-feasibility-evidence/`.
Initial registry run `contracts-WbqzhM` records the paste-expectation mismatch;
`contracts-vQrcmV` records the passing seven cases. Portable source is committed;
these local paths are evidence locations, never dependency paths.

## Remaining Work

- Falsify the smaller client-parser route, including mouse/focus during resize.
- Investigate daemon-owned public parsing only if the smaller route fails.
- Compare performance only after a route preserves the required behavior.
- Run full checks and one independent connected review; record all limitations.
- No production cutover, push, merge, real-daemon restart or installed-app change.

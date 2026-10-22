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

## Client Candidate A — Rejected

`workbench/tests/no-fork-client.fixture.tsx` is an intentionally rejected test-only
prototype, not production code. Run the launcher with route `client`; it must
currently exit nonzero. Its preserved correctness assertion is not skipped or
converted to an expected failure in the default suite.

The initial no-op parsing control failed both tests. Immediate pane-local parsing
in <=8-KiB writes makes ordinary key/paste/mouse/focus ordering pass. During a
canonical resize, parsing correctly waits for the native grid callback. Global
listeners defer keys/paste without replacing methods, and physical blur remains
synchronous. However, the stock mouse/focus encoders run while their new modes
are still unparsed. After resize, observations are:

```json
{
  "beforeCommit": [],
  "afterCommit": ["\u001bOA", "\u001b[200~paste\u001b[201~"],
  "physicallyBlurred": true
}
```

The missing required bytes are `ESC[<0;3;2M` and `ESC[O`. Local evidence
`client-pvkKhP` is the initial red control; `client-s5U1su` has one pass/one fail
and `client-observation.json`. The latter rejects **this immediate-parser/global-
capture candidate**, not every possible client-side design. A more invasive
app-owned terminal/input implementation remains a different design, not something
proven impossible here.

Per the stop rule, full input invalidation/overflow/fairness/selection/load cases
were not implemented on this already rejected prototype. Its held callbacks are
only diagnostic scaffolding, not a reusable bounded input queue or a production
candidate. No performance equivalence is inferred from its ordinary-input pass.

## Daemon Candidate B — Material Gate Blocked

The registry-only `daemon` route reuses the existing checked public-context
projection fixture. Three primitive cases pass: mode retention after more than
1 MiB raw output, viewer-local browsing without mode changes, and exactly one
live query reply despite composing two viewer frames. These do not certify a real
PTY/client round trip or semantic event translation.

A fourth, hyperlink-free case fails before JSON transfer or client drawing:

```text
Input: ESC[1;8;48;2;68;85;102m 界 ESC[0m N
       (no spaces surrounding the wide character in the actual bytes)

Material cell       #41 attributes/background       Registry attributes/background
first hidden cell   65 / RGB(68,85,102)              65 / RGB(68,85,102)
second hidden cell  65 / RGB(68,85,102)               0 / default black
following N          0 / default black               0 / default black
```

This is not hyperlink support: SGR 1 is bold, SGR 8 is invisible, and the visible
symptom is a one-cell background/style discontinuity. Registry material has
already turned the wide character into two spaces and lost the second cell's
attributes. Painting the supplied cells faithfully cannot restore missing data;
guessing that every following blank inherits the prior style would corrupt
legitimate unstyled blanks. No claim is made that every other public native API
or a different application rendering design could never address it.

Local evidence `daemon-ym3CQC` has three pass/one fail plus the exact material
JSON. A separate same-input check using #41's installed parser confirms
attributes `[65,65,0]`; registry yields `[65,0,0]`. The failing assertion remains
enabled. No URL assertion was involved or weakened.

Per the design's early stop rule, there is no fabricated end-to-end success:
the real-PTY/two-client projection leaf, full selection/copy, key-event translation,
authority-race suite, cold recovery, large-frame transfer, compiled probe and
capacity/performance comparisons were not built/run after the source gate failed.
The existing primitive tests and implementation remain reusable if this extra
upstream rendering limitation is explicitly accepted or a released fix appears.

## Remaining Work

- Resolve the additional invisible-wide styling limitation before selecting B.
- Compare performance only after a route preserves the agreed behavior.
- Run full checks and one independent connected review; record all limitations.
- No production cutover, push, merge, real-daemon restart or installed-app change.

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
# These two deliberately fail at preserved correctness gates:
bun scripts/probe-no-fork-terminal.ts client /absolute/owned/artifact-directory
bun scripts/probe-no-fork-terminal.ts daemon /absolute/owned/artifact-directory
```

The opt-in launcher installs exact registry OpenTUI core/React 0.6.6 and React
19.3.0 into a fresh independent consumer. It externalizes native/React imports,
checks actual resolution, verifies React shares core and rejects the fork's input
hook. Native-library asset overrides are rejected for every child command;
provenance includes the platform library's canonical path, version and SHA-256.
Artifact directories must be outside any ancestor Bun workspace (symlinks are
canonicalized). Each run retains `bun.lock`, the emitted test, provenance, install/test logs
and `result.json`. It never modifies application dependencies or installed source.
Normal tests need no network. Failed runs retain diagnostics too.
Owned process groups are stopped after success, failure, timeout and caught
SIGINT/SIGTERM cancellation, including when a leader exits before its descendants.

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

## Recommendation And Measurement Status

**No tested candidate qualifies for production planning under the current
compatibility contract.** Keep #41 unchanged. The smallest useful next decision
is whether the invisible-wide styling loss is acceptable for further B research,
or whether to wait for an unmodified upstream release fixing it. Accepting that
limitation would authorize more feasibility work, not certify B or authorize a
production cutover. Other public extraction/rendering designs remain unexplored.

| Measurement                                                | Result                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Candidate/control workload parity                          | Not established; no correctness-eligible candidate        |
| Input/visible latency p95, p99, max                        | Not measured                                              |
| Missing observations                                       | No performance sampling session; not zero missing samples |
| Longest blocking turn / per-role RSS                       | Not measured                                              |
| Three serial burst / Neovim comparisons                    | Deferred after correctness failure                        |
| 50-pane/ten-producer capacity / soak                       | Not run                                                   |
| Compiled no-fork consumer / Linux / physical terminal pair | Not validated                                             |

No workload rates, deadlines or capacity budgets were changed. The existing real
paused-TUI readiness test remains intact and passed a focused rerun. Pasted
protocol-shaped input is covered by the registry contracts. An assert-based
self-check confirmed `latencySummary([20, null]).p95 === null`. New performance-
harness work is deferred with comparison itself; there is no healthy percentile
or performance-equivalence claim to infer here.

If B later passes feasibility, the production change would reach daemon runtime
ownership under `packages/server/src/terminal/`, server/client protocol contracts,
and the TUI's `workbench/terminal-pane.tsx`, `terminal-viewport.tsx`,
`terminal-input.ts` and output-consumption owners. Selection/copy and local
scrolling would need an app-owned material view; authority/recovery tests,
dependency resolution, vendor verification and compiled packaging would also
need updates. This is an impact map, not an approved implementation design.

## Final Verification

Fresh post-fix `bun run check` passed on macOS: 1,808 tests, 14 skips, zero failures,
plus artifact verification, lint/format/types, build and relocated compiled smoke.
This validates the unchanged fork-backed application, not a fork-free build.
Registry reruns retained under `contracts-iuB3ZT` (7 pass), `client-5BY89v`
(1 pass/1 fail, same missing mouse/focus) and `daemon-9pXneF` (3 pass/1 fail,
same invisible-wide gap). Rejected route commands intentionally exit nonzero.

### Independent Review And Fix Pass

One read-only review covered `9cba837..cf7473a`. It found no Critical or Minor
issues and three Important launcher defects, all retained at that grade:

- An inherited `OTUI_ASSET_ROOT` could load #41's native library beneath stock
  JavaScript. Fixed by rejecting the override before every child command, with
  native-library provenance recorded. Regression: an override cannot execute even
  a marker-writing child.
- An exited leader could leave descendants alive. Fixed by stopping the owned
  group on every outcome and caught cancellation. Regressions cover exit 0,
  exit 7 and SIGTERM, alongside the existing timeout/unrelated-process test.
- An artifact directory inside a Bun workspace could modify its ancestor lockfile
  before provenance failed. Fixed by rejecting canonical workspace ancestors before
  installation. Regression covers a symlink into an owned workspace and an
  unchanged ancestor lockfile, without network access.

The five new regressions failed before the fixes; all 11 launcher tests then
passed (30 assertions). No second reviewer was dispatched. Hardened registry
runs retain `contracts-lrx3uO` (7 pass), `client-aELMBW` (same mouse/focus loss)
and `daemon-BUxpxL` (same invisible-wide loss). Native provenance records registry
0.6.6, not #41's library. The review independently reproduced B's clean-environment
failure; the contamination vulnerability does not invalidate that blocker.
A real override pointing at this checkout's patched native assets was also
rejected before installation (`daemon-ISI560`).

Review scope exclusions remain explicit: A's unimplemented lifecycle/authority/
resource suite and B's PTY/client/translation/recovery/resource/compiled suite are
deferred after correctness failure; performance/platform/manual acceptance has
not been inferred. Other public designs remain unexplored. Only hyperlink
destination preservation was waived. There are no deferred review minors.

No production cutover, push, merge, real-daemon restart or installed-app change.

### Existing Readiness-Test Instability

After the green full check, the normal commit hook reported 1,807 pass/14 skip/
one failure in `terminal focus readiness cannot reuse a cursor shown before the
entry gesture`; a focused retry also failed. Five isolated diagnostic repetitions
then passed four times and failed once. The failing repeat emitted zero new TUI
bytes after SIGCONT while the old cursor stayed visible: readiness properly
refused the stale cursor, but repeating an already-focused entry did not force a
fresh cursor report. This is a pre-existing harness completion dependency, not a
no-fork candidate result. The test, assertion and deadline remain unchanged; a
deterministic readiness handshake remains necessary before future comparisons.
Normal hooks are not bypassed.
The launcher-fix commit's normal-hook retry passed the full suite; the initial
failure is retained as evidence, not erased by the later green result.

## Execution Decisions

The native execution ledger made these scope decisions, in order:

1. Stop a candidate at a concrete correctness failure instead of benchmarking it.
   Risk: other viable variations remain unexplored; neither failure proves
   upstream-only implementation impossible.
2. Preserve reproducible source/evidence summaries here before deleting execution
   scratch. Risk: raw machine-local logs still require retained external artifacts
   or rerunning the probes.
3. Keep the contracts fixture in its workbench capability owner for dependency
   resolution. Reversing this costs one fixture move.
4. Export narrow script-only manifest/path/core-identity/process checks to test real
   boundaries without network mocks. Cost: a small additional test API surface.
5. Reject A on missing mouse/focus without implementing unused queue/fairness cases.
   Risk: a different, more invasive client design remains untested.
6. Verify the exact rejection observation for task completion, not a green candidate
   assertion. Risk: the task is only valid while that failure is reproducible.
7. Check B's source material using the existing public-context fixture before a
   real PTY/socket/client leaf. Risk: other public extraction routes are untested.
8. Preserve B's failing assertion and defer PTY/client/selection/translation/
   large-frame/compiled/performance work rather than silently accept style loss.
   Cost: feasibility remains blocked, not a delivered fork-free product.
9. Defer new performance-harness work and serial/capacity comparisons
   without a correctness-eligible candidate. Cost: speed and memory remain unknown.

The review's five explicit exclusions were also retained as rulings: A's deferred
cases still gate any later A adoption; B still requires end-to-end proof; platform
and performance acceptance remain unknown; unexplored public designs are not
ruled out; and only hyperlink destinations were waived. Their corresponding
risks are incomplete future acceptance, not permission to ship the prototypes.
One later ruling leaves the pre-existing readiness redraw dependency explicit
rather than changing the harness in a blocked experiment; the cost is intermittent
test failure and a remaining prerequisite for trustworthy performance work.

# Output Lifecycle Measurement Gate

## Status

Measurements recorded; independent final review pending. No production
performance fix or recovery architecture approved.
See the [approved measurement specification](../specs/2026-10-21-output-lifecycle-design.md).
Execution is native on `feat/shared-session-navigation`, starting at `3298450`.
The existing burst assertions and native response/input authority remain unchanged.

## Reproduction Environment

- macOS 27.0.1 (26A434), Apple Silicon, 16 GiB RAM.
- Bun 1.4.3; installed OpenTUI 0.6.6; Neovim 0.12.4.
- OpenCode executable available at `/Users/ovi/.opencode/bin/opencode`.
- Before serial baseline: swap allocation/usage zero; `memory_pressure` reported
  57% system-wide memory free (not a guarantee of unpressured application scheduling).
- All application tests use owned temporary homes/daemons/children; the user's
  default daemon and existing programs are untouched.
- Artifact directory for this machine/session:
  `/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/output-gate-YDzjHE`.
  This is not a portable path or production setting. Environment snapshots,
  individual test logs, metrics and run statuses live there.

## Baseline Protocol

Run serially, three repetitions each:

```sh
WORK_CRAFT_BURST_METRICS="$PROFILE_DIR/burst.jsonl" bun test packages/tui/src/tests/terminal-burst.test.ts
bun test packages/tui/src/tests/shared-session.test.ts -t 'Neovim page jumps'
bun test packages/tui/src/shell/tests/pane-operations.test.tsx -t 'same-epoch tab context changes retain restart protection'
```

Then run the full `pane-operations.test.tsx` file once. Preserve every result,
including timeouts; do not rerun until green or classify an intermittent failure
as harmless. Results and the later attribution/feasibility decision follow below.

The first baseline launcher attempt rejected Bun's unsupported `stderr: "stdout"`
configuration before any test child started; the corrected launcher uses one
opened file descriptor for both streams. This was a runner setup error, not a
product test result.

## Serial Baseline Results

| Run | Burst maximum input-to-visible | Peak daemon RSS | Peak TUI1/TUI2 RSS | Neovim rollover     |
| --- | ------------------------------ | --------------- | ------------------ | ------------------- |
| 1   | 8,904.14 ms (fail)             | 81.5 MiB        | 713.6 / 709.5 MiB  | pass, 82 assertions |
| 2   | 10,081.80 ms (fail)            | 90.4 MiB        | 798.4 / 792.9 MiB  | pass, 82 assertions |
| 3   | 9,320.45 ms (fail)             | 90.1 MiB        | 806.9 / 799.8 MiB  | pass, 82 assertions |

All burst runs reached their unchanged final latency assertion after both
clients' final pane-frame/cursor, convergence and child-liveness checks. Four
of eight probes per run were issued before producer 0 completed. This is finite
RSS observation, not evidence of a leak or an isolated bottleneck.

The focused pane-operations group passed 3/3 cases in each of three runs; the
whole file passed 193/193. The earlier missing Reactivate button did not reproduce
in these runs. Cause remains unclassified; no repair was made.

Startup-failure injection intercepted the first fixture-owned TUI spawn after
the daemon started: the fixture rejected the injected error, the owned daemon
exited and its temporary home was removed. No runtime/home cleanup gap was
demonstrated. The standalone `bun -e` observer printed those successful assertions
but did not exit within its 120-second tool timeout; Bun's ordinary test runner
does not exhibit that observer shutdown behavior. Do not count the observer as
a clean process-exit test. No real-state cleanup was performed.

## Probe Verification

Temporary probes are disabled without an explicit owned diagnostic directory and
role. Enabled probes retain at most 32,768 metadata-only events, aggregate later
observations, and flush outside measured intervals on fixture-owned `SIGUSR2`.
Overflow or a missing completed footer invalidates detailed attribution.
No terminal text, key values, credentials or public protocol fields are logged.

Recorder and real normal-entrypoint flush coverage passed; the connected client,
native workbench, server client and HTTP group passed 161 tests/889 assertions.
Type checking passed. The fresh full `bun test` reached completion in 176.47 s:
**1,685 pass, 1 fail**, across 120 files. The sole failure was the unchanged burst
latency maximum at **9,203.35 ms**. This is not a claim of product repair.

For diagnostic checkpoint commits only, the pre-commit full-test job is excluded
because the documented baseline is red; formatting, lint, types and commit-message
hooks remain enabled. Explicit task checks and final full verification are still
required. This exception must not be mistaken for passing CI or merge readiness.

## Native Continuation And Recovery Feasibility

The enabled characterization suite passed **10 tests / 14 assertions** on the
installed OpenTUI 0.6.6. It compares uninterrupted versus byte-split parsing for
UTF-8, CSI/OSC, alternate screens, saved cursor, scroll regions, wrapping, styles,
paste/application-cursor modes and query reply bytes. Style comparisons use the
test renderer's public `captureSpans()`, not text alone. Two resizes at the same
byte cursor preserve continuation in the tested case. A headless mouse test
verifies the exact SGR mouse encoding after byte-split mode instructions.

The negative control is decisive: after a mode-setting prefix is older than the
1 MiB raw tail, full parsing and reset-plus-tail produce **the same visible text
but different next-paste bytes**. A screenshot or raw tail is not full VT state.
These narrow cases are not certification of arbitrary VT extensions.

| Capability                                         | Result                                                                  | Evidence / boundary                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Keep one native instance and parse every byte      | Proven for the tested continuations                                     | Native instance remains authoritative; no history loss in its parser                                                                  |
| Exact recovery using bounded raw tail alone        | Failed                                                                  | Equal text, unequal paste mode after old prefix is lost                                                                               |
| Supported full VT state export/import              | Not found in installed public wrapper/ABI declarations and shipped JS   | No claim that an underlying native implementation could never support it; native Zig sources are not shipped here                     |
| Headless daemon parsing/query replies              | Proven primitive                                                        | Public `resolveRenderLib()`, context/embedded-terminal allocation, write, compose and response drain work without a terminal renderer |
| Headless screen observation                        | Proven cursor after composition; further projection feasibility remains | `contextEmbeddedTerminalCursor` is a composed cursor cache: before composition it has no value, not evidence that parsing failed      |
| Per-client hidden parser memory at target capacity | Not yet measured                                                        | Do not extrapolate from the finite four-pane RSS samples                                                                              |

Concrete API references: installed `zig.d.ts` lines 999–1028 expose terminal
allocation/write/resize/compose/cursor/key/mouse/paste/response functions; lines
1123–1150 expose buffer allocation, leases and resolved character extraction.
The corresponding shipped `chunk-bun-jztcnb74.js` calls the native
`ot_embedded_terminal_*` ABI. `EmbeddedTerminalRenderable` exposes no supported
full checkpoint export/import method. Do not scrape private handles or patch
installed dependencies as an implicit implementation decision.

The headless result keeps a daemon-owned parser/current-screen projection option
open: a live daemon could retain full parser state and send disposable clients
rendered state instead of pretending a cell snapshot restores a client parser.
That would explicitly change response/input encoding ownership and protocol;
it is a candidate for the measured amendment, not approved production work.

## Frozen Comparison Results

The three direct/native control runs and three application controls plus three
traced application runs completed serially. Every run used the same 80x24 child
grid, 4 KiB/100 ms synthetic redraw workload, 10-second warm-up and 200 inputs at
an intended 100 ms cadence. No samples were missing. The application attribution
comparison uses one normal client (the second fixture client is stopped), whereas
the burst/capacity cases exercise two. Source checkpoint: `f3c9067`; artifacts are
the named `*-control-*` / `application-traced-*` subdirectories.

| Path                        | Input-to-child p95, three runs | Input-to-visible p95, three runs | Input-to-visible p99     |
| --------------------------- | ------------------------------ | -------------------------------- | ------------------------ |
| Direct PTY                  | 0.291 / 0.305 / 0.236 ms       | Not observed (no host display)   | Not observed             |
| Native embedded terminal    | 0.322 / 0.286 / 0.286 ms       | 19.00 / 20.14 / 19.65 ms         | 23.14 / 23.48 / 23.63 ms |
| Work Craft, probes disabled | 8.71 / 8.80 / 7.52 ms          | 29.65 / 30.24 / 29.74 ms         | 36.08 / 36.41 / 34.30 ms |
| Work Craft, probes enabled  | 7.63 / 8.74 / 8.21 ms          | 29.08 / 30.69 / 29.12 ms         | 34.95 / 36.51 / 36.54 ms |

This small workload is healthy; it does **not** reproduce the user's real editor
pair or establish the 50-pane capacity target. Probe overhead on this workload
was within the observed run-to-run variation, not proven zero. Native/direct
paths do not import production recorders, so repeating an identical 'traced'
variant there would not measure their overhead. Their observer costs are reported
separately: native `write()` envelopes totalled roughly 63–64 ms per run; the
application's outer emulator envelopes totalled 15–16 ms per run. These are
different amounts of emitted output and are not interchangeable CPU benchmarks.

The original comparison artifacts' application `rawBytes` field incorrectly
counted the outer rendered stream, unlike the PTY counts in direct/native modes.
No throughput conclusion above uses that field. The collector now separates
daemon raw-cursor bytes from `outerBytes`; the application fixture test verifies
the static redraw stream is larger than its rendered updates. Original artifacts
are preserved rather than rewritten with invented raw counts. Latency and RSS
samples were independent of that reporting field.

Sampled RSS maxima: one application client process tree 369–377 MiB; daemon
53–58 MiB. The harness grew across sequential test runs (about 55–138 MiB in the
sampled process) and is reported separately, not charged to either application
client. Sampling before/after a run does not establish an unsampled absolute peak.
Child receipt timestamps use the same-host `performance.timeOrigin` wall mapping;
raw latency is not skew-corrected. Results retain per-probe clock brackets and
their uncertainty. Millisecond-scale cross-process attribution is limited by that
uncertainty; the multi-second burst delay is not explained by it.

## Correlated Burst Evidence

The unchanged four-pane burst also ran with probes enabled. Maximum latencies
were 10,279.93 ms, 7,179.82 ms and 5,414.85 ms, all failures. This variation is
retained, not selected for a favourable baseline.

The first trace overflowed its 32,768 detailed-event slots in both native/client
recorders; only its aggregate totals may be used. To obtain complete correlation
without increasing the budget, later probes deliberately aggregate empty replay
planning and retained-buffer samples. They still count every observation, duration
and high-water; the footer explicitly reports aggregated observations. Byte/grid
delivery and native write events remain detailed. Overflow still invalidates a
trace. This is metric aggregation, never dropped terminal instructions.

All five component traces in `burst-traced-3` completed with valid footers, zero
discarded observations and 4,325 matched output cursor intervals per viewer:

| Measurement                                         | Viewer 1  | Viewer 2  |
| --------------------------------------------------- | --------- | --------- |
| Daemon-read → native-write p50                      | 2,832 ms  | 2,760 ms  |
| Daemon-read → native-write p95                      | 6,765 ms  | 6,609 ms  |
| Daemon-read → native-write maximum                  | 7,279 ms  | 7,122 ms  |
| Synchronous store apply envelopes, total            | 401 ms    | 383 ms    |
| Store apply including scheduled continuation, total | 11,444 ms | 11,315 ms |
| Native replay planning, total                       | 2,550 ms  | 2,478 ms  |
| Native writes, total                                | 88 ms     | 87 ms     |
| Native scene time sampled at frame events, total    | 229 ms    | 232 ms    |

These timers overlap; **do not add the rows together**. The scheduled apply
envelope can include React/scheduler/GC work before its continuation executes;
it is not 11 seconds of synchronous buffer insertion. Direct store listener
notification itself totalled only about 13 ms per viewer. Frame intervals are
wall-time cadence, not CPU render duration. The scene statistic is a native
renderer observation, not a complete React commit measurement.

The daemon read the workload's bulk bytes over about 3,952 ms. Its history append
envelopes totalled 11.6 ms, message encoding 6.8 ms, and snapshot reads about 30 ms
over the whole run. The two application transport queues peaked at two callbacks,
while the server-side socket backlog reached about 3.58 MiB for a peer. The delay
is therefore not an HTTP recovery wait in this run: each viewer fetched one
startup snapshot, had four native instances without recovery churn, and parsed
all final bytes. A fast-looking JavaScript queue does not imply a fast client:
scheduled client work can delay socket receipt itself.

There were 18,355–18,363 replay planning calls for 4,325 native byte writes. The
leading hypothesis is amplification through whole-application output publication
and retained-range replay, with substantial client-side work scheduled between
apply and continuation. Exact division among React reconciliation, JS allocation/
GC and replay is not yet isolated. A one-variable notification-cadence experiment
is required before selecting that mechanism as the performance fix.

Producer write-call timestamps were not present in the historical burst program;
the fixed producer cadence, daemon byte/cursor observations and final producer
completion provide its bounded workload reference. No claim of exact per-write
producer scheduling or physical WezTerm latency is inferred from that test.

## Capacity Attempt: Failed, Soak Incomplete

The frozen 50-pane topology ran with two normal clients, 10 synthetic interactive
programs and eight hidden 4 KiB/100 ms producers. The first item is the original
fixture's generic Design surface; the other nine are registered Coding directories.
This exercises actual shared runtime/navigation paths, not real Git worktree
discovery cost or 10 real editor/AI sessions.

| Phase                              | Observation                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial 40 idle shells, 200 probes | All 200 inputs reached the child; child latency p95 43.51 ms, p99 55.07 ms, max 76.19 ms. 16 visible observations missing; full-sample visible p95 is unbounded, not a percentile of only successes |
| 100 switches                       | One destination not observed within four seconds; presentation p95 3,197.97 ms. This is not proof of input-ready switching; subsequent child input was not probed after every switch                |
| Paused mirror, 20 probes           | All 20 child/display observations missing. Input readiness after the preceding navigation was not independently established, so this does not isolate the effect of the paused peer                 |
| Forty stopped panes, 200 probes    | All 40 exits were confirmed, but native terminal entry timed out and all 200 child/display observations were missing. This phase is an input-readiness failure, not a valid latency distribution    |
| Planned 10-minute soak             | Recorded through 499,058 ms (8 min 19 s), then a daemon request timed out. Whole case ran 862 s including setup/switches/earlier probes; it did not complete the soak                               |

Sampled process-tree RSS already reached about 967 / 983 MiB per client at the
initial idle-shell phase (harness 107 MiB), before the first periodic trace flush.
After switching, the first client reached about 1,892 MiB, then 2,081 MiB after
the mirror phase. The other client reached about 1,520 MiB in later samples.
Daemon sampled maximum was about 236 MiB. These exceed the client target; no
memory plateau or leak diagnosis is certified. Ten producer PIDs' combined RSS
was recorded separately (roughly 155–196 MiB), not included in client/daemon RSS.

Resource pressure became substantial: swap went from zero before the gate to
4,875.56 MiB used after the capacity attempt. No reboot, purge or user-process
termination was performed. Later `process.memoryUsage().rss` probe values were
inconsistent with contemporaneous `ps` RSS (including values larger than physical
RAM); resident-budget comparisons use the sampled `ps` values, not those probe
RSS numbers. The sudden later drop in sampled RSS is not evidence of repair.

Two harness defects were discovered and corrected after this failed attempt:

- Flush completion reread whole growing trace files. Later logs reached roughly
  46–59 MiB per component and the harness itself reached about 393 MiB in a sample.
  This can add observer pressure; the corrected completion check reads at most a
  64 KiB tail and tests incomplete append versus a genuinely new footer.
- A failed health lookup used PID 0 as a sentinel. An ancestry walk from zero is
  not an ownership check. Flush now rejects invalid/root PIDs before inspecting
  manifests; the caller omits an unknown daemon instead of inventing its PID.
  The known daemon, both native TUI and all ten producer PIDs were verified exited
  after cleanup. No unrelated process signalling was observed.

The later capacity traces overflowed their detail bounds; only aggregate counters
may be used from those windows. They show repeated global snapshot recovery and
thousands of pending transport callbacks under pressure, unlike the simpler burst
case. Native writes remained a small timed envelope compared with scheduled apply
and replay planning. These aggregates are not a complete correlated timeline.

The primary capacity/memory failures precede the growing-log reader problem, but
the defects and host pressure prevent treating this as a clean sustained-capacity
benchmark. No passing 10-minute soak is claimed. Repeating it until green without
addressing the measured amplification would not be a product repair.

## One-variable Counterfactual: Output Publication Cadence

After the capacity fixture was gone, controls and the experiment ran serially on
the same laptop without reboot, purge or stopping user programs. The temporary
patch changed only pure-output subscriber notification: state/authorization still
updated synchronously on every chunk, metadata notifications remained immediate,
and output notifications coalesced on a 50 ms timer. No bytes, markers, input
validation, producer cadence, native writes or acceptance assertions were removed.

| Run                         | Maximum input-to-visible | Sampled TUI RSS | Probes during production | Result                  |
| --------------------------- | ------------------------ | --------------- | ------------------------ | ----------------------- |
| Control A                   | 10,697.29 ms             | ~798 MiB each   | 4/8                      | fail                    |
| Temporary cadence B, first  | 86.96 ms                 | ~200 / 201 MiB  | 8/8                      | pass, all 29 assertions |
| Temporary cadence B, second | 91.18 ms                 | ~206 / 206 MiB  | 8/8                      | pass, all 29 assertions |
| Restored control C          | 9,169.38 ms              | ~789 / 787 MiB  | 3/8                      | fail                    |
| Restored control D          | 11,865.63 ms             | ~768 / 772 MiB  | 3/8                      | fail                    |

The exact temporary diff is preserved in the artifact directory as
`notification-experiment.patch` (also held in the plan's ignored workspace while
executing). It was removed with a targeted inverse patch;
`git diff --exit-code -- packages/tui/src/client/store.ts` confirmed restoration
before controls C/D. Nothing from the timer experiment is shipped.

This strongly supports output-publication/reconciliation/replay amplification as
a causal mechanism for this workload's stalls and allocation pressure. It does
not isolate every React/GC/native allocation, establish a leak, or certify the
timer for every authority/recovery race. The production recommendation is a
separate pane output path with bounded scheduling, not a global 50 ms delay.

All three final standalone Neovim rollover runs passed, 82 assertions each.
The three final pristine burst controls A/C/D remained red, as expected from an
unfixed product. A passing counterfactual is not a passing branch.

## Headless Capacity Primitive

A separate, assertion-checked disposable native-context probe created 50 terminal
parsers at 80x24 with the existing 10,000-line scrollback setting, kept ten active
for 100 ticks at 100 ms cadence, and parsed 4,096,000 raw bytes. All 50 answered
fresh device queries. Total native write envelopes were 201.98 ms; sampled RSS
rose from 44.97 MiB to 66.66 MiB in that standalone process.

This is a promising primitive for daemon ownership, not a daemon capacity test:
it excludes SQLite/history, PTYs, transport, frame serialization and the client.
The public native buffer-lease characterization additionally resolves Unicode
text without exporting parser handles. Complete glyph/style projection, physical
cursor/input integration and compiled packaging still need an end-to-end
feasibility gate before any production cutover. No serializer, dependency install
or alternative emulator was introduced by these experiments.

## Real Application And Physical Limits

Neovim 0.12.4 rollover is exercised through the normal application; OpenCode
v2.1.1 is installed. No paid provider request was made. Real OpenCode popup flows,
the configured Neovim/OpenCode pair in WezTerm, physical flicker and Linux were
not certified. Those remain explicit acceptance work after the approved changes;
deterministic producers cannot substitute for them.

## Reproduction Commands And Remaining Gate

Create a fresh owned `$PROFILE_DIR` under the approved temporary root; do not
reuse another running profile's directory. Full capacity is opt-in and can cause
substantial CPU/memory pressure on the unfixed branch. Run experiments serially.

```sh
WORK_CRAFT_OUTPUT_PROFILE_DIR="$PROFILE_DIR" bun test packages/tui/src/tests/output-profile.test.ts -t 'output profile comparison' --timeout 1200000
WORK_CRAFT_OUTPUT_PROFILE_DIR="$PROFILE_DIR" bun test packages/tui/src/tests/output-profile.test.ts -t 'fifty-pane capacity' --timeout 1200000
WORK_CRAFT_OUTPUT_PROFILE_DIR="$PROFILE_DIR" bun test packages/tui/src/workbench/tests/terminal-continuation.test.ts
WORK_CRAFT_OUTPUT_PROFILE_DIR='' bun run check
```

The headless primitive's assertion-checked source is preserved alongside its
result as `headless-50-probe.ts`. From the repository root it can be repeated
without installation or application state:

```sh
bun "$PROFILE_DIR/headless-50-probe.ts" "$PWD" "$PROFILE_DIR/headless-50-repeat.json"
```

The notification counterfactual requires the preserved temporary patch; do not
treat it as the production solution or leave it applied for verification. The
approved [spec's proposed measured amendment](../specs/2026-10-21-output-lifecycle-design.md#measured-architecture-amendment--proposed-not-approved)
is the next user decision. No production cutover or merge is authorized by this
diagnostic report.

## Final Verification Before Independent Review

- Latest `bun run check` completed lint, formatting and type checks. Full tests:
  **1,698 pass, 14 intentionally gated skips, 1 fail**, 123 files, 190.36 s.
  Sole failure: unchanged four-pane burst maximum **9,662.19 ms**. The prior full
  check also had only that failure (12,368.94 ms); no green suite is claimed.
- The 14 default skips are four opt-in performance cases and ten native
  characterization cases. The ten enabled native cases separately passed all
  14 assertions; the performance results/failures are documented above.
- Compiled `bun run build` and isolated `bun run build:smoke` passed separately,
  since the expected test failure prevents the full check reaching them.
- The pre-existing server `no-unsafe-finally` warning remains.
- No push, merge, real-daemon restart, state reset or paid provider call occurred.

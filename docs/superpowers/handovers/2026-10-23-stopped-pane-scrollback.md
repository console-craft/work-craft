# Stopped-pane scrollback checkpoint

## Scope and authorization

Implements the approved [stopped-pane design](../specs/2026-10-23-stopped-pane-scrollback-design.md)
after `5c5304c`, using native execution. The user now authorizes commits and pushing
the existing PR branch, including the Menu stabilization and the documented native
test quarantine. #41 stays open/unmerged. No normal-home reseed, installed-command
replacement or broad test restructuring is part of this step.

## Current completion checkpoint

Shared-session navigation (Phase/Stage 2), including this scrollback follow-up, is
implementation-complete, pending the user's whole-PR verification and acceptance.
The unresolved native/runtime risk is explicitly deferred in the tracked
[PTY exit follow-up](2026-10-23-native-pty-exit-hang.md). Only its three failed-start
native regressions are skipped on macOS; their assertions and non-macOS execution
remain. All other checks, commit hooks and the full pre-push check remain required.
This checkpoint does not claim the native issue fixed or all coverage executed.
The evidence below records the investigation before that accepted quarantine.

## Behavior and ownership

- Exit drains final PTY output and releases its live parser. The final picture is
  immediate; older stopped material is reconstructed lazily, without spawning.
- One daemon-wide display-only cache owns stopped history; 128 pending read/start
  descriptors bound its serialized preparation lane. Cache hits do not copy raw
  bytes. Switching stopped panes can rebuild display; latency is unmeasured.
- Manual restart reserves admission, waits for old drain, validates spawn policy,
  records a restored boundary/divider, flushes, and initializes a distinct fresh
  parser before spawn. Duplicate/rejected starts cannot append another divider.
- Stopped socket reads revalidate scope after asynchronous work. Raw/semantic/
  paste/focus writes remain live-child-only. TUI wheel browsing uses current read
  gates without focus/input/activity claims; historical grids are cropped locally.
- Exited/failed panes remain stopped after daemon restart. Interrupted running
  recovery policy and client Reconnect remain unchanged. Failed/interrupted output
  is browsable; existing Reactivate control eligibility is unchanged.
- Registry OpenTUI core/React 0.6.6, SQLite schema 6 and public DTOs are unchanged.
  Limits remain 1 MiB raw bytes, 1,024 markers, 10,000 native scrollback lines,
  2,097,152 drawing cells/context and 8-MiB transcript/material/envelope ceilings.

## Verification evidence

Execution evidence is local under
`.superpowers/sdd/2026-10-23-stopped-pane-scrollback/` with a durable progress ledger;
all saved command stdout/stderr was mirrored with pipefail/tee.

- Task 1: owner/metadata/cold-history tests, 24 pass; missing-contract RED then GREEN.
- Task 2: runtime/manual/cold start/recovery/input regression gate, 95 pass.
- Task 3: real Unix socket/read scope/geometry/native cache gate, 68 pass.
- Task 4: workbench/shell/client/boundary gate, 944 pass, plus three shell tests for
  current dialog/guard/archive blocking and zero child activity.
- Normal daemon/two-TUI stopped/cold acceptance: four pass. Exited early/middle/tail
  rows, independent offsets, UI Reactivate, fresh PID/input, repeated restart,
  ordinary client reconnect and stopped daemon restart are exercised.
- Compiled build/smoke passed, including stopped material, CLI manual restart,
  new PID and old scrollback through a subsequent compiled daemon recovery.
- Typecheck passed at the capability checkpoints.
- Fresh final review found two product issues, both fixed with observed RED→GREEN:
  failed preparation/capture/spawn now preserves the previous final picture across
  failed generations; stopped wheel browsing now includes enlarged viewport blank
  space without double-counting gestures over the terminal itself.
- Focused review-fix gate: 38 pass, zero failures, plus typecheck. The full gate
  initially also exposed two test-contract problems: explicit manual preparation
  intentionally reads history once (control serialization still reads none), and
  stopped status can arrive before its asynchronously presented final row. Tests
  now distinguish those operations and wait for both status and final content.
- Diagnostic whole-suite run with disposable process-call tracing passed 1,897 tests,
  zero failures and 13,464 assertions across 150 files in 251.97 seconds. Tracing
  changed timing; this is not evidence that ordinary verification is reliable.
- Early ordinary post-fix full checks stalled. A bounded `bun run check`
  passed lint/format/types, then exceeded seven minutes without a test summary.
  It also recorded an acceptance timeout entering the fresh terminal after UI
  Reactivate (`stopped-history.test.ts:67`). Three isolated repetitions of that
  file subsequently passed all six tests in 73.51 seconds.
- Verification cleanup removed the acceptance test's redundant tab-focus gesture
  after Reactivate: pointer-down cancels pending entry, while Reactivate already
  owns an exact-pane handoff. The test now observes new terminal-input readiness
  from before its Reactivate click; actual fresh input and all assertions remain.
  Five isolated repetitions passed ten tests and 105 assertions in 125.20 seconds.
  No production focus behavior was changed or claimed repaired.
- The terminal owner suite passed 1,230 uninstrumented executions over ten
  repetitions. A second full native-call trace passed all 1,897 tests in 258.43
  seconds. External-only observation then reproduced the ordinary stall at its
  310-second cutoff, with the runner in `__wait4_nocancel` and an exiting Bash
  child. The observer stopped only its owned processes.
- The reduced reproducer is `surface-view.test.tsx` followed by terminal
  `stopped-material.test.ts`; the stopped and projection-runtime files pass in
  isolation. Replacing the spawn spy with real argument rejection did not fix
  it, and preparation/capture-only cases also stall: the spawn-mock hypothesis
  was disproved and that attempted change reverted. Diagnostic logging masks
  the stall and was removed.
- Waiting for actual fixture output before allowing exit passed ten repetitions
  (310 tests, 3,380 assertions, 9.73 seconds), but the larger 50-repetition stress
  run stalled at its 90-second cutoff with the same exiting-child/native-wait
  pattern (`ready-fixture-stress.log`, `runner-32146.sample.txt`). The handshake
  was not a reliable repair and has since been reverted. No further timing
  workaround, production change or dependency change is justified by this result;
  native-test process isolation needs discussion before another attempted fix.
- An earlier stalled runner was sampled in native `__wait4_nocancel` with an owned
  exiting bash child, then explicitly terminated. The latest bounded run left no
  check/test process. These observations do not establish that both stalls have
  the same cause. See `hung-test.sample.txt`, `full-test-process-trace.log`,
  `final-ordinary-check.log` and `ordinary-acceptance-reproduction.log` in the local
  evidence directory.
- Post-review compiled build/smoke passed separately, including manual restart and
  subsequent cold recovery. Final ordinary full-gate success and local commits
  remain pending; hooks were not bypassed. No push or merge was attempted.
- Latest ordinary `bun run check` completed its test stage rather than hanging:
  lint/format/types passed; tests reported 1,896 pass and one failure in 249.74
  seconds. `cold-history.test.ts:82` saw the recovered separator but not
  `COLD-179-42` in client B's frame (the captured frame contains clipped output).
  This is a distinct acceptance failure, not a native-wait timeout. No cause or
  repair is claimed. Build/smoke were not reached in this run. See
  `continuation-ordinary-check.log`; no local commits were created.

### Native isolation investigation

The user approved investigating process isolation and the separate recovery-screen
failure. Explicit sequential runner processes passed 1,300 surface-view tests
(50 repetitions, 39.21 seconds) followed by 500 stopped-material tests (100
repetitions, 20.57 seconds). However, the combined pair still stalled with Bun's
`--isolate` and with `--parallel=2 --parallel-delay=0`; both were stopped at their
90-second external deadline. Worker isolation is therefore not an established
repair, and no test command/configuration change has been adopted.

Installed-Bun disassembly identifies a blocking `wait4` at the sampled offset
`0xa57de8`, after an errno-3 branch. Bun revision `c6da4a4d3` contains the matching
[macOS process-exit fallback](https://github.com/oven-sh/bun/blob/c6da4a4d3/src/spawn/process.rs#L366-L390):
if re-registering an exiting process returns `ESRCH`, it deliberately waits with
flags zero on the event-loop thread. This explains the uninterruptible JS
deadlines; it does not establish why the child remains in kernel exit or prove
that shared native state caused it. Source/disassembly and process-isolation logs
are retained locally. A plain Bun-only script passed 2,000 PTY exits without
Work Craft/OpenTUI; a second 2,000-exit run with direct stock-OpenTUI parsing also
passed. These are negative reproductions, not an upstream clearance.

Recovery observation reproduced the clipped screen, confirmed `COLD-179-42` in
retained history, and observed correct output in both clients after one second.
The test now waits for the old final row and separator together, rather than using
the separator alone as readiness; its original assertions remain. Five ordinary
repetitions reported nine pass and one distinct fixture-cleanup failure:
`crashDaemon()` received `EPERM` killing an old shell group. Diagnostic PID probes
found the old shell already gone. That cleanup race is not repaired or silently
ignored by the initial investigation; disposable observer iterations marked it
inconclusive. No product display or persistence change was made.

Final ordinary investigation check passed lint/format/types, then stalled in tests
and was stopped at its 360-second external deadline (exit 124). No assertion
failure was logged before the stall. The actual test runner was again in
`__wait4_nocancel` at offset `0xa57de8`, with an exiting Bash child; unprivileged
sampling could not inspect that child's stack. All observed owned runner/child
PIDs are gone. Build/smoke were not reached. See
`isolation-investigation-check-formatted.log` and `child-54357.sample.txt`.
The preceding attempt stopped at formatting; that formatting issue was corrected
before this run. No hooks were bypassed and no new local commits were made.

### Approved test-only crash cleanup correction

The user approved accepting a failed shell-group kill only after confirming the
group is absent. The initial immediate-only existence probe preserved errors
correctly but still failed two of twenty real recovery tests. A bounded observer
then caught `EPERM` from both kill and immediate probe, followed by `ESRCH` about
6 ms later. Other observer iterations that crashed before the shell PID file
existed are inconclusive, not passing recovery runs.

`killSharedProcessGroup()` now lives in the existing shared-session test support.
After `EPERM`, it checks for actual group disappearance for at most 250 ms. Only
`ESRCH` permits suppression; a present group, unrelated probe error, or persistent
permission error rethrows the original kill failure. Existing crash-fixture PID
reaping checks remain. Other process cleanup, production code, dependencies and
test commands are unchanged.

Eight deterministic cleanup regressions passed (17 assertions), including observed
RED→GREEN for the transient denied probe. Lint/format/types passed. Ten real
cold-history repetitions then passed twenty tests and 160 assertions in 115.95
seconds (`process-cleanup-cold-recovery-confirmed.log`). This establishes the
cleanup correction's focused result, not a repair of the separate native wait.

The final ordinary `bun run check` for this correction passed lint/format/types
but again stalled in tests at the 360-second cutoff (exit 124), with no assertion
failure logged before the stall. The runner sample again identifies the same
blocking Bun wait offset. All observed owned runner/child PIDs were cleaned up;
build/smoke were not reached. Evidence: `process-cleanup-final-check.log` and
`child-68567.sample.txt`. No production changes, second reviewer, new commits,
push, merge, installed-command replacement or normal-home mutation were made.

The first acceptance run had one fixture failure: a reopened client was not focused
before typing `exit`. Explicit terminal entry fixed the fixture, not product code.

## Menu test stabilization

The existing plain-text Menu crossing cases reproduced at the original line 338.
Mouse traces proved the test captured transient portal coordinates `(1,1)` before
anchoring at `(6,12)`; rapid separate gestures also needed frame settling. The test
now waits for anchored geometry (with bounded frame attempts and explicit position
assertions) and settles between gestures. All original cancellation/crossing
assertions remain. No production Menu or dependency change was made. The final
isolated suite passed 360 tests across 30 repetitions; an initial two-frame-only
attempt still failed 1/120 and is not presented as sufficient.

## Remaining acceptance and limits

The user reports successful manual testing: "I manually tested and all looks good."
This closes the manual acceptance checkpoint; it does not resolve the ordinary
automated verification blockers above or establish unreported platform/soak results.

No benchmark/soak or Linux manual certification was performed. Existing native
regional-indicator/hyperlink/invisible-wide limitations and React act/lint diagnostics
are outside this change; stock OpenTUI remains the only application path.

## Execution decisions and review dispositions

- User's latest authorization supersedes the earlier local-only/planning gates:
  commit and push the existing PR branch, leaving #41 open/unmerged. Only the user
  performs final PR acceptance and merge; test restructuring follows separately.
- Verification ran directly with mirrored pipefail/tee rather than the workflow
  helper's hidden-output redirection. Cost: manual ledger bookkeeping.
- Added read-only prospective `TerminalSizing.spawnSize` because stopped dimensions
  are deliberately not elected; the restart boundary must record the new shell's
  elected grid before output. Cost: a small additional sizing calculation, covered
  by unit/real-socket tests.
- A stable local wheel callback remains installed across native running→stopped
  transitions, but only current stopped browsing can admit it. Cost: a dormant
  callback on live panes; live mouse/query/input gates stay unchanged.
- Review's declined fidelity topics retain the user's stock-renderer waivers.
  Cost: known RI spacing/hyperlink/invisible-wide limitations remain.
- Review's declined React act/lint warnings remain known unrelated diagnostics.
  Cost: noisy tests/lint warnings, not a claim of repair.
- Review's declined hardware/Linux/performance/soak certification remains explicitly
  unverified. Cost: automated macOS acceptance cannot establish those guarantees.

The review reported no Critical findings and no deferred Minor findings. No second
review was dispatched; product fixes have focused RED→GREEN evidence. The native
coverage gap is now explicitly quarantined rather than described as a repair;
the remaining ordinary suite, build and smoke are still required by the hooks.

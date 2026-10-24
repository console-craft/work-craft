# Native PTY exit hang on macOS: investigation spec

## Status and accepted risk

The user approved Bun 1.4.4 adoption on 2026-10-25 after the causal mechanism was
established. Correction `7135572` is published. The same macOS-14 diagnostic
[comparison](https://github.com/console-craft/work-craft/actions/runs/40133539123)
passed full acceptance (294 tests, five existing skips), then all 200 runtime-prefix
repetitions (1,600 tests, 4,000 assertions, 76.51s), where 1.4.3 hung on repetition 156. Local check, acceptance, tooling, stress and compiled build/smoke also passed.

[Normal PR CI at that correction](https://github.com/console-craft/work-craft/actions/runs/40133426237)
passed core and Linux acceptance/build/smoke; both tooling hosts passed. macOS
passed runtime tests but failed cold-history frame equality later (293 pass,
five existing skips, one failure); its build/smoke were not run. That remaining
frame failure is not a native exit stall or a fully green PR. Existing quarantine
remains; its removal is still unfinished work.
See [current terminal risks](../architecture/references/terminal-lifecycle.md#known-limitations-and-unresolved-risks).

## Confirmed mechanism and upstream correction

[Hosted diagnostic run 40129107315](https://github.com/console-craft/work-craft/actions/runs/40129107315)
passed full acceptance, then hung on repetition 156 of the first eight runtime
tests in a fresh process. All 250 main-thread samples were in the same
`__wait4_nocancel` path; the Bash child was exiting. Preceding TUI tests in the same
process are not necessary for this reproduction.

A local kernel-only `forkpty` probe established that `EVFILT_PROC` registration
can return `ESRCH` while `waitpid(WNOHANG)` still returns zero. Reading the child's
pending output from the PTY master then lets `waitpid` complete. XNU's
`proc_exit` drains the controlling terminal through `ttywait` before reaping.
Bun's blocking fallback therefore prevents the very output read needed to finish
child exit. This is not a test-only synchronization failure.

[Bun 1.4.4's process implementation](https://github.com/oven-sh/bun/blob/bun-v1.4.4/src/spawn/process.rs)
moves macOS ESRCH reaping to a dedicated thread, preserving event-loop PTY reads.
Both initial watch and rewatch paths avoid the blocking fallback. Adopt that
released correction rather than changing application lifecycle semantics, dropping
final output, adding sleeps, or increasing test deadlines. The existing runtime
replacement acceptance case owns project-level regression protection.

## Quarantined coverage

The three `failed prepare/capture/spawn during Reactivate preserves the prior final
picture across generations` cases in
`packages/server/src/terminal/tests/stopped-material.test.ts` are skipped on macOS
only. Their assertions remain intact and still run on other platforms. Ordinary
stopped-history tests, real recovery acceptance and all other tests remain enabled.
The deferred gap is direct native coverage of retaining the final picture after
these three failed manual-reactivation paths. Keep the production review fixes.

## Earlier reproduction and evidence

On macOS with Bun 1.4.3 (`c6da4a4d3`) and stock OpenTUI 0.6.6, temporarily remove
the macOS skip locally and run this bounded reproduction:

```sh
bun test ./packages/tui/src/workbench/tests/surface-view.test.tsx ./packages/server/src/terminal/tests/stopped-material.test.ts --rerun-each=50
```

Use an external watchdog: JS test deadlines cannot interrupt the native wait.
Sampled runners block in `__wait4_nocancel`, with a Bash child stuck exiting.
Installed-Bun disassembly matches its
[macOS ESRCH process-exit fallback](https://github.com/oven-sh/bun/blob/c6da4a4d3/src/spawn/process.rs#L366-L390),
which deliberately calls blocking `wait4` on the event-loop thread. At that stage,
why the child could not finish exiting was not established. The instruction was sampled at
offset `0xa57de8` in that pinned binary, after an errno-3 (`ESRCH`) branch. This
identified the blocking mechanism; the causal explanation above was established
later. Shared native-state corruption was not demonstrated.

## Experiments already tried

- Separate sequential runner processes passed 50 surface-view repetitions and
  100 stopped-material repetitions. This does not establish a repair of the
  combined ordering-sensitive reproduction.
- The combined pair still hung with `--isolate` and with
  `--parallel=2 --parallel-delay=0`, each stopped by a 90-second external cutoff.
  No runner/configuration change was adopted.
- Waiting for actual fixture output before exit passed ten repetitions, then
  stalled during the 50-repetition stress run with the same native-wait pattern.
  That output-handshake attempt was reverted; short success is not reliability.
- Fresh globals and replacing the spawn spy with real argument rejection did not
  reliably prevent the hang. Prepare/capture-only cases also stalled; the
  spawn-mock explanation was not sufficient and that attempted change was reverted.
- Diagnostic process/native-call logging can mask the hang: instrumented full runs
  passed while ordinary runs still blocked. Do not treat tracing as a runtime fix.
- Plain Bun and direct-native-parser scripts each passed 2,000 PTY exits. These
  are negative standalone reproductions, not clearance of Bun/OpenTUI or evidence
  that ordinary daemon use cannot be affected.

No dependency override, runtime patch, timing workaround or hidden fallback was
adopted as a repair. Existing quarantine is distinct from those failed approaches.

## Historical evidence availability

The [written stopped-pane investigation](https://github.com/console-craft/work-craft/blob/94b29698463e4ffa93999504d1db2863c79a6e81/docs/superpowers/handovers/2026-10-23-stopped-pane-scrollback.md)
is preserved at a fixed Git revision. Representative reported artifacts include
`ready-fixture-stress.log`, `runner-32146.sample.txt`,
`isolation-investigation-check-formatted.log` and `child-54357.sample.txt`.

Raw diagnostics were originally stored under the ignored
`.superpowers/sdd/2026-10-23-stopped-pane-scrollback/` directory and were not available
in the audited cleanup checkout. Git preserves the written report, not those raw
logs/samples; do not claim they are bundled or verified accessible here. Recover
them from the original environment separately if needed, or capture new evidence.

## Remaining verification

Quarantine removal is separate: run the previously skipped
failed-reactivation cases and their ordering-sensitive reproduction reliably before
proposing removal. Passing ordinary acceptance with those cases skipped does not
close that coverage gap.

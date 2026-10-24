# Native PTY exit hang on macOS: investigation spec

## Status and accepted risk

Open; investigated and deferred by the user on 2026-10-23.
This is not a claimed runtime repair or proven test-only flakiness. Whether it can
affect ordinary daemon use remains unknown. This spec preserves the unresolved
investigation, not obsolete PR/merge gates or authorization to change runtimes,
dependencies or test policy. See [current terminal risks](../architecture/references/terminal-lifecycle.md#known-limitations-and-unresolved-risks).

## Quarantined coverage

The three `failed prepare/capture/spawn during Reactivate preserves the prior final
picture across generations` cases in
`packages/server/src/terminal/tests/stopped-material.test.ts` are skipped on macOS
only. Their assertions remain intact and still run on other platforms. Ordinary
stopped-history tests, real recovery acceptance and all other tests remain enabled.
The deferred gap is direct native coverage of retaining the final picture after
these three failed manual-reactivation paths. Keep the production review fixes.

## Reproduction and evidence

On macOS with Bun 1.4.3 (`c6da4a4d3`) and stock OpenTUI 0.6.6, temporarily remove
the macOS skip locally and run this bounded reproduction:

```sh
bun test ./packages/tui/src/workbench/tests/surface-view.test.tsx ./packages/server/src/terminal/tests/stopped-material.test.ts --rerun-each=50
```

Use an external watchdog: JS test deadlines cannot interrupt the native wait.
Sampled runners block in `__wait4_nocancel`, with a Bash child stuck exiting.
Installed-Bun disassembly matches its
[macOS ESRCH process-exit fallback](https://github.com/oven-sh/bun/blob/c6da4a4d3/src/spawn/process.rs#L366-L390),
which deliberately calls blocking `wait4` on the event-loop thread. Why the child
cannot finish exiting is not established. The blocking instruction was sampled at
offset `0xa57de8` in that pinned binary, after an errno-3 (`ESRCH`) branch. This
identifies the blocking mechanism, not the underlying child-exit cause or proof of
shared native-state corruption.

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

## Revisit criteria

Time-box a separate runtime investigation, preserving current behavior and tests.
A controlled comparison with another official Bun release is one next experiment,
not authorization to change the project's runtime pin. Remove the quarantine only
after the reduced reproduction and ordinary full verification finish reliably.

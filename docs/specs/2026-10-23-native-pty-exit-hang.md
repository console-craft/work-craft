# macOS failed-reactivation quarantine: remaining verification

## Status and accepted risk

Open only for targeted quarantine-removal verification. The native PTY deadlock
is corrected by the approved Bun 1.4.4 pin; its mechanism and current risk belong
in [terminal lifecycle](../architecture/references/terminal-lifecycle.md#known-limitations-and-unresolved-risks).
Do not reopen a renderer/runtime workaround or remove skips just because ordinary
acceptance is green. The separate
[cold-history frame investigation](2026-10-25-cold-history-frame-followup.md)
is not this coverage gap.

## Quarantined coverage

The three `failed prepare/capture/spawn during Reactivate preserves the prior final
picture across generations` cases in
`packages/server/src/terminal/tests/stopped-material.test.ts` are skipped on macOS
only. Their assertions remain intact and still run on other platforms. Ordinary
stopped-history tests, real recovery acceptance and all other tests remain enabled.
The deferred gap is direct native coverage of retaining the final picture after
these three failed manual-reactivation paths. Keep the production review fixes.

## Reproduction to re-enable in an isolated experiment

With the pinned Bun and stock OpenTUI, temporarily remove the macOS skip in an
isolated checkout and run the previously ordering-sensitive pair:

```sh
bun scripts/run-bounded.ts 90000 bun test ./packages/tui/src/workbench/tests/surface-view.test.tsx ./packages/server/src/terminal/tests/stopped-material.test.ts --rerun-each=50
```

Retain the external watchdog: JS test deadlines cannot interrupt native blocking.
The old pair hung on Bun 1.4.3 with `__wait4_nocancel` at binary offset `0xa57de8`
and a Bash child exiting. Process isolation, output handshakes and removing spawn
spies did not reliably prevent it; tracing sometimes masked it. Do not repeat those
negative experiments as proposed fixes. The
[full earlier investigation](https://github.com/console-craft/work-craft/blob/29f6fef6f9bdbc63fe1cf2f31cd7d654aa980323/docs/specs/2026-10-23-native-pty-exit-hang.md)
retains the detailed attempts and original report links. Its October 23 raw
samples were not available in the audited cleanup checkout; Git preserves the
written evidence, not a claim that those artifacts are bundled.

The [Bun 1.4.3 runtime-prefix diagnostic](https://github.com/console-craft/work-craft/actions/runs/40129107315)
hung on repetition 156; the
[same workflow on 1.4.4](https://github.com/console-craft/work-craft/actions/runs/40133539123)
passed acceptance plus 200 repetitions. Those runs establish the runtime correction,
but did not re-enable these three cases.

## Remaining verification

Quarantine removal is separate: run the previously skipped
failed-reactivation cases and their ordering-sensitive reproduction reliably before
proposing removal. Passing ordinary acceptance with those cases skipped does not
close that coverage gap.

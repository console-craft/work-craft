# Follow-up: native PTY exit hang on macOS

## Status and accepted risk

Open, deferred by the user on 2026-10-23 so shared-session navigation can finish.
This is not a claimed runtime repair or proven test-only flakiness. Whether it can
affect ordinary daemon use remains unknown. PR #41 stays unmerged until the user's
whole-PR verification; broad test restructuring belongs in a separate post-merge PR.

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
cannot finish exiting is not established.

Process isolation, fresh globals, spawn-mock replacement and output handshakes did
not reliably prevent the hang. Diagnostic logging can mask it. Plain Bun and
direct-native-parser scripts each passed 2,000 PTY exits, so they are not sufficient
standalone reproducers. No dependency override, runtime patch or hidden fallback
was adopted. Detailed investigation history is in the
[stopped-pane handover](2026-10-23-stopped-pane-scrollback.md); local raw diagnostics
remain ignored under `.superpowers/sdd/2026-10-23-stopped-pane-scrollback/`.

## Revisit criteria

Time-box a separate runtime investigation, preserving current behavior and tests.
A controlled comparison with another official Bun release is one next experiment,
not authorization to change the project's runtime pin. Remove the quarantine only
after the reduced reproduction and ordinary full verification finish reliably.

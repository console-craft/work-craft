# Output Lifecycle Measurement Gate

## Status

In progress; no production performance fix or recovery architecture approved.
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

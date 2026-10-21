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

The enabled characterization suite passed **9 tests / 12 assertions** on the
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

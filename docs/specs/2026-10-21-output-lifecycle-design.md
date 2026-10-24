# Outstanding terminal performance and lifecycle acceptance

## Status and scope

**In progress.** Output/control separation, daemon-owned parsing, stock-registry
OpenTUI integration, stable presentation and history recovery are implemented.
The accepted quantitative capacity, memory, sustained-operation and comparison
requirements below have not been established by the existing test gate or manual
trial. This is an outstanding acceptance contract, not a claim of measured parity
or permission to repeat an obsolete renderer/fork migration.

Current implementation and ownership are described in the
[architecture overview](../architecture/overview.md),
[terminal lifecycle](../architecture/references/terminal-lifecycle.md) and
[development guide](../architecture/references/development.md). Future product
features belong to the [remaining roadmap](2026-09-18-tui-overhaul-design.md).

## Preserved constraints and comparison baseline

- Keep Bun, React/OpenTUI, one local daemon, current transport, durable selection,
  stable IDs/processes, bounded history, safe migrations and CLI behavior.
- Use unmodified registry dependencies through public APIs: no private forks,
  `node_modules` edits, prototype replacements, private native handles or copied
  upstream implementations disguised as application code. A new engine, worker,
  transport or dependency requires a separate evidence-based decision.
- Preserve canonical grids, sizing election, local focus/overlays, keyboard/Kitty,
  paste, mouse/focus reports, selection/copy, local scrolling and input authority.
  Keep currently disclosed fidelity/frame/paste limitations explicit; additional
  functionality or performance concessions need user approval.
- No user-state reset, unrelated process cleanup, installed-app replacement,
  real-daemon restart or paid provider calls are authorized. Use fixture-owned
  homes/processes and an isolated OpenCode home/session for measurements.

The no-fork comparison baseline is PR #41's reviewed commit
`9cba83769685a72c96bc8382ac107262cc7b3f4a`. Matching its performance is enough; a
slight slowdown is acceptable, but a major regression is not. Further gains are
optional. No percentage defining "slight" was agreed: report actual absolute and
relative latency/memory results and return ambiguous tradeoffs to the user.

Baseline equivalence and overall product capacity are separate gates. Equivalence
does not establish the remaining capacity/soak targets, and those unmet targets
are not new prerequisites for describing an experiment as baseline-equivalent.
Manual approval of a runnable baseline is not quantitative parity evidence.

## Workloads

Freeze and publish versions, candidate/baseline commits, grids, byte rates,
durations, probe counts and seeds before tuning. Run comparisons serially on the
user's macOS/WezTerm setup with no injected disk/swap exhaustion; also observe
controlled background work without treating every failure as an environment
exemption. Do not reboot, stop user programs or change system settings to get green
numbers. Measure harness and child cost separately from application/daemon cost.

1. **Visible pair:** real Neovim and OpenCode side by side, fast navigation,
   insert/edit, completion/popups and repeated dismissal. Deterministic VT fixtures
   complement, not replace, real-application/physical acceptance.
2. **Capacity:** 50 panes across multiple items with two or three tabs each,
   including 10 complex interactive-TUI workloads and 40 idle shells or stopped
   panes; exercise both variants. Eight hidden producers emit 4 KiB/100 ms each
   (about 320 KiB/s aggregate) while the pair remains interactive. Use reproducible
   local fixtures, not ten paid AI sessions or fifty visible full-screen redraws.
3. **Mirrors/switching:** two normal clients of different sizes, same and different
   sessions; switch among ten running TUIs after hidden output exceeds retained
   raw history, then edit immediately after each switch.
4. **Overload/recovery:** keep the four-pane 4-MiB burst's original
   16-KiB/60-ms/64-redraw workload and deadlines. Stall a viewer and delay one
   pane's recovery while another remains usable. Include history rollover,
   same-cursor resizes, reconnect, confirmed detach/deletion and cold daemon restart.

## Accepted quantitative targets

These are accepted targets to verify, not guarantees already achieved or universal
real-time guarantees on arbitrarily overloaded hosts. If infeasible, return with
evidence for reapproval rather than silently changing them.

| Measurement                                                    | Required result                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visible-pair/capacity input, at least 200 probes after warm-up | Input-to-child p95 <=50 ms; input-to-visible p95 <=100 ms and p99 <=200 ms; no sample >=1,000 ms.                                                                        |
| 100 switches at expected capacity                              | Correct, actually input-ready content within 250 ms p95; none >=1,000 ms. Separate control commit from parser/display readiness.                                         |
| Four-pane burst                                                | Preserve strict maximum `<1000 ms` input-to-visible and passive final-frame assertions; repeat burst and Neovim rollover three times serially.                           |
| TUI memory after warm-up                                       | <=512 MiB RSS per TUI process tree; report PTY child and harness RSS separately.                                                                                         |
| Daemon memory at 50 panes                                      | <=256 MiB RSS, excluding child application RSS.                                                                                                                          |
| Sustained operation                                            | Complete ten-minute capacity/switch/recovery soak; queue bytes/tasks and native instance counts plateau, then drain to documented retained baselines after output stops. |

Record distributions, missing observations and minute-by-minute RSS/heap/native
measurements where available. Missing samples are not successes to omit from a
percentile. RSS retention alone is not proof of a leak; a short soak does not
certify all-day stability.

## Correctness and observer requirements

- A delayed pane recovery must not delay unrelated input, control, command
  acknowledgements or other panes. Assert this with independently held recovery;
  do not impose normal readiness latency on the deliberately stalled pane.
- Keep coherent same-context presentation through backlog/recovery/reconnect
  without chooser/empty/blank flashes or native churn. Observe emitted frames,
  cursor and instance IDs plus physical WezTerm behavior; absence of placeholder
  text is not proof of no flicker.
- Parse every required byte/resize in order. Coalescing already-parsed pictures
  is allowed; dropping instructions, reset-plus-tail approximations and historical
  replies are not. Preserve modes, partial escape/UTF-8 boundaries, exactly one
  live daemon query reply, stale-authority rejection and child identities.
- Keep finite input/presentation frontiers, captured original authority/senders,
  bounded queues and fair scheduling. A picture, command response or network
  receipt is not proof of current input readiness. One busy pane or slow viewer
  must not starve siblings or trigger global recovery loops.
- Fix observer readiness weaknesses before trusting capacity numbers. Confirm
  fresh child input after every measured switch; visibility/cursor checks alone
  are insufficient. A focus failure cannot be logged and omitted as a success.
- Direct-PTY input-to-child timestamps are uncalibrated: historical results include
  a negative sample. Establish display-independent receipt/clock calibration before
  making precise latency claims; current same-host raw timestamp mapping is not
  skew-corrected. This does not invalidate the historical multi-second findings.
- Run short falsifying probes before another ten-minute soak. Correlate producer,
  daemon read/parse/publication, client receipt/material/render, child input and
  observed display. Separate native-call blocking from application and harness
  cost; do not infer the bottleneck from code shape alone.
- Do not increase timeouts, remove assertions, raise resource budgets or require
  user cleanup to manufacture success. Test fixes must preserve intended behavior.

## Evidence gaps and completion

The [earlier measurement report](https://github.com/console-craft/work-craft/blob/94b29698463e4ffa93999504d1db2863c79a6e81/docs/superpowers/handovers/2026-10-21-output-lifecycle-measurements.md#capacity-attempt-failed-soak-incomplete)
records a failed capacity attempt, observer limitations and an aborted 8m19s soak,
not present-day measurements of the stock-renderer implementation. The
[later integration handover](https://github.com/console-craft/work-craft/blob/94b29698463e4ffa93999504d1db2863c79a6e81/docs/superpowers/handovers/2026-10-22-unpatched-runnable-preview.md)
records manual baseline acceptance but explicitly does not certify performance
equivalence, capacity or soak. No unchanged test rerun closes those gaps.

Existing `benchmark:output` tooling records evidence; it is not itself a numerical
acceptance gate and must satisfy the observer requirements above before its output
can establish the contract. Current commands are in the development guide.

Complete this work only with recorded serial comparisons, accepted latency/memory
results, input-ready capacity/switch/recovery evidence, the full ten-minute soak,
real Neovim/OpenCode physical acceptance, repeated regressions, independent review
and `bun run check:all` including compiled smoke. Report Linux, other terminals,
paid-provider throughput and all-day behavior separately when unverified.

# Handover: Separate Output From Shell Lifecycle

## Status: stabilization verified; continue the follow-up on this branch/PR

This is context for a clean session in the existing worktree, **not an approved implementation spec**. The goal is multiple Neovim/OpenCode instances in different panes without application flicker or multi-second pauses. Eventual correct output is not sufficient.

Continue on `feat/shared-session-navigation` and its draft PR against `main`. The shared-navigation foundation is `44d871d`; stabilization and this handover form the following checkpoint commit. Keep follow-up work in separate commits on this same branch. A clean session does not require a new branch or worktree.

**Latest user decision:** commit the checkpoint and open a draft PR, then continue output/shell lifecycle separation in a clean session on this same branch/PR. Merge to `main` only after that work is complete and verified. This supersedes the earlier proposal to merge stabilization first and create a separate follow-up PR.

**Current test status is green after laptop reboot:** full `bun run check` passed all 1,679 tests/build/smoke, and both previously failing cases passed three additional runs each. No code or assertions changed during that retest. Earlier resource-sensitive failures below are historical evidence, not currently reproduced failures or an independent requirement to stack PRs.

## Preserve the foundation

- One local daemon owns SQLite, PTYs and processes; disposable React/OpenTUI and CLI clients. No remote/plugin/distributed-system changes.
- Durable daemon-owned session navigation/tab/pane memories. Same-session clients share selection; separate sessions keep independent selections over shared runtimes.
- Shared selection is not keyboard focus; filters, dialogs, focus and entry intent are client-local.
- Stable pane/process identities, canonical PTY sizes and latest-active eligible viewer arbitration.
- Epoch/attachment/navigation/geometry input gates, output-time response stamps, one authorized emulator reply, and no replies to replayed queries.
- Pending attachment is not confirmed detach/deletion. Keeping the last screen visible must never authorize stale input.
- Non-destructive persistence, current CLI commands and reserved one-row status bar.

Navigation rules/storage/migration, CLI, attachment authorization and sizing remain useful. Rework is concentrated in delivery, replay, recovery and rendering integration—not a rewrite of shared navigation.

Read [architecture](../specs/2026-09-16-work-craft-architecture-design.md), [shared-session design](../specs/2026-10-21-shared-session-navigation-design.md), and [TUI source map](../../tui-source-map.md). Preserve dated specs as decision history.

## What changed

| Budget                      | Current value                   | Meaning                                                                |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| WebSocket send backlog      | 8 MiB/connection                | Temporary burst headroom; excessive peers still disconnect             |
| Inline snapshot cutoff      | 512 KiB, independent of backlog | Larger snapshots notify with `snapshot.available`, retrieved over HTTP |
| Client retained live bytes  | 2 MiB/pane                      | Temporary retention, not consumption-aware flow control                |
| Server retained raw history | 1 MiB/pane, unchanged           | Bounded durable tail                                                   |
| Replay raw-byte guard       | 3 MiB/pane                      | History + live bytes; synthetic prefix excluded                        |
| Resize history              | 1,024 markers, unchanged        | Ordered canonical-grid replay                                          |

These are byte budgets, not file-size or throughput limits. The 53-byte reset/truncation prefix previously made full history + full live retention exceed the replay guard even after everything was consumed. Prefix offsets are validated and excluded from raw accounting. Rollover fixtures now cross the new live budget.

Other real-use fixes included in this checkpoint:

- Large snapshots use HTTP rather than overflowing the bounded stream; raising transport headroom does not enlarge inline snapshots.
- Closing transports drop ephemeral viewport/activity/input sends; durable requests reject explicitly.
- Already-consumed retired bytes do not require recovery; genuinely unread byte/grid gaps still do.
- History resync normally preserves attachment; failed HTTP recovery falls back to lifecycle-guarded reload.
- Pending attachment does not flash the chooser or overwrite logical terminal-focus intent.
- Stale-revision snapshots cannot prune newer acknowledged attachments.
- Delayed HTTP replacement preserves overtaking live chunks and newer resize markers, including a resize at its final byte cursor. Review reproduced cursor rollback 3,600,000 → 2,400,000 before this correction. Buffer merging fixes it without adding another HTTP wait to the output queue.

Temporary trace instrumentation was removed. No schema change or dependency was added.

**Operational caution:** stabilization tests used isolated homes. Subsequently, with explicit user permission, the default development database was backed up, reset and reseeded with Playground/Focus, one shared workspace, five items, two tabs and three shell panes; the daemon was stopped. The user later rebooted and resumed manual testing. Do not repeat real-state cleanup or process termination without permission. Restarting the daemon stops its programs; durable records/history do not preserve a running editor across restart. Loaded server constants change only on daemon restart.

## Evidence and verification history

Environment: macOS, Bun 1.4.3, installed OpenTUI 0.6.6. Observations below are not portable performance guarantees.

### Transport

A stalled-reader probe sent 4 MiB raw output in 256 JSON/base64 frames: 5,619,712 encoded bytes. The 1/4 MiB candidate budgets disconnected in that probe; 8 MiB delivered all frames. Real production-HTTP-server tests now verify delivery followed by attachment/command success, independent 512 KiB snapshot notification, and disconnection of a deliberately excessive stalled peer. These pass; exact close offsets are kernel/socket dependent.

### Four-pane acceptance: pre-reboot responsiveness failures

`packages/tui/src/tests/terminal-burst.test.ts` launches an isolated daemon, two normal TUIs and four real PTY children. Each produces 64 cursor-addressed 16 KiB redraws at 60 ms intervals: 1 MiB/pane, 4 MiB combined, nominally ~1 MiB/sec combined before scheduling/backpressure. Active-pane physical input is injected during output.

- Both clients eventually render **every pane's final `tick=64`**, producer PIDs survive, input arrives and views converge.
- No emitted `No execution surface`, `Select session...` or `Disconnected` placeholder text was detected in the measured window. This does not certify every blank frame/physical-terminal appearance.
- Before reboot, the `<1000 ms` input-to-visible assertion failed. Initial paced observation: **4.70 s** maximum; three subsequent runs: **18.10 s, 15.73 s, 12.18 s**. Pre-reboot full check: **13.20 s**. Post-reboot results below supersede the failing status, not the need to investigate resource sensitivity.
- Repeated runs sampled maximum aggregate RSS per TUI process tree of approximately **773, 753 and 574 MiB**, from initial ~199–229 MiB samples. These finite RSS observations do **not** diagnose a leak or sustained capacity. TUI samples include Bun launcher/descendants; daemon samples exclude PTY children.
- Timing starts before physical input and ends when accumulated text and visible cursor are observed. Polling is 20 ms; `ps` samples are outside timed probes. This includes external native-display/harness overhead; the exact bottleneck is not isolated.
- A stronger 15 ms cadence also exceeded the initial four-second display wait. The slower workload was not a repair.
- Temporary traces showed no reconnect/resync before cleanup; server history had final output while clients displayed earlier cursors. This demonstrates delayed consumption/presentation, not which component dominates.

The latency assertion stays enabled. Its 60-second runner timeout permits observation, not a relaxed acceptance target.

### Neovim: pre-reboot startup instability

`Neovim page jumps retain terminal focus after output history rolls over` uses a 1,000,000-byte prefill and 80 `G`/`gg` jumps over 5,000 lines. Earlier focused runs passed. Before reboot, two of three repeats passed; one timed out at `scrolling editor starts`. The pre-reboot full check had the same timeout while old prefill output remained displayed. Post-reboot full/repeated runs passed. Root cause of the earlier timeout is not established; successful reruns are not a code repair.

### Pre-reboot verification (historical)

- After the review race fix: **146 connected client/replay/workbench tests pass**.
- Pre-reboot `bun run check`: lint/format/types passed; **1,677 tests pass, 2 fail**, across 118 files. Failures were four-pane latency and Neovim startup above. That command did not reach build/smoke.
- `bun run build && bun run build:smoke` passed separately afterward with isolated state.
- Existing server `no-unsafe-finally` warning remains.
- Independent review confirmed bounded accounting/transport behavior, found the corrected rollback race, and recommended holding merge while those failures reproduced. Its passive-pane coverage gap was strengthened with final-frame checks on both clients.
- No Linux/physical-terminal certification, sustained soak, real multi-OpenCode/provider workload, or leak diagnosis was performed.

### Post-reboot verification (current)

- The user rebooted the laptop after observing memory pressure. No product/test code or assertion was changed for this retest.
- `bun run check`: **1,679 pass, 0 fail**, 118 files; lint/format/types, compiled build and smoke also passed.
- Four-pane maximum input-to-visible latency in the full suite: **267 ms**. Three further load runs: **268 ms, 104 ms, 186 ms**. All eight probes in each run were sent while producers were active.
- The Neovim rollover case also passed three further runs: combined focused verification **6 pass, 0 fail**.
- System swap usage was zero before and after the retest. This supports investigating resource-pressure sensitivity but does not establish the sole cause of earlier failures.
- Aggregate client RSS still reached roughly **650–690 MiB** in the finite load test. The memory/architecture follow-up remains justified despite passing latency checks. No leak/soak/platform certification is implied.
- Keep the one-second assertion enabled. Do not weaken it or treat a future failure as automatically harmless because this run passed.

## Architectural coupling to investigate

Inspected code properties—not all independently measured bottlenecks:

1. Every pane's output is broadcast to every subscriber, including non-visible panes/sessions.
2. Whole-application snapshots include all-pane history. HTTP avoids one oversized stream frame, not global serialization/copy/decode cost.
3. Transport message ordering includes HTTP retrieval in one promise chain; the store has another application queue. Recovery can delay unrelated traffic.
4. Each output update changes the global React-subscribed store. Replay scans retained segments; native writes drain from layout effects/frame callbacks without a processing-time budget.
5. Reconnect clears attachment; shell projection removes navigation/surface; `Workbench` replaces `SurfaceView` with an empty state. Focus intent survives now, displayed native instances do not.
6. Terminal keys include the history baseline cursor; replacement history can recreate emulators.
7. Truncated terminal instructions plus reset are not an exact screen/mode checkpoint. Resize markers preserve grid order, not all VT state.

Terminal bytes cannot be dropped/coalesced like pictures. Skipping intermediate paints must preserve parsing, resize and response ordering. Raising another limit is not an established solution.

## Entry points

- Server output/broadcast/publication: `packages/server/src/application/app.ts`; global snapshots: `application/snapshot.ts`.
- Budgets/HTTP: `packages/server/src/api/http.ts`, `protocol.ts`; transport ordering: `packages/server/src/client.ts`.
- Retained history/grid metadata: `packages/server/src/terminal/history.ts`, `history-geometry.ts`.
- Store/subscription/authorization/resync: `packages/tui/src/client/store.ts`, `use-work-craft.ts`; retention/merge/replay: `terminal-buffer.ts`, `terminal-replay.ts`.
- Projection/empty surface/native lifetime: `packages/tui/src/shell/model.ts`, `packages/tui/src/workbench/workbench.tsx`, `surface-view.tsx`, `terminal-viewport.tsx`.
- Regressions/observation: `packages/tui/src/tests/terminal-burst.test.ts`, `shared-session.test.ts`, `tests/support/shared-session-*.ts`; transport: `packages/server/src/api/http-backpressure.test.ts`, `http.test.ts`.

## First steps in the next session

Use this existing worktree/branch and draft PR; no merge, new branch or new worktree is needed to resume. Read the current status above before interpreting historical failures. Establish a fresh baseline before designing, preserve real state/processes, and use isolated homes.

```sh
bun test packages/tui/src/tests/terminal-burst.test.ts
bun test packages/tui/src/tests/shared-session.test.ts -t 'Neovim page jumps'
WORK_CRAFT_BURST_METRICS=/absolute/approved/temp/burst.jsonl bun test packages/tui/src/tests/terminal-burst.test.ts
```

The optional metrics path is test-only JSONL; use a permitted temporary location. No production metrics configuration was added. Full gate: `bun run check`.

Trace one correlated path: producer write/cursor → daemon read/broadcast/socket backlog → client receipt/queue delay → store application → native parse/drain → emitted frame/display. Measure bytes, chunk/message counts, processing/blocked time, input-to-child separately from input-to-visible, and allocations/memory. Compare a direct native-terminal baseline to separate application and harness cost.

Then design the smallest separation that keeps shell/layout and displayed instances stable while output catches up, localizes recovery to affected panes, and bounds work fairly. Preserve confirmed detach/deletion and input gates. Do not assume a new socket, dependency or framework is necessary.

Daemon terminal state/checkpoints (prior option 3) remain a separate decision if exact recovery after genuinely lost history requires them; neither approved nor ruled out here. Agree on realistic multi-editor/OpenCode load and latency/flicker/memory acceptance before calling the follow-up complete.

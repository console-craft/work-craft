# Responsive Terminal Output And Stable Shell Lifecycles

## Status

Approved on 2026-10-21 for planning the measurement/feasibility gate, including
the proposed acceptance budgets. Production architecture remains unapproved. Continues on
`feat/shared-session-navigation` and its existing draft PR. Do not merge the
stabilization checkpoint separately or create a new branch/worktree.

This document establishes product acceptance and architectural contracts, not a
claim that the performance bottleneck has been diagnosed. Approval authorizes
planning the measurement/feasibility gate first. A concrete recovery/delivery
architecture must pass that gate and be added here for approval before its
production implementation is planned. Independent, measured improvements may
then be planned within the approved boundaries; no speculative rewrite.

References:

- [Output/lifecycle handover](../handovers/2026-10-21-output-lifecycle.md)
- [Architecture](2026-09-16-work-craft-architecture-design.md)
- [Shared navigation](2026-10-21-shared-session-navigation-design.md)
- [Current TUI ownership](../../tui-source-map.md)

Workflow:

- [x] Read the handover, architecture, shared-navigation design and source map.
- [x] Capture the user's real workload and inspect the connected output path.
- [x] Run fresh isolated burst and Neovim baselines.
- [x] Draft the proposed contracts and acceptance criteria.
- [x] Complete a fresh builder check and address consequential gaps.
- [x] Obtain user approval, including the proposed performance budgets.
- [x] Write the measurement/feasibility implementation plan.
- [ ] Record measured findings and approve the concrete architecture amendment.
- [ ] Plan and implement the approved production changes, review and verify.

A fresh independent builder check found no consequential unanswered questions
for planning the measurement/feasibility gate. It did not certify production
feasibility or approve the proposed budgets.

## Why And Intended Workload

The user works across multiple repositories/worktrees. Each item's surface
usually has two or three tabs; its first tab commonly has two side-by-side
panes, OpenCode on the left and Neovim on the right. The expected Coding workload
is approximately 50 open terminals, at least 10 hosting complex interactive
TUIs. They are not all visible, actively redrawing, or consuming CPU constantly.
This is a realistic capacity target, not permission to assume 50 simultaneously
visible full-screen redraws or to add new non-Coding features.

Today even one OpenCode/Neovim pair can feel like a poor SSH connection when
navigating quickly or opening application popups. Success means local-feeling
interaction and stable presentation during normal work, not eventual output
convergence. tmux/herdr are experiential references, not mandated dependencies
or an expectation of their complete feature/platform coverage.

Confirmed: retain the local daemon, React/OpenTUI and current product model.
The user cites WezTerm as their modern host terminal; physical acceptance uses
their macOS/WezTerm setup. Numerical budgets originated as engineering proposals
and were accepted with this design; they remain subject to the explicit
evidence-and-reapproval process below, not silent adjustment.

## Goals, Non-goals And Anti-goals

Goals:

- Make the visible editor pair responsive while other terminal processes live
  and produce realistic background output.
- Separate output ingestion, parsing and presentation from shell/layout and
  attachment lifecycles. Unrelated panes must not pay for another pane's recovery.
- Bound retained bytes, queued tasks and synchronous processing work; distribute
  output work fairly without starving keyboard input, navigation or siblings.
- Preserve terminal correctness, including future behavior after recovery, not
  merely a visually plausible last frame.
- Establish repeatable latency, capacity, memory and physical-flicker evidence.

Not included: new navigation/workbench operations, themes, restore adapters,
remote access, plugins, distributed services, another UI framework, generic
schedulers/state frameworks, or permanent production telemetry infrastructure.
No binary protocol, additional socket, worker or dependency is assumed necessary.
Such changes require measured justification, not preference.

Unacceptable outcomes include dropping/coalescing terminal instructions as if
they were pictures, weakening existing tests, hiding multi-second delays behind
longer timeouts, unbounded caches, keeping 50 rendered terminal trees alive by
default, or calling a reboot/resource cleanup a product repair.

## Current Evidence And Limits

Baseline checkpoint: `3298450`, Bun 1.4.3, installed OpenTUI 0.6.6, macOS.
Working tree was clean before drafting. Tests used their isolated daemon/home
fixtures; no user's daemon, database or programs were stopped or reset.

- Fresh standalone four-pane burst: failed the unchanged `<1000 ms`
  input-to-visible assertion, maximum **10,522.99 ms**.
- A metrics burst run overlapped a Neovim test: maximum **8,779.77 ms**;
  four of eight probes were issued before the first producer completed.
  Aggregate RSS per TUI process tree rose from about 241–248 MiB to 799 MiB;
  daemon RSS reached about 96 MiB. These are finite observations, not leak proof.
- Neovim rollover startup timed out during that overlapping run. A subsequent
  standalone rerun passed all 82 assertions. Do not present the overlapping run
  as an isolated Neovim performance measurement or the rerun as a repair.
- Fresh `bun run check`: lint, formatting and types passed (existing server
  `no-unsafe-finally` warning remains). Tests reproduced burst latency failure
  at **5,340.65 ms** and an undefined Reactivate button in
  `same-epoch tab context changes retain restart protection until failure settles,
  then release it off-context` (`shell/tests/pane-operations.test.tsx:656`).
  The command exceeded its 120-second tool timeout and was terminated; no full
  suite count, build or smoke success is claimed. The pane-operations failure
  has not been investigated or classified as a timing flake.
- Metrics JSONL is local observation, not a portable fixture:
  `/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/output-lifecycle-baseline-2026-10-21.jsonl`.

Inspection confirms coupling, but not its relative performance contribution:

- `application/app.ts` broadcasts every pane's output to every subscriber;
  structural/status publication builds all-pane-history snapshots.
- `server/src/client.ts` puts HTTP snapshot retrieval and command acknowledgments
  on the same promise chain. `tui/src/client/store.ts` has another application
  chain which can await global recovery.
- Every output chunk replaces global subscribed state in `store.ts`;
  `use-work-craft.ts` subscribes the application to it.
- `terminalReplaySteps` scans retained ranges/markers; `TerminalViewport.drain`
  writes the returned steps without a processing-time budget, including from
  layout effects and frame callbacks.
- Pending attachment removes the shell's projected authoritative context.
  Surface replacement and keys containing `historyCursor` can destroy displayed
  native terminals during synchronization.
- `EmbeddedTerminalRenderable.screen()` exposes text/grid/cursor inspection;
  its public declaration has no full parser-state export/import contract.

No root cause or native capability impossibility is established by inspection.

## Mandatory Measurement And Feasibility Gate

Before selecting performance fixes, trace a correlated producer/output/input
path with test-only bounded instrumentation:

1. Producer write and input receipt; daemon PTY read, history append, publication
   and per-peer backlog; client receipt, application queue and decode/apply;
   native parse/drain, renderer frame emission and observed display/cursor.
2. Record raw/encoded bytes, message/chunk counts, queue age and retained bytes,
   processing/blocked time, frame intervals, native instance creation/destruction,
   and process memory. Separate input-to-child from input-to-visible latency.
3. Run serially to establish comparable results, then apply controlled background
   load. Record host memory pressure/swap and workload versions. Do not require a
   reboot, kill user programs or change system settings to obtain a passing run.
4. Compare the same deterministic producer directly in a host PTY, in the native
   embedded terminal without Work Craft synchronization, and through the normal
   application. Include the outer native-display test harness's cost explicitly.
5. Identify the dominant delays/copying and test one explanatory hypothesis at a
   time. If the native or host path dominates, report that limit rather than
   attributing it to React or promising application-only fixes.

In parallel with this analysis, investigate correct recovery for a hidden or
lagging pane after its raw history is genuinely lost. Inspect existing native
headless/parser facilities before proposing another emulator. Prove continuation
equivalence, not just matching text: active/alternate screens, cursor and saved
cursor, styles, scroll regions, wrapping, input modes, partial UTF-8/control
sequences, ordered resizes and response behavior must survive the chosen route.
This concerns live daemon continuity, not restoring Unix process memory after
a daemon restart. Existing cold restart semantics remain unchanged.

The gate produces a small evidence report and an amendment selecting the concrete
delivery/recovery design, its budgets and its compatibility consequences. If
correct bounded recovery needs daemon-owned terminal checkpoints, make that
explicit for approval. Neither a second emulator nor a new dependency is
preapproved here. If the installed stack cannot support the required contract,
stop and revisit the architecture; do not silently substitute reset-plus-tail,
force a child restart, or claim that visible-only streaming is already safe.

## Proposed Architectural Contracts

### Shell And Display Lifetime

Maintain last coherent **presentation** separately from live **authorization**.
Disconnect, pending reattachment, output lag and same-context recovery must not
clear the displayed surface/tab or recreate its native instances. Keep its last
coherent screen visible and use the existing source-labelled status row for
connection/recovery information. It is stale presentation, never input authority.

Live connection loss immediately disables mutation/input. Recovery disables input
to affected panes until their current runtime/grid/parser readiness is established;
unaffected ready panes remain usable when attachment and selection are valid.
Backlog alone must not repeatedly blur/refocus a valid native terminal. Define a
readiness watermark rather than requiring the output queue to be eternally empty.
The exact watermark belongs in the measured architecture amendment.

Confirmed detach, session deletion, real navigation, pane removal and process
replacement remain meaningful transitions. Follow authoritative navigation even
while an old pane recovers; late recovery must not restore the old destination.
An obsolete screen may not masquerade as the newly selected pane. Genuine restart
or recovery resets may replace/reset only the affected native state with explicit
runtime/reset identity, never because a history baseline cursor changed.

Stable lifetime is required for the displayed context through transient recovery,
not a promise to keep every previously visited native renderer mounted forever.
Eviction/recreation across real navigation must obey the approved recovery design.

### Control State Versus Terminal Data

React remains responsible for shell, layout, selection, focus and process state.
Pure terminal bytes must not invalidate the whole application's React subscription
or copy a global all-pane buffer map on every chunk. Route output/progress through
concrete pane-local subscriptions/queues in `client/`, consumed by `workbench/`.
Publish React-visible changes only when presentation state actually changes.

Use history-free metadata synchronization for the TUI control path and scoped
pane recovery instead of full application/history refresh for every byte gap.
Retain the existing non-interactive CLI full snapshot behavior. Avoid fetching,
encoding or decoding all hidden histories for ordinary navigation/status updates.
Update protocol callers/fixtures/exports coherently; do not keep two competing
authorities. No new durable domain schema is assumed.

Command responses and unrelated pane/control updates must not await a slow pane's
HTTP history request. Preserve causal barriers: a command response is not native
readiness, and output cannot parse before its required geometry/control baseline.
Epoch/revision, connection, attachment, pane/runtime and recovery-request guards
must reject obsolete work. A delayed result may neither roll back a newer cursor
nor lose overtaking live chunks or equal-cursor resize markers.

### Ordered, Bounded And Fair Output

Maintain per-pane byte cursors and ordered geometry markers. Consume contiguous
ranges incrementally rather than rescanning the retained history each frame.
Release consumed queue storage promptly; bounded history retention is a separate
purpose. Native parser acceptance, not network receipt, defines consumption.

Bound aggregate queued bytes and work as well as per-pane retention; include
pending promises, encoded messages, HTTP recovery and transient copies. Existing
8 MiB transport/512 KiB inline/2 MiB live/1 MiB history budgets are checkpoint
behavior, not a performance solution or targets to increase again.

Schedule bounded parse/write slices fairly among displayed panes, allowing input
and shell work between slices. Cap each native write because a time budget checked
only after one huge synchronous write cannot provide fairness. Preserve parser
state across arbitrary byte boundaries and preserve resize/reply boundaries.
Prioritizing the focused pane must not starve visible siblings or passive mirrors.
Skipping intermediate paints is allowed; skipping required parsing is not.

Use consumption-aware delivery/backpressure if measurement demonstrates queued
delivery is the problem. A slow viewer must not block PTY reads, another viewer,
or unrelated control traffic. When bounded continuity is exhausted, enter the
approved pane recovery path once; avoid a global reconnect/resnapshot loop.

Limit sustained client output work to panes it needs to display, but only after
the gate proves how hidden panes retain correct terminal continuity and answer
required device queries. Output interest is not sizing eligibility, keyboard focus
or session selection. A hidden application's query must not hang indefinitely or
receive replayed/duplicate replies. Until this is resolved, visible-only output
subscriptions are not an independently shippable optimization.

### Preserve Existing Authority And Persistence

Keep shared durable session selection and independent session memories; stable
pane/process identities and PIDs; latest-active eligible viewer sizing; canonical
grid clipping; original output-time reply stamps; one authorized live response
and no historical responses. Preserve all three independent input gates and
away-and-back invalidation. A changed response-owner model requires an explicit
architecture amendment, including hidden-pane query handling.

No data reset, process restart or user-state cleanup is authorized. Preserve
bounded durable history and CLI commands/output. Protocol changes may require a
coherent daemon/client version, but restarting the user's daemon needs permission
because it stops child programs. Do not alter old dated specifications to pretend
these changes were always their design.

## Proposed Acceptance Contract

These budgets were accepted with the design. Use serial performance runs on the
user's macOS machine with WezTerm, fixed documented grids and no injected disk or
swap exhaustion. Also observe controlled background work without interpreting
every failure as an environment exemption. No universal real-time guarantee is
claimed on an arbitrarily overloaded machine.

### Workloads

1. **Visible pair:** real Neovim and OpenCode side by side, fast navigation,
   insert/edit, popup completion/dialogs and repeated popup dismissal. Use an
   isolated OpenCode home/session and no paid provider calls unless authorized.
   Deterministic VT fixtures cover equivalent redraw/mode patterns automatically;
   they do not replace real-application acceptance. Record versions/configuration.
2. **Expected capacity:** 50 live shell/terminal panes across multiple items with
   two or three tabs each, 10 complex-TUI workloads including the visible pair.
   The other 40 are idle shells or stopped panes; exercise both cases. At least
   eight hidden TUI fixtures redraw periodically while the pair is exercised.
   Use reproducible local fixtures for automation, not 10 paid AI sessions.
3. **Mirrors and switching:** two normal clients of different sizes, same and
   different session contexts; switch items/tabs among the 10 running TUIs while
   hidden output exceeds retained raw history, then edit immediately on return.
4. **Overload/recovery:** retain the existing four-pane 4 MiB burst unchanged;
   stall one viewer and delay one pane's recovery while another remains usable.
   Include retained-history rollover, same-cursor resizes, reconnect, confirmed
   detach/deletion and daemon cold restart as separate scenarios.

The measurement plan must freeze fixture byte rates, grids, durations, probe
counts and seeds before tuning; publish them with results. Use the existing
burst's 16 KiB/60 ms/64-redraw pattern unchanged. The accepted capacity fixture uses
eight hidden producers at 4 KiB/100 ms each, plus the visible interactive pair;
this is about 320 KiB/s hidden output, not a claim about every real AI workload.

### Responsiveness And Correctness

- Visible-pair and capacity interaction: at least 200 probes after warm-up;
  input-to-child p95 <=50 ms, input-to-visible p95 <=100 ms and p99 <=200 ms,
  with no sample >=1000 ms. Report distributions, not just an average.
- The existing burst retains its strict maximum `<1000 ms` assertion and passive
  final-frame checks. Run burst and Neovim rollover cases three times serially.
- Navigation to a running TUI at expected capacity reaches correct, input-ready
  current content within 250 ms p95 and never >=1000 ms over 100 switches.
  Separate control commit time from parser catch-up/display time.
- A deliberately delayed pane recovery must not add its delay to unrelated
  input/control paths. Assert this with deterministic held recovery in addition
  to end-to-end timings. Do not impose normal readiness latency on the stalled
  pane itself.
- No application-caused chooser/empty/blank flashes or native instance churn
  during same-context backlog/recovery/reconnect. Check rendered instance IDs,
  emitted frames and cursor behavior; manual WezTerm observation is required
  because missing placeholder text alone does not prove absence of flicker.
- All required bytes/resizes are parsed in order; final screens, modes and next
  input behavior are correct on both clients, with unchanged child identities.
  Test partial escape/UTF-8 boundaries, duplicate/query suppression and stale
  authority rejection, not only final text.

### Memory And Sustained Operation

Proposed capacity budgets after warm-up: <=512 MiB RSS per TUI process tree and
<=256 MiB daemon RSS for 50 panes. Exclude PTY child applications and report
their RSS separately; also measure the harness separately. These are acceptance
ceilings to validate, not inferred native capacity guarantees.

Run a 10-minute capacity/switch/recovery soak. After warm-up, application queue
bytes/tasks and native instance counts must plateau within explicit bounds;
after output stops they must drain to their documented retained baseline. Report
minute-by-minute RSS and heap/native measurements where available. Investigate
continued growth rather than automatically labelling RSS retention a leak.
The short soak does not certify all-day stability. If the budgets prove
unrealistic in direct-native measurements, return with evidence and propose a
revised budget before declaring success; do not quietly move the goalposts.

## Ownership, Compatibility And Verification

- Server application/runtime/history own PTY reads, bounded state and publication;
  API/connection owners own validated interest/delivery/consumption messages if
  selected by the gate. Keep one daemon and the existing client-safe export.
- TUI `client/` owns synchronization, pane queues, recovery and live authorization;
  `workbench/` owns native lifetime, parse scheduling, readiness and clipping;
  `shell/` owns stable presentation and local focus. Reusable `ui/` stays free of
  application recovery policy. Follow current enforced import boundaries.
- Reach all affected command/stream callers, protocol validation, HTTP tests,
  snapshot/geometry fixtures, CLI formatters, smoke scripts, client-safe exports
  and source-map descriptions. Keep capability tests in each owner's `tests/`;
  only cross-capability normal-entrypoint/load acceptance belongs in TUI `tests/`.
- Cover stale HTTP/live merge races, epochs/run replacement, missing byte/grid
  ranges, consumer progress, resource cleanup and bounded slow peers with focused
  tests before production fixes. No changed test may weaken a preserved contract.
- Final gates: connected independent code review, `bun run check`, repeated
  serial regressions, capacity/soak measurements and user physical acceptance of
  the real pair. A green suite alone does not satisfy the product goal.

Linux behavior, other host terminals, paid-provider throughput, all-day soak and
arbitrary VT extensions are not certified by macOS evidence. Record unsupported
native capabilities explicitly rather than advertising complete compatibility.

## Decisions Reserved For The Measured Amendment

The builder chooses instrumentation details and local file/function names.
The gate, not an unmeasured implementation, must settle:

- Which stages dominate latency/memory and which changes address them.
- Concrete consumption windows, scheduling/write budgets and readiness watermarks.
- Bounded hidden-pane continuity and exact recovery mechanism, plus response
  ownership when no viewer is present. Any native extension/dependency needed.
- Whether profiling justifies a different wire encoding, worker or transport;
  default to the current stack unless evidence says otherwise.

These are intentional feasibility decisions, not permission for the implementer
to choose a different correctness contract. Until the amendment is approved, only
the measurement/feasibility plan is ready to be written.

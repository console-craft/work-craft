# No-Fork Terminal Performance Experiment

## Status And Intent

Feasibility design with the builder's priority question resolved; not an approved
production rewrite. On 2026-10-22
the user requested a separate worktree/PR based on PR #41 to explore removing
OpenTUI patching while preserving its functionality and obtaining considerable
performance improvements. The user confirmed that no dependency patching is a
hard constraint and that further functionality/performance concessions must be
brought back explicitly. Hyperlink preservation is not an acceptance requirement
for this experiment.

The user subsequently clarified the performance priority: matching #41 is enough;
a slight slowdown is acceptable, but a major performance regression is not.
Further performance gains are optional. Do not require route B merely because
route A removes the fork without making #41 faster.

The independent worktree is `no-fork-terminal-performance`, on
`feat/no-fork-terminal-performance`, starting at PR #41's reviewed commit
`9cba83769685a72c96bc8382ac107262cc7b3f4a`. The original branch/PR remains untouched
as a reference. Its former same-branch execution constraint does not apply to
this explicitly requested alternative. This document does not authorize merging,
changing the original PR, replacing the installed app, or restarting user runtimes.

The next deliverable is evidence selecting a no-fork implementation route, or a
precise blocker. Production implementation follows a separately approved plan.

## Goals And Constraints

- Preserve daemon-owned session navigation, independent session memories, IDs,
  non-destructive migration, CLI behavior and persistent PTYs.
- Preserve canonical grids, latest-active eligible viewer sizing, mirrored output,
  local focus/overlays, keyboard/paste/Kitty release/mouse/focus reports, selection,
  copy and viewer-local scrolling. Preserve input and response authorization.
- Retain useful pane-local output/control separation, bounded queues, scoped
  recovery and stable presentation from #41 rather than starting over.
- Use unmodified registry releases, initially OpenTUI core/React 0.6.6. No private
  forks, `node_modules` source edits, prototype/instance method replacement,
  private native-handle access, or copying upstream implementations into the app
  to disguise a fork. Normal use of documented public APIs and app-owned
  renderables/input adapters is allowed.
- Keep Bun, React/OpenTUI, the single local daemon and current transport. A new
  terminal engine, worker, transport, remote service or library requires a new
  decision, not an incidental dependency addition.
- Hyperlink destinations/clickability may remain unsupported. Unicode text,
  width, styling and rendering must still work when output contains OSC8. Do not
  strip arbitrary output bytes to avoid the issue or weaken unrelated tests.
- No real user-state reset, user-process cleanup, installed-app replacement or
  paid provider calls. All probes use fixture-owned homes/processes.

## Why Removal Is Not Just A Dependency Revert

The current `workbench/terminal-input.ts` consumes the fork's
`EmbeddedTerminalInputRequest`; `terminal-viewport.tsx` installs its
`onInputAdmission` callback. Those are the direct production dependencies.
Callback wiring in `terminal-pane.tsx` supplies original authority/activity/sender.

Output parsing deliberately yields. Encoding before a received mode-setting
instruction has been parsed can produce incorrect arrow, paste, mouse or focus
bytes. Delaying already encoded bytes does not solve this. A solution must either
remove that stale-mode window or capture original semantic input and encode after
its finite required byte/grid frontier. Later output must not extend that frontier.
Cancellation must never replay input under new connection/navigation/runtime
authority, and actual focus/removal/destruction must not wait for child encoding.

The second fork extension preserves OSC8 URLs in composed native material. Its
cross-process application consumers are feasibility tests, not a production
projection pipeline. Dropping URL preservation removes that gate, but does not
prove complete projection, selection, input, capacity or recovery feasibility.

## Evidence Before Route Selection

The baseline full check initially reported 1,795 pass, 14 skip and two failures
in the installed native-contract tests. This was before application edits.
Installed `index.bun.js` had a different SHA-256 from the committed tarball.
A frozen forced install with an isolated Bun cache restored matching hashes;
both focused installed-contract tests then passed. The first failed run remains
baseline evidence, not a product regression or a passing check. The fresh full
baseline then passed artifact verification, lint/format/types, 1,797 tests,
14 existing gated skips, zero failures, build and relocated compiled smoke
(138.94 seconds for tests). Existing lint and React-act warnings remain. The
install did not change tracked files. This is macOS automated acceptance, not
Linux, physical-terminal or capacity/soak certification.

A throwaway package outside the worktree installs registry core/React 0.6.6 and
React 19.3.0. Six small tests, 18 assertions, pass:

1. The stock renderable reproduces stale arrow encoding before parsing the mode.
2. Public global key/paste/release listeners can prevent default dispatch and
   later use public key/paste encoders, preserving Buffer paste ownership.
3. Generic mouse `preventDefault`/`stopPropagation` does not suppress the stock
   embedded terminal's mouse encoder.
4. Native focus reporting is synchronous, separate from global key capture.
5. An app-owned headless context can encode key, paste, mouse and focus and drain
   one query response without a rendered terminal.
6. Public material extraction retains tested Unicode, wide-cell lengths, styled
   space and foreground color and renders a long OSC8 URL as ordinary linked text
   without preserving the destination.

These are capability probes, not an application candidate or performance result.
One initial probe expected legacy arrow bytes while enabling Kitty event reporting;
the corrected probe separates those mode windows instead of misclassifying native
Kitty encoding. Keep that distinction in later regressions.

Local reproducible probe package and frozen lockfile:
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/no-fork-probe-CCSDqN/`.
Run `bun test contracts.test.ts` there. Baseline logs are
`no-fork-terminal-baseline-check.log` and
`no-fork-terminal-baseline-fresh-cache-check.log` under the same approved temporary
root. Preserve the probe sources with any eventual feasibility handover; these
machine-local paths are not portable dependencies.

## Two Candidate Routes

### A. Keep Client Parsing If Public Seams Are Sufficient

First investigate the smallest route: retain existing replay/native presentation,
remove the fork dependency and adjust parsing/input scheduling using public APIs.
The existing output/control separation and bounded buffers remain reusable.

Any direct parsing or global input capture must prove all input kinds, ordered
resizes, native focus cleanup, finite frontiers and original authority. Keyboard-
only success is not enough. Do not silently drop mouse/focus support, replay
physical mouse events through the renderer later, or wrap focus/destruction.
Do not call an arbitrarily large synchronous catch-up a responsiveness solution.
Measure its longest blocking interval and end-to-end burst latency.

If this route requires forbidden internals, loses supported interaction, or fails
the preserved performance budgets, record that evidence and stop this candidate.
Do not keep layering workarounds onto it.

### B. Own Parsing/Encoding In The Daemon Through Public Native APIs

If A cannot satisfy the contract, evaluate the existing headless-parser direction
without hyperlink preservation. Keep one live parser per runtime and transfer
material presentation only for interested clients. Capture semantic input in an
app-owned presentation leaf and use the daemon parser's public encoders.

This removes the need to intercept `EmbeddedTerminalRenderable` before encoding,
but changes more application code. Public input-event translation, selection/copy,
independent scrollback, complete styles/cursor, hidden queries, cold history,
large-frame transfer and compiled packaging still need proof. Do not copy the
upstream key normalizer or assume that one successful arrow test proves Unicode,
layout alternatives and Kitty press/repeat/release compatibility.

Start with one real fixture-owned PTY and two differently sized viewers. Prove
next-input behavior after the old mode-setting prefix exceeds raw-history
retention, not just matching pictures. Only then assess capacity. Coalescing
already parsed pictures is allowed; dropping required terminal instructions is not.

This is an option to test, not a preselected architecture or production cutover.

## Comparison And Acceptance

Use #41's exact starting commit as the immediate comparison. Keep its original
workloads/deadlines, child identities and output correctness checks. Record
candidate commits, package versions, grids, byte rates, missing observations,
latency distributions and application/daemon/harness/child RSS separately.
Run performance comparisons serially, not alongside full tests or other probes.
Do not reboot or stop unrelated processes to obtain green runs.

Experiment success means preserving the baseline functionality (except the
approved hyperlink exception) without a major performance regression against
#41. Record absolute and relative latency/memory results; do not invent an
approved percentage for "slight." Bring ambiguous tradeoffs back with the actual
measurements. The original workload deadlines stay enabled. Original unmet
capacity targets below remain product targets, not new prerequisites for declaring
a baseline-equivalent no-fork experiment successful. Never call that equivalence
proof that #41's unresolved capacity/soak requirements have been met.

For a validated candidate:

- Run unchanged four-pane burst and Neovim rollover regressions three times each.
- Exercise normal tab/split/restart/dialog entry, mirrored clients, different-size
  ownership changes, reconnect-to-idle, stalled peers and delayed scoped recovery.
- Preserve mode/partial-sequence/resize/input-authority assertions. Reclassify
  only the explicitly waived hyperlink requirement with an explicit compatibility
  note; native-specific tests may be replaced by equivalent public-path behavior
  checks, not deleted to hide loss of functionality.
- Fix known test preconditions (including platform-specific shell prompts) without
  raising deadlines or weakening behavioral assertions. The review's geometry-gap
  replay finding remains a connected correctness issue; do not inherit it as an
  accepted limitation.
- Retain the existing accepted capacity targets: 50 panes, ten complex TUI
  workloads, eight hidden producers at 4 KiB/100 ms; input-to-child p95 <=50 ms,
  input-to-visible p95 <=100 ms/p99 <=200 ms, no sample >=1,000 ms; input-ready
  switching p95 <=250 ms, none >=1,000 ms; <=512 MiB per TUI process tree and
  <=256 MiB daemon RSS. These remain targets, not claims already met by #41.
- Repair the documented capacity harness's readiness weaknesses before trusting
  its numbers. Run short capacity checks first; do not repeat a ten-minute soak
  when simpler probes already falsify the route. Full capacity/soak and physical
  Neovim/OpenCode acceptance are required before claiming the overall goal met.
- Compare with main using equivalent workloads where its older protocol permits;
  disclose required harness adaptation. This comparison is explanatory, not a
  separate implementation project or a feasibility blocker. A better result than
  main must not hide a major regression against #41 or a correctness loss.
- Run `bun run check`, connected code review and compiled relocation smoke on
  the selected candidate. Report Linux/manual acceptance separately when absent.

The outcome is a recommendation with measured tradeoffs. If no route satisfies
the hard no-fork constraint and preserved behavior/performance, report that result
and ask before relaxing anything. Do not redefine success around what happened
to pass.

## Builder Check And Resolved Decision

A fresh read-only builder check found one consequential priority question:
does matching #41's performance while retaining its improvements over main
satisfy this experiment, or must the no-fork candidate also deliver substantial
additional speed/memory gains beyond #41? This determines when the smaller
client-parser route can stop successfully rather than requiring investigation of
the larger daemon-parser alternative. The user answered that matching #41, or
being slightly slower without a major regression, is acceptable. No minimum
additional improvement or relative percentage is required. Capability probes
alone still do not establish performance equivalence.

## Delivery And Next Authorization

Keep feasibility code explicitly experimental and separate from production
adoption. Preserve reproducible probes/evidence in the new branch when agreed;
do not edit the old dated specifications to pretend their requirements changed
retroactively. This document records the experiment's new hyperlink exception.

After approval, write a bounded feasibility implementation plan. A successful
feasibility result selects the route for a subsequent production plan; it is not
permission for an unreviewed architecture change. Publish the separate draft PR
with the baseline, remaining blockers and current scope stated clearly. No merge
or installed-user cutover is implied.

## Research Continuation Approval

After the first feasibility handover, the user explicitly approved continuing
daemon-route research with one additional known visual limitation: stock OpenTUI
0.6.6 loses the second cell's styling/background when a two-column character is
invisible. This supplements the hyperlink-destination exception **for research
only**; it is not approval to ship the limitation or adopt a production design.

The original failed assertion remains diagnostic evidence, not an upstream fix.
Further experiments may characterize that exact loss without letting it block
the remaining daemon-route correctness tests. No other text, width, style,
keyboard/paste/Kitty, mouse/focus, selection/copy, authority or lifecycle loss is
waived. Matching #41's performance remains sufficient; no major regression is
accepted. Production source/dependencies and #41 remain unchanged.

Resume the deferred real-PTY/two-viewer and public-interaction feasibility gates
before performance comparisons. Report additional concessions explicitly. The
[continuation plan](../plans/2026-10-22-no-fork-daemon-continuation.md) bounds this
next correctness-only slice; measurement remains a later gate, not a claim.

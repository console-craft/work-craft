# Output Separation And Native Projection Gate — 2026-10-22

## Current Checkpoint — Native Amendment Automated Acceptance Passed

The approved native amendment and connected raw-path review repairs now pass the
macOS application gate. Fresh `bun run check` passes artifact verification, lint,
formatting, types, **1,797 tests / 14 existing gated skips / zero failures**,
12,770 assertions across 133 files (143.84 s), production build and relocated
compiled smoke. Unrelated dependency upgrades accidentally introduced during cache
refresh were removed; the final check uses the original unrelated locked versions.

Two deterministic regressions close the remaining input/readiness work:

- A received canonical-grid change temporarily withdrew native readiness and
  physical focus from an already-authorized terminal. Real two-client tracing
  reproduced lost printable input; injecting a physical key at the real native
  resize operation reproduces it deterministically. The focused live leaf now
  retains physical focus and queues input until its captured grid frontier is
  consumed. Initial entry, failed writes, recovery and revoked authority remain
  gated; no synchronous backlog drain or replay under new authority was added.
- The shared-session test helper could reuse a visible cursor from before the
  entry gesture. A paused owned-TUI regression proved that false readiness.
  Readiness now requires fresh cursor output after that gesture, using absolute
  byte counts so bounded observations work too. No deadline was extended.

The profiling mismatch was demonstrated separately: raw counting began after
startup, but outer output already included 28,386 startup bytes. The user approved
aligning those windows. Both counters now subtract their recorded start values,
and `result.json` records independent start/end counters. The original strict
`rawBytes > outerBytes` assertion and all latency deadlines remain enabled.

Final serial burst runs pass all 29 original assertions each; final Neovim rollover
runs pass all 82 original assertions each. The 16-KiB/60-ms/64-redraw workload and
strict maximum below 1,000 ms are unchanged. The broader application/shell suite
also passes **801 tests / 4 gated skips / zero failures**, including mirrored
sessions, entry/restart/split/dialog, query and normal Hyper-tab behavior.

Native source remains `962066d80d775a24f9d733a20a915d129a5c52ef`; the complete
tarball/source patch/manifest set and installed native-contract tests are verified.
The independent native correctness review and separate reproduction check, followed
by its single regression-tested fix pass, are complete. No second application
correctness review was dispatched or review counter reset.

Local implementation commits: `96fe3a7` (scoped recovery/ingress repairs),
`247fb2a` (supported native admission, refreshed artifacts and material gates),
`839225f` (matched profiling windows and fresh-cursor acceptance). All normal
commit hooks passed; none were excluded for these commits. A fresh candidate
checkout with an empty cache and the final scoped lock passes frozen install,
artifact verification and installed native/one-core contract tests.

The final native source patch SHA-256 is
`714918b157216427c32f451b8e825ed186925a6f76a060426cf8208e39cd10db`;
all ten archive checksums are in `vendor/opentui/manifest.json`. Tools: macOS arm64,
Bun 1.4.3, Zig 0.16.0, Node 26.5.0, existing Homebrew LLVM 22.1.8 for cross-builds.
Full local execution logs and rulings are preserved in the accepted evidence
archive at
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/native-contract-accepted-evidence-Z5hfGG/`;
the completed amendment's scratch workspace is removed only after that copy is
verified. The earlier output/projection plan's workspace remains untouched.

**Limits:** historical CLI cleanup/chooser-startup timeouts did not recur in final
full checks and were not separately root-caused; do not describe them as repaired
by the grid fix. Existing lint and React-act warnings remain. The Minor React
packed-check musl-selection finding is deferred. Original broader projection/input/
query/large-frame feasibility, capacity, ten-minute soak, physical WezTerm/OpenCode/
Neovim, Linux and all-day acceptance remain uncertified. No production parser/query-
owner cutover, registry publication, paid calls, user-state reset, push or merge.

## Earlier Native-Amendment Checkpoint — Blocked At That Time

The approved [native amendment plan](../plans/2026-10-22-native-terminal-contract-amendment.md)
has implemented its native contracts and artifact delivery. Native source is
committed at `962066d80d775a24f9d733a20a915d129a5c52ef` in the dedicated
`work-craft/native-terminal-contract` worktree, based on published 0.6.6
`212eb27da4adf5b907031ad153fc6a5b9f713fbf`. The independent correctness review
and separate reproduction check confirmed five Important defects; their one
scoped RED→GREEN fix pass covers Buffer-backed paste ownership, pre-callback
removal invalidation, original mouse lifetime, blur re-entry, and hidden-wide
OSC8 URL/style preservation in both native composition paths.

Native verification: **2,140 pass / 33 skips**, lifetime **32/32**, Bun
**6,198 pass / 23 skips / 32 existing TODOs / zero failures**, Node
**5,440 pass / 4 skips / 32 existing TODOs / zero failures**. Root build,
all eight cross-target builds, packed core Bun/Node, packed React and standalone
checks pass. The Minor musl selection issue in the React packed-check script is
deferred; Linux runtime acceptance is not claimed.

The refreshed ten `0.6.6-workcraft.1` tarballs, complete source patch and checksum
manifest are in `vendor/opentui/`, **not yet committed**. A separate baseline-plus-
patch worktree rebuild passes 161 public/input/material tests and 12 native OSC8
tests. A fresh full candidate checkout with an empty Bun cache passes frozen
installation, artifact verification and installed Buffer/hidden-wide/one-core
consumer tests. Same-version cached artifacts initially survived `bun install
--force`; only owned OpenTUI lock entries were regenerated through an isolated
cache, retaining integrity checks. No installed dependency files were patched.

Work Craft's supported-hook queue/adoption and existing recovery repairs remain
**uncommitted**. No native methods are wrapped; actual focus/selection stays
synchronous, while bounded FIFO requests preserve their original authority,
sender and finite frontier. Exact `https://example.test/λ` now survives child JSON
and separately owned TextBuffer/View drawing, including overwrite/destruction
cleanup. The original server assertion is still enabled. Connected suites pass
**888 tests / 10 skips / zero failures**, 6,533 assertions across 43 files.

The full `bun run check` is **red**: lint/format/types pass, then
**1,790 pass / 14 skips / 5 failures**, 230.10 s. Failures:

- CLI shared-navigation test: cleanup could not confirm shutdown before its
  existing deadline; its temporary home was preserved. Its lock was absent on
  later read-only inspection. No real daemon was stopped or reset.
- Controls demo textarea startup timeout.
- Empty-install session chooser timeout.
- Switch-key chooser startup timeout.
- Two-client local-session chooser startup timeout.

The unchanged isolated entrypoint suite subsequently passes 15 tests; that is
diagnostic evidence, **not a repair** or a waiver of full-run failures. Profile
support checks pass 17 tests / 4 existing gated skips. Fresh three-probe serial
direct/native/application calibration reports raw bytes 49,360 / 49,360 / 53,768;
application outer bytes 44,599, all probes received/observed without timeout.
The earlier `49,650 <= 50,227` failure remains unexplained; no assertion was
changed and no measurement premise was waived.

Acceptance stops here under the plan's red-gate rule. Build/compiled smoke were
not reached by this check; the amendment's new three-run burst/Neovim acceptance
sequence has not run. No application acceptance commit, second implementation
review, push, merge, parser/query-owner cutover, paid calls or user-state operation.
The latest execution ledger/logs are
`.superpowers/sdd/2026-10-22-native-terminal-contract-amendment/`.

## Historical Pre-amendment Handover

The earlier missing-contract evidence and decisions below are preserved as history;
the native implementation and current blockers above supersede its status claims.

## Decision: BLOCKED, no production cutover

Tasks 1–4 of the approved
[plan](../plans/2026-10-22-output-control-and-projection-gate.md) are committed.
The connected review found four Important raw-path defects. The single fix pass
has targeted passing regressions, but is **not verified complete**: normal-entrypoint
tab focus still fails in full runs, and the latest run also failed an output-profile
byte-count assertion. The branch is **not ready to merge**. Task 5 reached a
real missing native contract and stopped. Tasks 6–7
and Task 8's success/cutover-planning path have not run. Neither hidden-interest
delivery nor daemon-owned query/semantic-input transport has been enabled.

The native parser's OSC8 hyperlink cell has no link identity or resolved URL.
This is observed before JSON transfer or client painting, not attributed to
transport, React, or performance. Do not replace this gate with a fallback
emulator, inferred hyperlink parser, private-handle access or a weaker assertion.

## Verified First Slice

| Commit    | Change                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `f064ecf` | Pane-local output outside root React control state                      |
| `d1c82d0` | Incremental acknowledged consumption, fair 8-KiB/2-ms draining          |
| `28c200c` | History-free control synchronization and scoped bounded pane recovery   |
| `8f089ec` | Same-session transient presentation; runtime/reset-only native identity |

The last full check before the native gate passed lint, formatting, types,
**1,751 tests / 14 gated skips / zero failures**, build and isolated compiled
smoke (136.94 s tests). The existing `no-unsafe-finally` warning remains.
Three serial Task 2 burst runs passed the unchanged strict maximum below
1,000 ms; three Neovim rollover runs passed all original 82 assertions each.
The real child-side OSC11 deadline regression changed from 3,473.91 ms RED to
below 1,000 ms. Held reconnect retains the actual body/native object and child
PID with no new shell spawn. These checks do not certify the capacity budgets.

## Connected Review Fix Pass — stopped, uncommitted

The one fresh review reported no Critical or Minor findings and four Important
findings. No second review was dispatched. The following are candidate fixes
with targeted evidence, not a completed/accepted fix pass.

| Finding                                                 | Fix and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missed output followed by silence on reconnect          | Every connection marks retained panes recovering and requests scoped catch-up at native acknowledgement. Input is gated until completion/finite consumption; retained native focus remains a picture, not authority. Idle reconnect regression RED→GREEN.                                                                                                                                                                    |
| Input encoded before received mode changes              | A concrete bounded leaf-local queue captures the byte/grid frontier and original input authority/activity before invoking public native key/paste/mouse/focus methods. Later coalesced bytes cannot overtake it; stale scope cancels. Application Up, bracketed paste, mouse, focus and Kitty release, crop coordinates, away/back revocation and bounds/cleanup have regression coverage. Initial ordering tests RED→GREEN. |
| Pending store messages bypassed transport bounds        | Store ingress independently counts pending serialized bytes against the existing 8-MiB ceiling; overflow rejects/reloads and captured run/connection identities invalidate queued obsolete work. Held 600×16-KiB flood regression RED→GREEN.                                                                                                                                                                                 |
| No-change recovery permanently suspended a failed write | Successful scoped completion publishes recovering:false even with unchanged bytes; failed writes remain unacknowledged until a successful native write. Completion/resumed-display regression RED→GREEN.                                                                                                                                                                                                                     |

The fix pass also reproduced and fixed a fast-completion race: a control render
could disable native focusability, but completion overtook the scheduled drain
before readiness was withdrawn. Recovery now invalidates leaf readiness at
publication; successful finite consumption re-enables it. Existing native focus
and entry assertions remain unchanged.

Earlier connected first-slice suite: **869 pass / 10 gated skips / zero failures**,
6,245 assertions, 40 files, 29.71 s. Fresh serial burst runs 1–3 passed all
29 original assertions each (4.86/4.86/4.83 s); Neovim rollover runs 1–3 passed
all 82 original assertions each (4.17/4.18/4.09 s). Budgets were not relaxed.
These isolated tests do not certify the full workload target or override the
later full-run failures below.

Further testing reproduced a teardown defect in the input bridge: a queued blur
could leave renderer focus pointing at a destroyed terminal. A deterministic
RED→GREEN regression now requires destruction to release focus synchronously.
Three unchanged isolated normal-entrypoint Hyper-tab tests then passed all
22 assertions each (1,104/1,100/1,032 ms), but the subsequent full run **still
failed second-terminal entry**. That remaining timeout's root cause is not
established. The latest output-profile failure is also unresolved: raw bytes
49,650 were not greater than outer bytes 50,227. Neither assertion was changed.

The public embedded-terminal API exposes key/paste encoders but keeps the native
handle, mouse forwarding and focus-report encoding private. There is no public
pre-encoding admission hook. Wrapping focus/blur to defer encoding couples that
ordering to native focus lifecycles. A public native admission hook is a candidate
contract amendment, **not a proven repair** for the remaining timeout. Revisit
this boundary before another implementation attempt; do not add private-handle
access, guessed focus bytes or weaken the normal-entrypoint gate.

## Small Native Gate Result

Command:

```sh
bun test packages/server/src/terminal/tests/projection-feasibility.test.ts packages/tui/src/workbench/tests/projection-feasibility.test.tsx
```

Observed: **4 pass, 1 fail, 17 assertions, 95 ms; exit 1**. The failing
assertion is intentionally preserved as an unmet acceptance contract, not
skipped or converted to an expected failure.

Latest `bun run check` passes lint, formatting and types, then reports
**1,770 pass / 14 gated skips / 3 fail** (12,444 assertions, 129 files,
139.35 s). Failures:

- `normal entrypoint Hyper tab switching and creation send sentinels only to the intended PTYs`
  — second-terminal entry timeout; recurred across full runs despite isolated passes.
- `application comparison matches the native grid and flushes enabled child traces`
  — raw byte-count assertion, unresolved.
- `OSC8 hyperlink cells expose a resolved URL rather than a native link ID`
  — original unchanged native blocker.

The check exits 1 before build. Fresh separate production `bun run build` and
`bun run build:smoke` both pass on the latest source; logs are
`review-stopped-build.log` and `review-stopped-build-smoke.log`. Neither
certifies compiled packaging of the native parser fixture or cures the red suite.
The existing lint warning remains. Intentional store-only/precommit fixtures
also emit React `act(...)` warnings when recovery withdraws leaf readiness
synchronously; their original precommit rejection assertions still pass.

| Property                                                                        | Result        | Evidence / limits                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Resolved Unicode cells                                                          | PASS (small)  | `λ`, `🙂` width 2 plus width-0 tail, decomposed `e\u0301`, default opaque colors; copied synchronously before releasing the public lease |
| Styled blank / cursor                                                           | PASS (small)  | Native attributes 13 (bold/italic/underline), RGB 17/34/51 and 68/85/102, steady bar cursor                                              |
| Independent browsing / modes                                                    | PASS (small)  | Offset 3 restored to neutral; viewer at 0 unchanged; append reaches neutral view; application Up and bracketed paste bytes retained      |
| Cross-process native drawing                                                    | PASS (small)  | Headless child JSON material painted by a different native renderer context; exact Unicode, styled space, colors and cursor assertions   |
| Hyperlink material                                                              | **BLOCKED**   | OSC8 `https://example.test/λ` around `L` yields text `L`, attributes 0, public `getLinkId(...)` = 0, no URL                              |
| Selection/copy, clipping, complete styles, alternate-screen input/browsing      | NOT CERTIFIED | Broader Task 5 coverage stopped at the native mismatch; painted text is not proof of native selection/copy                               |
| Cross-process PTY input / hidden queries / cold-history modes / authority races | NOT RUN       | Task 6 stopped; the first-slice production raw input gates have separate tests                                                           |
| Large atomic frames / ingestion backpressure / allocation-failure cleanup       | NOT RUN       | Task 7 stopped; small-fixture `finally` cleanup is not a capacity/resource-failure certification                                         |
| Compiled native parser fixture / client-safe packaging                          | NOT RUN       | Production compiled smoke passed before this gate; the new native server dependency still needs Task 7 packaging proof                   |

Supported public APIs used: `resolveRenderLib`, checked context/embedded-terminal
creation/write/resize/compose/scroll/encoding, buffer leases and resolved chars,
`getLinkId`, `contextGetLinkUrl`, RGBA accessors, and native Renderable drawing.
No native glyph or link IDs cross the JSON boundary. The server dependency is
the same installed **@opentui/core 0.6.6**, pinned exactly; no native upgrade.

## Missing Contract And Requested Decision

Smallest native contract: an OSC8-linked embedded-terminal cell must preserve
its hyperlink through composition, exposing a context-owned link ID whose
public `contextGetLinkUrl` resolves the exact original URL while the frame is
copied. Destination-context link drawing/selection still needs proof afterward.
The API for resolving a link already exists; this observed cell never receives
a link ID. No claim is made that the previous raw Work Craft path already
supported OSC8 hyperlinks.

Choose a reviewed amendment before further implementation: extend the native
embedded-parser contract, or explicitly revise the hyperlink requirement after
confirming its compatibility consequences. The current approved gate cannot
be called passing. Do not silently exclude the failed case.

Separately, decide whether to amend the installed native input contract with a
public pre-encoding admission hook, rather than continue wrapping focus lifecycles.
This decision does not authorize Tasks 6–7 or constitute a production parser
cutover plan. Existing raw-path review findings must still pass full verification.

## Remaining Acceptance And Artifacts

50 panes / 10 complex-TUI workloads, complete 10-minute soak, memory/latency
budgets, physical OpenCode/Neovim in WezTerm, Linux and all-day stability remain
uncertified. The earlier capacity/aborted-soak evidence is not superseded by a
passing small correctness suite. No paid provider calls or user daemon/state
restart/reset were performed.

Execution evidence is retained under
`.superpowers/sdd/2026-10-22-output-control-and-projection-gate/`, including
`review-check-4.log`, prior full-run logs, `review-connected-final-2.log`, `review-build-smoke.log`,
`review-{burst,neovim}-{1,2,3}.log`, the RED logs, and the authoritative
`progress.md` ledger. The native gate files, exact dependency addition and
approval/progression documentation AND all candidate review fixes remain
uncommitted. No fix-pass commit was made because the completion contract is
unmet. Committed HEAD remains `8f089ec`. Scratch evidence is retained because
both the native gate and first-slice fix pass are blocked, not complete. This
is not a merge request.

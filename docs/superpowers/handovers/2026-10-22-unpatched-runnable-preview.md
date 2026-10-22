# Unpatched runnable preview — 2026-10-22

## Current integration decision (supersedes the delivery record below)

The user manually tried the stock-OpenTUI preview, accepted its performance
baseline and the regional-indicator spacing defect, and approved finishing this
experiment through a child PR into `feat/shared-session-navigation` (#41).
**Keep #41 open and unmerged into `main`.** Earlier no-push/no-merge and
manual-acceptance exclusions below describe the previous local-delivery checkpoint,
not the current authorization. No installed command replacement, preview reset,
additional benchmark campaign, rendering research or history implementation is
part of this integration.

### Follow-up on #41 before considering the combined work ready for main

1. **Start with obsolete fork/experiment cleanup.** Remove unused code and tests
   only after checking their callers; do not delete active regression coverage or
   stock-package provenance/resolution guards. Remove the old `vendor/opentui/`
   directory (the actual path, not `vendored/`),
   `scripts/verify-opentui-artifacts.ts` and its now-obsolete tests. Update
   `package.json`'s `check` script to stop requiring validation of the unused
   private-fork archives. Keep dated specifications as decision history rather
   than rewriting them, and retain useful failure diagnostics until their purpose
   is assessed. Run the remaining full check and confirm registry dependencies
   still resolve without the vendor directory. This is a focused cleanup, not a
   redesign or permission to remove tests merely because they fail.
2. **Restore cold-history display (confirmed compatibility loss).** Original #41
   at `9cba837` fetched durable output in `packages/tui/src/client/store.ts` and
   replayed it through `packages/tui/src/workbench/terminal-viewport.tsx`. The
   experiment retains output in SQLite but starts a fresh daemon-owned parser
   without restoring that display. Restore access to retained output after a
   daemon restart, without replaying historical terminal modes into a fresh live
   shell. Preserve daemon input/query authority, generation isolation, bounded
   storage/resources and cleanup; do not reintroduce dependency patches or forks.
   Start with `packages/server/src/application/app.ts` (`recoverOnce`),
   `packages/server/src/terminal/runtime.ts`, the durable history APIs and the
   material viewport. Verify restart with output spanning several screens, the
   transition to the new shell, ordinary client reconnect, stale-mode isolation,
   resource bounds and cleanup through the actual daemon/TUI path.
3. **Assess exited scrollback, then decide; implementation is not preapproved.**
   The old renderer retained scrollback, but source inspection found that mouse
   wheel fallback went through input admission requiring a running shell. Thus
   browsable exited scrollback is **not a confirmed user-visible regression**.
   Compare an exited pane with several screens of output on original #41 and the
   combined branch; distinguish a command finishing inside a live shell from the
   pane's shell exiting. Record the observed behavior and the user's decision
   before deciding whether to implement it. The experiment currently freezes one
   picture and destroys the parser at exit. Any future history browsing must stay
   read-only and bounded, and must not reopen input authority or retain stale modes.
4. Record completion of cleanup/restoration and the scrollback decision on #41, rerun
   required checks, and reassess readiness before any merge to `main`.

### Accepted evidence and remaining limits

**2026-10-23 follow-up:** CI run `39846606999` failed ten tests: six assumed
machine-specific temporary directories, two required the macOS shell prompt, and
two raced terminal focus/split readiness. The local follow-up removes those path
and prompt assumptions and tightens test synchronization without skipping tests,
increasing deadlines or changing application authority. The broad cleanup above is
still deferred. Do not call CI green until these changes are pushed and verified
on Linux. Local full-check attempts also hit the previously observed Bun/native
unexplained synchronous child-wait stall; captured stacks show a child wait, but
the responsible call site/upstream cause is not established. A speculative async
hook-fixture change did not remove it and was reverted. Built-in one-worker file
isolation also passed a direct run but stalled under the full check, so that
configuration was reverted too. The test script and focus helper remain unchanged;
the underlying failure is not an established spawning-API defect.

Bun 1.4.3 automatically suppresses passing-test output under `AGENT=1`. Removing
that marker made the ordinary reporter available for diagnosis, but did not
prevent the stall. It located the blocked test in
`server/src/terminal/tests/projection-runtime.test.ts`: fresh runtime mode isolation.
Both shell fixtures now wait for the parent to observe their expected output
before explicit exits, instead of racing setup/input drain with immediate
termination. All mode-isolation and old-child-exit assertions remain. The normal
full `bun run check` then passed **1,830 tests / 17 skips / zero failures**, plus
lint, formatting, types, compile and compiled smoke. The standard test script is
unchanged, and no diagnostic preload, worker setting or spawning-API patch remains.
Normal commit/push hooks and subsequent Linux CI must still confirm integration;
this is a deterministic fixture fix, not a claimed upstream Bun/macOS repair.
The subsequent readiness diagnosis captured zero new output on the second entry
while the old cursor remained visible. The regression now establishes actual
shell input with a computed-output round trip before freezing the TUI; it still
asserts that a paused TUI cannot satisfy a new entry from its old cursor. This
passed **20 repeated runs**, and the affected acceptance/portability suites passed
**28 tests** with `TMPDIR` unset and a Linux-style shell prompt. The production
application and `focusSharedTerminal` are unchanged.

The stall did not reproduce in four instrumented full runs (about 158–165 seconds
each); this does not prove it eliminated. Correct the earlier interpretation:
macOS `ps` state `E` means trying to **exit**, not being stuck in exec. Trace
evidence and the small shell-spawn probe live in the session's approved temporary
directory. Do not change more spawning APIs without identifying a failing call.

The final integration-tree `bun run check` passed: **1,830 tests / 17 skips /
zero failures**, plus lint, formatting, types, normal compile and compiled smoke.
One preceding full-check attempt timed out; a bounded diagnostic rerun completed
in 164 seconds. The earlier intermittent spawn stall is not claimed fixed.

The manual trial establishes user acceptance of this experiment's baseline, not
performance equivalence or universal fidelity. The visible RI spacing defect
remains accepted; its following-column positioning must remain intact. Linux,
soak, benchmark parity, hyperlink destinations and invisible-wide styling remain
uncertified as documented below. Existing paste/frame ceilings remain explicit
bounded failures, not permission to truncate data or silently expand resources.

Keep the current preview binary, provenance and dedicated seeded home available;
do not replace `/Users/ovi/.local/bin/work-craft` or modify the normal home.

### Integration checklist

- [x] User accepts the manual preview and approves child-PR integration only.
- [x] Record cold-history restoration and exited-scrollback assessment above.
- [x] Complete normal commit/push gates and merge #43 into #41's branch (`7ab94ae`).
- [x] Update #41 with this handoff and keep it open, unmerged into `main`.

## Historical local-delivery record

## Delivery scope

Branch `feat/no-fork-terminal-performance`; original #41 unchanged. The approved
real-app cutover is `04d996f`, following material promotion `583a70e`. The
[preview-only visual waiver](../specs/2026-10-22-no-fork-preview-visual-waiver.md)
allows the regional-indicator defect, not broader correctness/data-safety losses.

- Checkout: `/Users/ovi/.local/share/opencode/worktree/c4185d/no-fork-terminal-performance`
- Executable: `<checkout>/dist/work-craft-preview`
- Provenance: `<checkout>/dist/work-craft-preview.provenance.json`
- Compiled graph: `<checkout>/dist/work-craft-preview.graph.json`
- Dedicated seed home: `/Users/ovi/.local/state/work-craft-preview`
- Seed inventory: `<home>/preview-seed.json`
- Protocol in health and stream handshake: `work-craft-projection-preview/1`
- Native darwin-arm64 SHA-256: `dc9a57941c499acdaac24f723bfc7fcf81cb444fa0f1f3334b9741b19f643522`

Use [the short launch/manual guide](../../no-fork-preview.md). No installed command
was replaced; no push or merge is authorized. The preview uses exact registry
OpenTUI core/React0.6.6 and React19.3.0, never historical vendor assets.

## Evidence and limitations

Task2's full `bun run check` passed lint, formatting, types, **1,821 tests / 17 skips /
zero failures**, normal compile and relocated compiled smoke. The actual normal
two-client/shared-session tests covered reconnect, canonical-size activity elections,
keyboard/paste/mouse/query flow and editor behavior. A known baseline timing failure
(`terminal focus readiness cannot reuse a cursor shown before the entry gesture`)
occurred in an earlier full run and first commit hook; isolated unchanged reruns
and normal retries passed. No deadline changes, bypass or claim of fixing that flake.

Preview-specific tests verify incompatible/missing identities, safe/default and
explicit homes reaching the actual spawned daemon, native override refusal,
masquerading vendor resolutions, managed seeding/reset/backup/integrity, retained
memberships/selections/cwd/status and preservation of unrelated files.
The build compares every installed file in core, React and the current native
package against integrity-verified registry archives. The relocated preview smoke
uses the actual compiled daemon, cold-launch example, material and semantic
paste/key requests, then verifies the owned daemon exits.

The seeded example is durable restore-policy data for one real `/bin/sh`, not a
test runtime or second renderer. It prints on clean runtime creation despite the
cold-history display gap. It labels the regional-indicator spacing defect and
shows its following-column marker, normal wide/combining text and styled blanks.

Additional limits are explicit: cold history is not displayed/replayed into fresh
input modes; exited scrollback is not browsable; native paste ceiling1MiB;
unique-color material/envelope ceiling8MiB; hyperlink/invisible-wide fidelity
remains research-only. No performance equivalence, user/manual acceptance, Linux
validation, soak or shipping approval is claimed. Original fidelity diagnostics
remain red opt-in evidence; see `docs/tui-source-map.md` for the migration map.

## Decisions made during execution

- `writeSemantic` returns `Promise<boolean>`, awaiting real PTY drain and reporting
  whether bytes were forwarded. Arbitrary shells have no fixture child-IPC ack.
  Cost: flushing is not program-level processing acknowledgement.
- The prior unsupported-mode2048 workaround moved to the daemon's single reply
  boundary, preserving application compatibility without modifying dependencies.
- The seed's backup uses SQLite `VACUUM INTO`, not a bare WAL-mode file copy; its
  integrity is checked before managed destruction. Socket existence checks use
  filesystem metadata, not `Bun.file().exists()`, which does not recognize sockets.

## Preview-specific execution record

Fresh Task3 `bun run check`: **1,828 pass / 17 skip / zero failures**, lint,
formatting, types, normal compile and compiled smoke, exit0. The first run caught
one fake HTTP stream fixture missing the now-required identity; it was migrated,
not bypassed. Preview build/provenance and relocated smoke also passed, exit0.

The dedicated home was absent and freshly created: no reset/backup was needed,
and the normal Work Craft home was not changed. Its pre-existing backup remains
`/Users/ovi/.local/state/work-craft/backups/before-reseed-2026-10-22T14-05-30.992Z.sqlite`.

- Playground: `3d490cf5-0e23-4e9d-84e1-47e2fda67e09`
- Focus: `47eec01c-e3f7-425e-ac1f-d5fdc6ce3c62`
- Rendering playground item: `1f4741a2-3089-4656-824f-759117caf9c5`
- Example pane: `2dab05a5-91c3-4eef-b381-714593eba84c`

The seed command completed with the daemon stopped. The inventory includes both
session memberships/selections, five items, two tabs and three verified live shell
records before managed stop. The cold-launch example is verified separately by
the relocated compiled smoke.

## Final independent review and fix pass

One fresh-context read-only whole-preview review found no Critical or Minor
issues and two Important mouse issues: unpressed hover was encoded as a drag,
and local selection bypassed renderer selection/clear and extended after release.
Both were reproduced RED with actual raw-SGR renderer events. The bounded fix
filters lifecycle events, preserves real button state, and uses public renderer
selection callbacks/start/update/clear after the daemon declines mouse forwarding.
The real drag/release/hover/copy/clear regression and child native-encoding
regression are GREEN. No dependency code was modified and no re-review was used.

Post-fix full `bun run check`: **1,830 pass / 17 skip / zero failures**, lint,
formatting, types, normal compile and compiled smoke, exit0. Preview build and
relocated smoke are repeated against the final delivery sources.

Two delivery commit attempts stalled in synchronous spawned children in the
normal hook test runner; one timed out and one was explicitly aborted after
collecting process/stack evidence. No hooks were bypassed or test deadlines
changed. The normal full check passed before and after the review fixes. Commit
hook completion is separately verified, not inferred from those successful runs.

### Review exclusions retained

- RI glyph fidelity: user-waived preview defect; cost is visible narrow glyphs,
  not permission to move following columns.
- Hyperlinks/invisible-wide styling: research-only; cost is missing link metadata
  and incomplete hidden-wide fidelity.
- Large unique-color frames/native paste ceiling: explicit bounded failures; cost
  is rejected over-limit work, never truncation or expanded limits.
- Cold display/exited scrollback: disclosed absent; cost is incomplete history
  presentation after daemon restart/exit, never installing stale live modes.
- Program processing acknowledgement: not provided; real PTY drain only.
- Manual/physical, parity, Linux and soak: deferred to the user's next prompt;
  these properties remain unverified.
- Merge/shipping/install/publishing: not authorized; this is a local preview only.

## User-first handoff

After the user's request to stop spending time on delivery ceremony, commit retries
were abandoned. Task3 and the review fixes remain uncommitted/staged in this
worktree; Task2 remains HEAD. No hook success is claimed. The final preview binary
was rebuilt **after both mouse fixes**, registry provenance regenerated, and its
relocated compiled smoke passed again (`handoff-build.log`, `handoff-smoke.log` in
the execution ledger workspace). The seeded home remains stopped for the user's
launch. No further full-suite runs, commit attempts or evaluation are in progress.

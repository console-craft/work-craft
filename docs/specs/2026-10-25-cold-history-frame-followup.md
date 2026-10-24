# Cold-history frame equality: open follow-up

## Status and preserved contract

Open. PR #47's documentation-only head `29f6fef` passed
[Linux/macOS product CI](https://github.com/console-craft/work-craft/actions/runs/40133981123)
and [both tooling jobs](https://github.com/console-craft/work-craft/actions/runs/40133981025).
That green run does not repair the earlier mismatch; the failing assertion and
application code were unchanged by that commit.

Owner: `packages/tui/src/tests/cold-history.test.ts`, the real two-client cold
recovery case. While A browses retained output, B must stay at its own bottom.
Preserve exact full-screen equality (including the status bar), durable history,
fresh-shell input, one-shell/reconnect and independent-scroll assertions. Do not
crop frames, recapture B's baseline after A scrolls, add skips or raise deadlines.

## Latest unresolved failure

[macOS CI at `7135572`](https://github.com/console-craft/work-craft/actions/runs/40133426237/job/120989814148)
completed runtime tests, then failed `expect(b.frame()).toBe(bottom)` at line 138:
`COLD-159-42` stayed the top retained line, but the recovery marker's wrapped suffix
and the prompt placement changed near the bottom. Result: 293 pass, five existing
skips, one failure, 131.85 seconds. Linux passed. macOS build/smoke did not run.
This is a frame assertion failure, not the repaired native PTY exit deadlock;
upgrade causation has not been established.

The same-host Bun 1.4.4 diagnostic
[passed acceptance and 200 runtime-prefix repetitions](https://github.com/console-craft/work-craft/actions/runs/40133539123).
Neither that pass nor the later docs-only CI clears this failure.

## Established earlier cause and limits of its correction

- [Original failure](https://github.com/console-craft/work-craft/actions/runs/40094285263/job/120873180276):
  B's top changed from `COLD-160-42` to `COLD-159-42`, losing a trailing blank row.
  It also occurred in the
  [direct, unsupervised acceptance comparison](https://github.com/console-craft/work-craft/actions/runs/40093972232).
- Controlled native projection and the owning real-process test reproduced that
  exact displacement without scrolling: recovery material at 80x24 appeared in
  B's 25-row viewport, then canonical resize to 108x38 changed the cropped picture.
  The test retains a controlled viewer, waits for the 24-row phase, releases it,
  then waits for B's measured `COLD-159-42` picture before taking the baseline.
  The first `focusSharedTerminal(b)` correction instead raced status-hint overflow
  on Linux ([failed run](https://github.com/console-craft/work-craft/actions/runs/40115199193));
  that extra focus gesture was removed. Exact equality remains intact.
- Waiting for the recovery marker alone did not establish fresh-shell completion:
  a gated-shell probe changed a blank row to `sh-3.2$` after baseline capture. This
  did not reproduce the original geometry displacement and was not itself a fix.
- The [hosted read-only trace](https://github.com/console-craft/work-craft/actions/runs/40110345807/job/120920560183)
  observed geometry 80x24 → 108x38 at 712 ms, prompt redraw at 726 ms and baseline
  at 752 ms. B stayed unchanged before and after A's browsing. Instrumentation can
  mask timing; this pass did not falsify the race. The latest wrapping mismatch
  shows that top-line readiness alone is not proven to establish the whole frame.

## Separate unresolved observations

- Earlier macOS exit 137 was not reproduced by either the
  [direct/supervised lifecycle comparison](https://github.com/console-craft/work-craft/actions/runs/40093808843)
  or the full acceptance comparison above. Its signal source remains unknown.
- The hosted read-only trace failed `raw stage 1 key sequences drive the shell`
  waiting for reload to withdraw input authority while retaining presentation.
  Later passes do not explain that timeout; it has not been attributed to tracing
  or the native exit deadlock.

## Next bounded investigation

Correlate B's baseline/final material, geometry revisions and recovery-marker output
before any A input; use a deterministic fixture handshake if a missing readiness
boundary is established. Demonstrate the exact wrapping failure before changing
the owning test or product. Scroll reports are not sizing activity: do not assume
A's wheel changes ownership. Use the existing external supervisor, one causal
hypothesis at a time, and the development guide's investigation budget. No broader
runtime, rendering or quarantine changes are authorized by this brief.

Ignored local evidence is under `.superpowers/sdd/2026-10-24-test-gates/`, including
`cold-controlled-geometry-red.log`, `cold-geometry-probe-matching-display.log`,
`cold-history-gated-shell-red.log`, `cold-frame-trace-hosted.log`,
`cold-measured-owning-green.log` and `bun-1.4.4-macos-ci.log`. Hosted links above
preserve failure evidence without relying on those local files. Original untracked
proposal/investigation drafts are backed up there under `pre-closeout-docs/`.

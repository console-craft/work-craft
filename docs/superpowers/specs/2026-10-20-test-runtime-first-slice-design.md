# Test Runtime Optimization: First Slice

## Approved Intent

After PR #40 reached green CI on `edaff29`, the user approved this small first
optimization slice in chat: faster test-only renderer scheduling, controlled
toast-demo timers, and measured before/after verification. Keep test counts and
hooks unchanged. The user approved the implementation plan and native execution.
Implementation, local verification and independent read-only review are
complete. The user subsequently authorized committing and pushing this slice to
PR #40, then monitoring CI runtimes. No merge or worktree removal is authorized.

The preceding CI repairs are separate: `e2dbde7` corrected the boundary suite's
empty-output assumption, and `edaff29` added bounded descendant-exit assertions.
The Linux CI run passed 1,515 tests, skipped four, and failed none; test execution
took 276.40 seconds. Its three entry/pane shell suites accounted for approximately
132 seconds and the toast-demo suite approximately 16 seconds. These CI timings
are context, not a substitute for matched local measurements.

## Scope

- Change only the shared test renderer's default frame pacing in
  `packages/tui/src/tests/support/render.ts`. Trial `targetFps: 1000` and
  `maxFps: 1000`, with explicit caller options taking precedence. These values
  are an engineering starting point, not a performance guarantee; retain them
  only if matched runs improve and existing timing-sensitive tests stay stable.
- Preserve real native rendering and independently awaited React commits. Do not
  replace `flush`, remove the two-act `flushMeasured` bridge, change native input
  dispatch, or conflate response, snapshot, commit and frame ordering.
- Replace the four multi-second sleeps in
  `packages/tui/src/demos/tests/toasts.test.tsx` with scoped timer advancement
  using the installed OpenTUI `ManualClock` and Bun spies. A runtime probe showed
  Bun's global fake-timer mode also virtualizes captured native timer functions
  and clocks, so it cannot isolate the renderer as originally proposed. Use the
  existing renderer `clock` option to keep frame
  scheduling on captured real-time functions while demo/notification timers are
  controlled. Do not add clock props or other test-only production APIs.
- Preserve all four toast scenarios and their observable assertions, including
  persistent lifetime, focus at delivery time, pointer actions, cancellation on
  unmount, and clean remounts. Check the delayed notification before its deadline
  as well as at delivery. Restore timers and dispose renderers even on failure.
- Keep all existing test names/cases and hooks. No dependencies, test deletions,
  cross-product reductions, production behavior changes, or new benchmark tool.

## Measurement And Acceptance

Establish local baselines for the same three shell files and toast-demo suite
before editing. Compare the identical commands after each relevant change, with
one test process at a time. Record host/tool versions, elapsed test time, counts
and failures; do not promise an unmeasured speedup or compare local results
directly with another machine's CI timing.

Run affected test-support, shell and demo suites, then repeat the sensitive
three shell files and toast suite three times. Preserve all existing cases and
run `bun run check`, including compiled build/smoke, before completion. A faster
run that drops cases, disables assertions, changes production behavior, leaks fake
timers or destabilizes buffered-input/native-frame coverage is not acceptable.

Existing architecture/source-organization ownership stays unchanged: reusable UI
is application-independent, durable state and runtimes remain daemon-owned, and
this work is confined to tests/support. Review the completed diff independently.
Keep the existing branch/worktree; report results before any separate optimization
publication or broader cleanup decision. Test matrix and hook-policy changes are
explicitly deferred from this slice.

## Implementation And Local Measurements

Only two test files changed: the shared renderer support sets 1,000-FPS default
target/max pacing before caller options, and toast-demo tests use a local
ManualClock with scoped timer/performance spies. A captured native Clock keeps
renderer scheduling live; actual mouse down/up dispatch avoids the mock click
helper's clock-dependent delays. Tests await renderer closure before restoring
timers. All four original toast scenarios and every original expect expression
are retained, with two additional pre-deadline history assertions.

Sequential local measurements on Darwin arm64, Bun 1.4.3:

| Command / scope                   | Before   | After    | Preserved cases                                  |
| --------------------------------- | -------- | -------- | ------------------------------------------------ |
| Same three shell entry/pane files | 135.39 s | 28.78 s  | 394; same 1,976 assertions                       |
| Same toast-demo file              | 15.90 s  | 1.479 s  | 4; 73 original assertions plus 2 deadline checks |
| Full repository tests             | 301.14 s | 128.90 s | 1,519; zero failures                             |

The first two rows are matched commands measured in this slice. The full-suite
baseline is the recent same-host pre-commit run on `edaff29`; timings are
individual observations, not a controlled statistical benchmark or guaranteed CI
speedup. Do not compare these local timings directly to the earlier Linux run.

Verification:

- Pacing-only measured-render/shell/demo gate: 681 passed, zero failures.
- Controlled-time demo/notification/toaster neighbors: 89 passed, zero failures.
- Three repetitions of the 398 sensitive shell/toast cases: 1,194 passed, zero
  failures, 6,153 assertions in 87.55 seconds.
- `bun run check`: lint, formatting, types, all 1,519 tests across 103 files
  (zero failures, 11,134 assertions), build and compiled smoke passed.
- Source inventory: all 208 TUI source/test files remain; no application source,
  dependency, hook or measured-render bridge change. Whitespace checks passed.
- The existing server unsafe-finally warning remains at
  `packages/server/src/application/directories.test.ts:580`.

The delayed-auto case failed without the final millisecond of timer advancement,
then passed with it. A cancellation mutation that omitted the actual demo's
clearTimeout produced two late records and failed the existing unmount assertion;
the exact production line was restored before all final gates.

Ruling: use the installed ManualClock and scoped Bun spies instead of global Bun
fake-timer mode. Runtime probes showed global fake timers virtualize even
captured native timers and monotonic clock functions, preventing the required
independent real renderer clock. The alternative preserves real native scheduling
without production API changes; its risk is global-spy leakage, checked through
cleanup, neighboring suites, repeated sensitive cases and the full gate.

A fresh read-only reviewer found no Critical, Important or Minor issues. The
review independently inspected the complete working diff, connected renderer and
clock implementations, caller-option precedence, cleanup, preserved case names
and all 42 original expect expressions (plus two new expressions). Whitespace
checks passed independently. Native workloads and the full gate were run by the
implementer, not rerun concurrently by the reviewer. The review's runtime-gate
condition is satisfied by the passing repeats and full check recorded above.

Final review ruling: retain earlier maintainability and CI repairs as the
already-green baseline instead of auditing them again in this slice. They are
unchanged and exercised by the full suite; unrelated defects outside this scope
could still require a separate investigation. This resolves the reviewer's sole
deferred judgment. There are no deferred review findings.

These local results do not certify Linux CI, physical-terminal behavior or
long-duration stability; the published commit's CI outcome must be checked
separately. Broader matrix and hook-policy optimization remains deferred.

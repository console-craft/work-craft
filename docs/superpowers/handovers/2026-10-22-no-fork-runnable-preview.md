# Unpatched runnable preview: blocked at drawing gate

## Outcome

No `dist/work-craft-preview` was delivered. The approved bounded attempt stopped
in Task 1, before application integration, dependency switching, packaging or
state reseeding. The normal app remains fork-backed; its build is not a no-fork
preview. No installed command, user database or user daemon was changed in this
attempt. No push, merge, interactive evaluation or performance comparison ran.

The [approved design](../specs/2026-10-22-no-fork-runnable-preview-design.md)
requires native cell positions, wide tails and regional-indicator fidelity, and
explicitly says to stop rather than build another renderer or patch dependencies.

## Exact blocker

For `🇦🇧\x1b[31mX`, the stock native terminal reports two regional-indicator
heads of width two, each followed by an empty tail. `X` begins at zero-based
column four. The former row-text reconstruction rejected the native width, or
merged the indicators and moved `X` to column two.

The bounded repair draws every glyph at its authoritative cell coordinate using
public `OptimizedBuffer.drawText`. This restores `X` to column four, but the native
drawing primitive still makes each regional indicator one column wide, leaving
literal blank cells in place of wide tails:

| Observation        | Native reference | Positioned candidate |
| ------------------ | ---------------- | -------------------- |
| Text before `X`    | `🇦🇧`             | `🇦 🇧 `               |
| Columns before `X` | 4                | 4                    |

A position-only assertion initially passed. The strengthened independent native
text assertion fails, so this is not accepted as a repair. It is a new fidelity
loss, not covered by the existing research-only hyperlink/invisible-wide waivers.

Stock `drawText`, `setCell` and `drawChar` all reproduce the narrowing in each of
`wcwidth`, `unicode` and `unicode-wide`; `encodeUnicode("🇦")` reports width one
in every mode. No supported explicit glyph-width setter was found. This is a
bounded no-go for the tested public primitives, not proof that every possible
upstream API or future OpenTUI release is incapable of rendering these cells.
Private glyph IDs, raw native plane edits, dependency patches, altered Unicode
text and a new renderer were not attempted.

## Retained code and tests

All tentative production promotions were removed. Only test-owned experiment
code and validation remain changed:

- `packages/tui/src/workbench/tests/no-fork-positioned-material-view.ts`: rejected
  explicit-cell drawing trial, focus/cursor clipping and local selection.
- `no-fork-material-view.ts`: fixture-only publisher/sequence wrapper around it.
- `no-fork-positioned-material.fixture.tsx`: public primitive characterization
  plus independent native position/text, styling, cursor and selection cases.
- `no-fork-projection.fixture.tsx`: existing real-PTY probe with the stronger
  regional-indicator text assertion; cursor assertions now explicitly focus views.
- `scripts/test-support/terminal-projection-codec.ts` and its test: narrowly admit
  native two-slot single regional indicators while preserving grapheme, tail,
  geometry, unknown-field and decoded/serialized budget checks.

The acceptance failures remain opt-in, not silently skipped or relaxed. The
normal application has no dependency on the trial and still uses its original
terminal implementation.

## Reproduce

```sh
bun scripts/probe-no-fork-terminal.ts projection \
  "${TMPDIR%/}/opencode/no-fork-preview-evidence"
```

This is an automated registry experiment, **not the app launch command**. It
installs exact stock core/React 0.6.6 and React 19.3.0 outside this workspace,
checks native provenance, bundles only test fixtures and uses owned PTYs.
Exit 1 is expected while the acceptance gates below remain red.

Latest retained registry run: **28 pass, 4 fail, 176 assertions**. Two failures
independently expose the same regional-indicator fidelity blocker (a small native
reference and the real-PTY material round trip). The other two are unchanged:

1. Unique-color 512×512 material exceeds the unchanged eight-MiB budget.
2. Three-MiB paste exceeds the shared native one-MiB encode input ceiling. This
   also fails in the unchanged fork-backed control; the transport is bounded and
   does not truncate or split native encoding to hide it.

Passing checks include the 78-key-per-mode corpus, mutable/native-shaped paste,
one-MiB real-child paste, query ownership, revocation/accounting, Unicode styled
blanks, two-viewer browsing, focused screen-relative cursor clipping and selected
wide-tail copy. These fixture results do not certify application integration.

## Evidence

Evidence root:
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/no-fork-preview-evidence/`

- `projection-oZ9clC/`: final test-only stock-registry bundle, lockfile,
  provenance, tests log and owned-runtime observation records.
- `projection-Owyle6/`: same glyph failure before the final cursor ancestor-loop
  simplification; superseded by the fresh final run above.
- `projection-fSxbLg/`: first strengthened real-PTY text check, 24 pass/3 fail.
- `projection-K74U8y/cell-widths.ts` and `cell-widths.jsonl`: all nine primitive
  and width-mode combinations, plus encoded glyph widths.
- `task-1-promotion-attempt.tar.gz`: attempted production source, original RED log,
  approved plan and execution ledger before demotion back to test-only ownership.

Verified stock darwin-arm64 native SHA-256:
`dc9a57941c499acdaac24f723bfc7fcf81cb444fa0f1f3334b9741b19f643522`.

## Final verification and review

`bun run check` exited **0**: **1,828 pass, 14 skip, zero fail**, 13,174 assertions,
plus artifact verification, lint/format/types, normal compiled build and compiled
smoke. Existing `no-unsafe-finally` and React `act` warnings remain. The first check
attempt stopped at a newly introduced import-order lint error, corrected before
the successful full run. This green fork-backed check is not stock-preview acceptance.

The one independent read-only review found **no Critical or Important issues** and
supported invoking the stop gate. It independently reproduced the stock drawing
failure, verified provenance and found no concrete small supported public repair.
Its one Minor observation was the unfinished verification record and a retained
bundle predating the final cursor-loop simplification. This required final record
now includes the exit status, and the fresh `projection-oZ9clC` run above includes
that exact cursor code: **28 pass, 4 fail, 176 assertions**, exit **1**. Both cursor
and styling/selection cases pass; the four named acceptance failures are unchanged.
No code fix pass or second review was needed; no review minors remain deferred.

The reviewer deliberately did not certify Task 2 authority/readiness/cold-mode or
real-connection paste ownership, Task 3 packaging/identity/seeding, repairs to the
existing budget/paste limits, hyperlink/invisible-wide parity, physical-terminal/
Linux/performance/soak behavior, or universal impossibility of another approach.
These remain unimplemented/unverified or explicitly excluded, never passed by
inference. Continuing any of those requires separate evidence or authorization.

The final plan, ledger, review disposition and check logs are retained in
`blocked-execution-record.tar.gz` under the evidence root above; the approved plan
also remains at `docs/superpowers/plans/2026-10-22-no-fork-runnable-preview.md`.

## Decisions and remaining work

- Reused the unchanged installed dependency baseline until the planned coordinated
  cutover. Risk: environment drift; stock provenance and final checks are separate.
- Applied the approved stop rule, retained the failed candidate only in tests and
  did not proceed to Tasks 2–3. Risk: a small supported drawing API may have been
  missed; the independent review supports this bounded conclusion, not universal
  impossibility.
- No launch/manual checklist is offered for an executable that does not exist.
  No application protocol/authority integration, compatible daemon identity,
  compiled stock provenance, relocation smoke or preview-state seed is claimed.

The branch and control remain available. Continuing would require a separately
authorized change in constraints or a demonstrated small public repair, not
automatic expansion of this delivery attempt.

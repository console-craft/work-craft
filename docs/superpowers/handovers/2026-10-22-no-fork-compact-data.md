# No-Fork Compact Data Outcome — 2026-10-22

## Outcome

The approved test-only compact-data slice removes the original avoidable screen
and paste JSON expansion. It **does not qualify production adoption or performance**.
Three acceptance failures remain explicit: a supported unique-color grid still
exceeds the compact frame budget, and 3-MiB paste delivery hits the native encoder's
pre-existing 1-MiB input ceiling. The independent review also exposed a pre-existing
regional-indicator drawing mismatch outside the approved research exceptions.

The latter corrects an earlier assumption: an 8-MiB logical input queue does not
prove that #41 can deliver one 3-MiB paste. A direct public-API comparison shows
the same native ceiling in the unchanged installed fork-backed control and stock
registry 0.6.6. Do not label that ceiling a new no-fork regression or silently waive
the requested large-paste case.

Production sources/dependencies/vendor assets, the installed application, #41,
normal database and running user processes were not changed by this slice.
The build/smoke gate still builds the unchanged fork-backed app.

## Representation

- Each compact frame has exact RGBA/attribute style values and rows of
  `[count, text, width, styleIndex]` tuples. Only identical adjacent cells merge.
- The runtime builds rows directly from the public native buffer lease, without
  first retaining the old `MaterialCell[][]`. Old plain extraction remains for
  the original fidelity diagnostics and small reference assertions.
- The drawing leaf validates compact geometry, runs, colors, wide tails and
  budgets before staging native TextBuffer/TextBufferView resources. Cell text
  must be one grapheme and agree with Bun's display-width measurement. This is a
  conservative gate, not universal native-width compatibility: the known regional
  indicator disagreement is refused rather than silently shifting following text.
  The leaf consumes
  compact rows directly; an invalid frame does not replace the last valid picture.
- The complete state envelope is bounded at 8,388,608 encoded bytes. Native
  resolved-character extraction and expanded drawing text are also capped at
  8 MiB to avoid decompression-style allocation amplification. Extreme combining
  text above that budget is unqualified, not a newly accepted concession.
- Pastes retain semantic capture/queue accounting and use at most 65,536 raw bytes
  per base64 request, generated lazily. One bounded transfer validates identity,
  original authority, exact offsets and canonical base64, with no PTY prefix before
  an explicit commit and a four-second idle expiry.
- Revocation, abort, error and teardown release pending transfer storage. Completion
  invokes the existing native paste encoder once; no custom delimiter/sanitization
  implementation or multiple bracketed-paste events were introduced.
- Actual child input is recorded in bounded base64 chunks. State returns a small
  exact prefix plus byte count/SHA-256, not megabytes of numeric-array diagnostics.
- Stale/unrelated requests cannot clear another transfer's captured ownership.
  A committed input excludes further admission until child acknowledgement or
  failure, so another full-budget transfer cannot overlap the in-flight buffer.
- Unknown frame/size/cursor/style fields reject before serialization; receiver
  stamps retain only trusted known fields, not arbitrary request data.

## Evidence

The final post-review `projection-BldrDP` run has **24 pass / 3 fail / 149 assertions**.
All prior tested small-frame interaction, authority, cold-picture, browsing/copy,
mouse/focus, key/layout/Kitty, query and cleanup gates remain passing.

The table records the pre-review `projection-ppnyyV` measurements. The final
original-grid envelope is **8,879 bytes** after adding an input-frontier diagnostic;
the maximum paste request remains 87,626 bytes. The paused-owned-child regression
now rejects a second near-8-MiB transfer until the committed paste is acknowledged.

| Case                                                    | Observed result                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Original 512×512 grid with Unicode/styled blanks/cursor | Complete compact envelope **8,861 bytes**, drawn in two independently sized viewers; old DTO lower bound was 16,777,216 bytes           |
| Pure codec maximum repeated grid, 4,096×256             | 1,048,576 cells represented under 10,000 bytes without expansion                                                                        |
| Irregular text/alternating styles                       | Compact native material matches the small plain reference                                                                               |
| Unique-color 512×512 grid                               | Still fails `Projection frame budget`; the failed extraction releases its lease and a later small frame succeeds                        |
| 3-MiB paste transport                                   | Largest request **87,626 bytes**; transport/reassembly succeeds, final native encode fails `InvalidArgument`, child receives zero bytes |
| 1-MiB paste                                             | Real child receives exactly **1,048,588 bytes**, one bracketed envelope, correct independently computed SHA-256                         |
| Chunk-spanning UTF-8/NUL/escape-shaped paste            | Actual child byte count/digest matches the public native reference                                                                      |
| Partial paste plus ordinary input/revocation            | Ordinary input cannot overtake pending transfer; away/back revocation delivers no uncommitted bytes                                     |

The public native encoder accepts exactly 1,048,576 input bytes and rejects
1,048,577 and 3,145,728, with/without bracketed mode. This threshold is shared by
the registry and unchanged installed fork-backed control. The caller cannot satisfy
the approved single-native-encode 3-MiB requirement through this API as tested.
Splitting into separately encoded pastes or constructing delimiters would be a
different behavior/design, deliberately not introduced here.

The irregular grid failure is the approved stop for this compact representation.
No paging, deltas, binary framing, alternate compression layer, dimension reduction
or larger safety limit was added to manufacture a passing gate.

The additional regional-indicator defect reproduces in the base revision's
material leaf: for `🇦🇧` followed by differently styled `X`, the native terminal
places `X` after four columns but TextBuffer reconstruction places it after two.
It re-segments adjacent native cell text. This is not introduced by compact tuples
and is not covered by either research waiver. The final validation refuses the
incompatible widths rather than accepting a shifted picture; the acceptance test
remains red. Other native/Unicode-width disagreements remain unqualified. A future
drawing decision must preserve actual terminal cell positions.

## Verification And Review

Final focused launcher/codec/paste tests pass **30/30**, 401 assertions. Registry
contracts pass **7/7**. The fresh post-fix `bun run check` retry passes lint,
format/types, **1,827 tests / 14 skips / zero failures**, build and relocated
default compiled smoke. The pre-review full check had also passed 1,823 tests.

Task 1 committed as `9206822`; Task 2 as `a672e30`, both with normal hooks.
The first Task 2 hook failed the unchanged
`terminal focus readiness cannot reuse a cursor shown before the entry gesture`
test (1,822 pass / 14 skips / one timeout); the normal retry passed. No unrelated
test deadlines/assertions were changed and no hooks bypassed.

The first post-fix full check had 1,825 pass / 14 skips / two failures in unchanged
Git tests: `shutdown during fallback reaps its real Git helper without late
publication or PTY effects` missed its 1,500-ms helper readiness bound; `a linked
checkout can inspect an unavailable primary independently` reported its 2,000-ms
Git inspection timeout. Both passed their focused same-source retry; the full
normal retry passed. These failures are preserved, not claimed repaired.
The first final-commit hook also repeated the unchanged stale-cursor readiness
timeout (1,826 pass / 14 skips / one failure); no hook or assertion was bypassed.

### Independent Review Disposition

One read-only review found five Important, one Minor and no Critical findings.
One fix pass, with no re-review:

1. **Fixed ownership-scoped cleanup:** old/stale/overlapping requests no longer
   clear a replacement paste. Regression went RED→GREEN; unrelated errors now
   preserve the owner rather than encoding the defect in the test expectation.
2. **Fixed in-flight admission:** while committed input awaits the actual child,
   the runtime rejects additional input/begin requests. The regression pauses only
   its owned child and proves exclusion, then admission after acknowledgement.
3. **Fixed malformed cell text/width admission:** multi-character cells, width-one
   emoji and standalone combining glyphs reject before native staging; combining-e
   remains supported. The previous picture remains intact after rejected material.
4. **Fixed unknown-field budget bypass:** key allowlists run before serialization;
   paste authority retains only trusted fields. Oversized serialization and poisoned
   stamp-copy regressions both went RED→GREEN.
5. **Recorded existing regional-indicator blocker:** native reference versus material
   positions is now an explicit acceptance test and retained failed observation.
   No new drawing mechanism or behavior waiver was introduced.

**Deferred minor:** internal `sendProjectionInput` uses `Buffer.from()` without
rejecting malformed numeric byte values; normal captured paste bytes are valid,
but direct helper misuse can coerce 256/-1/fractions rather than rejecting them.
The wire receiver still validates canonical base64. This helper-contract/diagnostic
integrity issue was not folded into the Important fix pass.

Review exclusions stand: production integration, alternate codecs/paging/deltas,
performance/capacity/soak, compiled no-fork relocation, Linux/physical terminals,
the two research-only exceptions, and repairing the unchanged readiness flake.
The three explicit opt-in acceptance failures are separate from the green default
repository check; no correctness or production-adoption qualification is implied.

## Reproduction And Retained Artifacts

```sh
bun test scripts/probe-no-fork-terminal.test.ts scripts/test-support/terminal-projection-codec.test.ts scripts/test-support/terminal-projection-paste.test.ts
bun scripts/probe-no-fork-terminal.ts contracts /absolute/owned/evidence
# Nonzero while the three acceptance failures remain:
bun scripts/probe-no-fork-terminal.ts projection /absolute/owned/evidence
```

Evidence root:
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/no-fork-compact-evidence/`.

- `projection-zqMli8`: chunk-wire integration RED before the runtime receiver.
- `projection-5ng0pu`: successful <=1-MiB paste and explicit native ceiling.
- `projection-aL4yKL`: compact wire integration RED before compact extraction/drawing.
- `projection-ppnyyV`: pre-review final outcome, native provenance, child input
  logs and `roundtrip-*/*observation.json` for both screen cases and paste delivery.
- `contracts-i9S08U`: current stock public/native contract checks.
- `projection-emLwvy`: review regressions RED, including in-flight over-admission
  and the four-versus-two regional-indicator position mismatch.
- `projection-BldrDP`: final post-fix 24 pass / 3 preserved failures / 149 assertions;
  original-grid envelope 8,879 bytes, bounded paste requests and explicit regional
  width rejection, plus source/native provenance and child logs.

Registry native SHA-256 was independently rechecked against the retained file:
`dc9a57941c499acdaac24f723bfc7fcf81cb444fa0f1f3334b9741b19f643522`.
The execution ledger/log archive retains the installed-control paste comparison.

## Remaining Decisions

This is a bounded evidence result, not permission to ship these limitations.
Further screen delivery/cell-position drawing design and handling the shared
large-paste encoder limit need a new decision. Do not measure this as a fully
correctness-qualified candidate.
No performance equivalence, production adoption, compiled no-fork relocation,
Linux, physical-terminal or capacity/soak claim is made. The existing hyperlink
and invisible-wide second-cell exceptions remain research-only.
